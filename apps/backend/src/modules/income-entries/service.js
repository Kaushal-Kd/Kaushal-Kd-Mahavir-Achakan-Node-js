import { buildIncomeNumber, normalizeOrderNumberPrefix } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

function normalizeAccountGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const PAYMENT_ACCOUNT_GROUPS = new Set(['bank accounts', 'cash accounts']);

async function nextIncomeBillNumber(trx, shopId) {
  const row = await trx('income_entries')
    .where({ shop_id: shopId })
    .max('bill_no as max_bill')
    .first();
  return Number(row?.max_bill || 0) + 1;
}

async function assignIncomeBillNumber(trx, shopId) {
  const shopRow = await trx('shops')
    .where({ id: shopId })
    .forUpdate()
    .select('order_number_prefix')
    .first();
  const billNo = await nextIncomeBillNumber(trx, shopId);
  const shopPrefix = normalizeOrderNumberPrefix(shopRow?.order_number_prefix);
  const prefix = shopPrefix ? `I${shopPrefix}` : 'I';
  return {
    bill_no: billNo,
    income_number: buildIncomeNumber({ prefix, sequence: billNo }),
  };
}

async function assertIncomeAccountId(shopId, incomeAccountId, db = knex) {
  const incomeAcc = await db('payment_accounts')
    .where({ shop_id: shopId, id: incomeAccountId })
    .first();
  if (!incomeAcc || !incomeAcc.is_active) {
    throw badRequest('Unknown or inactive income account');
  }
  if (normalizeAccountGroup(incomeAcc.account_group) !== 'income') {
    throw badRequest('Income account must belong to the Income group');
  }
}

async function assertIncomeEntryPaymentAccount(shopId, paymentAccountId, db = knex) {
  const payAcc = await db('payment_accounts')
    .where({ shop_id: shopId, id: paymentAccountId })
    .first();
  if (!payAcc || !payAcc.is_active) {
    throw badRequest('Unknown or inactive payment account');
  }
  if (!PAYMENT_ACCOUNT_GROUPS.has(normalizeAccountGroup(payAcc.account_group))) {
    throw badRequest('Payment account must be a bank or cash account');
  }
}

async function assertIncomeEntrySecurityAccount(shopId, securityAccountId, db = knex) {
  const secAcc = await db('security_accounts')
    .where({ shop_id: shopId, id: securityAccountId })
    .first();
  if (!secAcc || secAcc.is_active === false) {
    throw badRequest('Unknown or inactive security account');
  }
}

async function assertIncomeEntryAccounts(shopId, body) {
  await assertIncomeAccountId(shopId, body.income_account_id);
  await assertIncomeEntryPaymentAccount(shopId, body.payment_account_id);
}

export function buildIncomeEntriesListQuery(shopId) {
  return knex('income_entries as ie')
    .where({ 'ie.shop_id': shopId })
    .leftJoin('payment_accounts as ia', function joinIa() {
      this.on('ia.shop_id', '=', 'ie.shop_id').andOn('ia.id', '=', 'ie.income_account_id');
    })
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'ie.shop_id').andOn('pa.id', '=', 'ie.payment_account_id');
    })
    .leftJoin('security_accounts as sa', function joinSa() {
      this.on('sa.shop_id', '=', 'ie.shop_id').andOn('sa.id', '=', 'ie.security_account_id');
    })
    .select(
      'ie.id',
      'ie.shop_id',
      'ie.bill_no',
      'ie.income_number',
      'ie.income_account_id',
      'ie.payment_account_id',
      'ie.security_account_id',
      'ie.name',
      'ie.entry_date',
      'ie.amount',
      'ie.details',
      'ie.created_by',
      'ie.created_at',
      'ie.updated_at',
      knex.raw('ia.name as income_account_name'),
      knex.raw('pa.name as payment_account_name'),
      knex.raw('sa.name as security_account_name')
    );
}

/**
 * Income from forfeited security — money already held; credit income from security or bank/cash.
 */
