import { buildExpenseNumber, normalizeOrderNumberPrefix } from '@wrs/shared';
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

function parseImageUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function serializeImageUrls(urls) {
  const arr = Array.isArray(urls) ? urls.filter(Boolean) : [];
  return arr.length ? JSON.stringify(arr) : null;
}

function withParsedImageUrls(row) {
  if (!row) return row;
  return { ...row, image_urls: parseImageUrls(row.image_urls) };
}

async function nextExpenseBillNumber(trx, shopId) {
  const row = await trx('expense_entries').where({ shop_id: shopId }).max('bill_no as max_bill').first();
  return Number(row?.max_bill || 0) + 1;
}

async function assignExpenseBillNumber(trx, shopId) {
  const shopRow = await trx('shops')
    .where({ id: shopId })
    .forUpdate()
    .select('order_number_prefix')
    .first();
  const billNo = await nextExpenseBillNumber(trx, shopId);
  const shopPrefix = normalizeOrderNumberPrefix(shopRow?.order_number_prefix);
  const prefix = shopPrefix ? `E${shopPrefix}` : 'E';
  return {
    bill_no: billNo,
    expense_number: buildExpenseNumber({ prefix, sequence: billNo }),
  };
}

async function assertExpenseEntryAccounts(shopId, body) {
  const expenseAcc = await knex('payment_accounts')
    .where({ shop_id: shopId, id: body.expense_account_id })
    .first();
  if (!expenseAcc || !expenseAcc.is_active) {
    throw badRequest('Unknown or inactive expense account');
  }
  if (normalizeAccountGroup(expenseAcc.account_group) !== 'expenses') {
    throw badRequest('Expense account must belong to the Expenses group');
  }

  const payAcc = await knex('payment_accounts')
    .where({ shop_id: shopId, id: body.payment_account_id })
    .first();
  if (!payAcc || !payAcc.is_active) {
    throw badRequest('Unknown or inactive payment account');
  }
  if (!PAYMENT_ACCOUNT_GROUPS.has(normalizeAccountGroup(payAcc.account_group))) {
    throw badRequest('Payment account must be a bank or cash account');
  }
}

export function buildExpenseEntriesListQuery(shopId) {
  return knex('expense_entries as ee')
    .where({ 'ee.shop_id': shopId })
    .leftJoin('payment_accounts as ea', function joinEa() {
      this.on('ea.shop_id', '=', 'ee.shop_id').andOn('ea.id', '=', 'ee.expense_account_id');
    })
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'ee.shop_id').andOn('pa.id', '=', 'ee.payment_account_id');
    })
    .select(
      'ee.id',
      'ee.shop_id',
      'ee.bill_no',
      'ee.expense_number',
      'ee.expense_account_id',
      'ee.payment_account_id',
      'ee.contact_no',
      'ee.image_urls',
      'ee.name',
      'ee.entry_date',
      'ee.amount',
      'ee.details',
      'ee.created_by',
      'ee.created_at',
      'ee.updated_at',
      knex.raw('ea.name as expense_account_name'),
      knex.raw('pa.name as payment_account_name')
    );
}

export async function getExpenseEntryRow(shopId, id) {
  const row = await buildExpenseEntriesListQuery(shopId).where('ee.id', id).first();
  return withParsedImageUrls(row);
}

export async function listExpenseEntries(shopId, query) {
  const qb = buildExpenseEntriesListQuery(shopId);
  if (query.from) qb.andWhere('ee.entry_date', '>=', query.from);
  if (query.to) qb.andWhere('ee.entry_date', '<=', query.to);
  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-ee.entry_date',
    search_fields: ['ee.expense_number', 'ee.name', 'ee.details', 'ee.contact_no'],
  });
  if (Array.isArray(result.data)) {
    result.data = result.data.map(withParsedImageUrls);
  }
  return result;
}

export async function createExpenseEntry(shopId, authUserId, body) {
  await assertExpenseEntryAccounts(shopId, body);

  return knex.transaction(async (trx) => {
    const id = uuid();
    const numbering = await assignExpenseBillNumber(trx, shopId);
    await trx('expense_entries').insert({
      id,
      shop_id: shopId,
      bill_no: numbering.bill_no,
      expense_number: numbering.expense_number,
      expense_account_id: body.expense_account_id,
      payment_account_id: body.payment_account_id,
      contact_no: body.contact_no || null,
      image_urls: serializeImageUrls(body.image_urls),
      name: body.name,
      entry_date: body.entry_date,
      amount: body.amount,
      details: body.details,
      created_by: authUserId || null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    const row = await buildExpenseEntriesListQuery(shopId)
      .transacting(trx)
      .where('ee.id', id)
      .first();
    return withParsedImageUrls(row);
  });
}

export async function updateExpenseEntry(shopId, id, body) {
  await assertExpenseEntryAccounts(shopId, body);

  const updated = await knex('expense_entries')
    .where({ shop_id: shopId, id })
    .update({
      expense_account_id: body.expense_account_id,
      payment_account_id: body.payment_account_id,
      contact_no: body.contact_no || null,
      image_urls: serializeImageUrls(body.image_urls),
      name: body.name,
      entry_date: body.entry_date,
      amount: body.amount,
      details: body.details,
      updated_at: knex.fn.now(),
    });

  if (!updated) throw notFound('Expense entry not found');

  return getExpenseEntryRow(shopId, id);
}

export async function deleteExpenseEntry(shopId, id) {
  const existing = await getExpenseEntryRow(shopId, id);
  if (!existing) throw notFound('Expense entry not found');

  await knex('expense_entries').where({ shop_id: shopId, id }).delete();
  return existing;
}