export async function createIncomeEntryForSecuritySettle(shopId, authUserId, body, trx = null) {
  const db = trx || knex;
  await assertIncomeAccountId(shopId, body.income_account_id, db);
  const paymentAccountId = body.payment_account_id
    ? String(body.payment_account_id).trim().slice(0, 80)
    : null;
  const securityAccountId = body.security_account_id
    ? String(body.security_account_id).trim().slice(0, 80)
    : null;
  if (Boolean(paymentAccountId) === Boolean(securityAccountId)) {
    throw badRequest(
      'Select either a security account or a bank/cash account as the forfeit source'
    );
  }
  if (paymentAccountId) {
    await assertIncomeEntryPaymentAccount(shopId, paymentAccountId, db);
  } else {
    await assertIncomeEntrySecurityAccount(shopId, securityAccountId, db);
  }

  const createWithDb = async (writeDb) => {
    const id = uuid();
    const numbering = await assignIncomeBillNumber(writeDb, shopId);
    await writeDb('income_entries').insert({
      id,
      shop_id: shopId,
      bill_no: numbering.bill_no,
      income_number: numbering.income_number,
      income_account_id: body.income_account_id,
      payment_account_id: paymentAccountId,
      security_account_id: securityAccountId,
      name: body.name,
      entry_date: body.entry_date,
      amount: body.amount,
      details: body.details,
      created_by: authUserId || null,
      created_at: writeDb.fn.now(),
      updated_at: writeDb.fn.now(),
    });
    return buildIncomeEntriesListQuery(shopId).transacting(writeDb).where('ie.id', id).first();
  };
  return trx ? createWithDb(trx) : knex.transaction(createWithDb);
}

export async function getIncomeEntryRow(shopId, id) {
  return buildIncomeEntriesListQuery(shopId).where('ie.id', id).first();
}

export async function listIncomeEntries(shopId, query) {
  const qb = buildIncomeEntriesListQuery(shopId);
  if (query.from) qb.andWhere('ie.entry_date', '>=', query.from);
  if (query.to) qb.andWhere('ie.entry_date', '<=', query.to);
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-ie.entry_date',
    search_fields: ['ie.income_number', 'ie.name', 'ie.details'],
  });
}

export async function createIncomeEntry(shopId, authUserId, body) {
  await assertIncomeEntryAccounts(shopId, body);

  return knex.transaction(async (trx) => {
    const id = uuid();
    const numbering = await assignIncomeBillNumber(trx, shopId);
    await trx('income_entries').insert({
      id,
      shop_id: shopId,
      bill_no: numbering.bill_no,
      income_number: numbering.income_number,
      income_account_id: body.income_account_id,
      payment_account_id: body.payment_account_id,
      name: body.name,
      entry_date: body.entry_date,
      amount: body.amount,
      details: body.details,
      created_by: authUserId || null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    return buildIncomeEntriesListQuery(shopId).transacting(trx).where('ie.id', id).first();
  });
}

export async function updateIncomeEntry(shopId, id, body) {
  const operation = await knex('security_charge_operations').where({ shop_id: shopId, income_entry_id: id }).first('id');
  if (operation) throw badRequest('Recognized condition income is immutable; income reversals are not supported');
  await assertIncomeEntryAccounts(shopId, body);

  const updated = await knex('income_entries').where({ shop_id: shopId, id }).update({
    income_account_id: body.income_account_id,
    payment_account_id: body.payment_account_id,
    name: body.name,
    entry_date: body.entry_date,
    amount: body.amount,
    details: body.details,
    updated_at: knex.fn.now(),
  });

  if (!updated) throw notFound('Income entry not found');

  return getIncomeEntryRow(shopId, id);
}

export async function deleteIncomeEntry(shopId, id) {
  const operation = await knex('security_charge_operations').where({ shop_id: shopId, income_entry_id: id }).first('id');
  if (operation) throw badRequest('Recognized condition income cannot be deleted');
  const existing = await getIncomeEntryRow(shopId, id);
  if (!existing) throw notFound('Income entry not found');

  await knex('income_entries').where({ shop_id: shopId, id }).delete();
  return existing;
}
