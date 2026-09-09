import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

async function assertJournalVoucherAccounts(shopId, body) {
  const debit = await knex('payment_accounts')
    .where({ shop_id: shopId, id: body.debit_account_id })
    .first();
  if (!debit || !debit.is_active) {
    throw badRequest('Unknown or inactive debit account');
  }

  const credit = await knex('payment_accounts')
    .where({ shop_id: shopId, id: body.credit_account_id })
    .first();
  if (!credit || !credit.is_active) {
    throw badRequest('Unknown or inactive credit account');
  }

  if (body.debit_account_id === body.credit_account_id) {
    throw badRequest('Debit and credit accounts must differ');
  }
}

export function buildJournalVouchersListQuery(shopId) {
  return knex('journal_vouchers as jv')
    .where({ 'jv.shop_id': shopId })
    .leftJoin('payment_accounts as da', function joinDa() {
      this.on('da.shop_id', '=', 'jv.shop_id').andOn('da.id', '=', 'jv.debit_account_id');
    })
    .leftJoin('payment_accounts as ca', function joinCa() {
      this.on('ca.shop_id', '=', 'jv.shop_id').andOn('ca.id', '=', 'jv.credit_account_id');
    })
    .select(
      'jv.id',
      'jv.shop_id',
      'jv.debit_account_id',
      'jv.credit_account_id',
      'jv.entry_date',
      'jv.amount',
      'jv.remarks',
      'jv.created_by',
      'jv.created_at',
      'jv.updated_at',
      knex.raw('da.name as debit_account_name'),
      knex.raw('ca.name as credit_account_name')
    );
}

export async function getJournalVoucherRow(shopId, id) {
  return buildJournalVouchersListQuery(shopId).where('jv.id', id).first();
}

export async function listJournalVouchers(shopId, query) {
  const qb = buildJournalVouchersListQuery(shopId);
  if (query.from) qb.andWhere('jv.entry_date', '>=', query.from);
  if (query.to) qb.andWhere('jv.entry_date', '<=', query.to);
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-jv.entry_date',
    search_fields: ['jv.remarks', 'da.name', 'ca.name'],
  });
}

export async function createJournalVoucher(shopId, authUserId, body) {
  await assertJournalVoucherAccounts(shopId, body);

  const id = uuid();
  await knex('journal_vouchers').insert({
    id,
    shop_id: shopId,
    debit_account_id: body.debit_account_id,
    credit_account_id: body.credit_account_id,
    entry_date: body.entry_date,
    amount: body.amount,
    remarks: body.remarks,
    created_by: authUserId || null,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  });

  return buildJournalVouchersListQuery(shopId).where('jv.id', id).first();
}

export async function updateJournalVoucher(shopId, id, body) {
  await assertJournalVoucherAccounts(shopId, body);

  const updated = await knex('journal_vouchers')
    .where({ shop_id: shopId, id })
    .update({
      debit_account_id: body.debit_account_id,
      credit_account_id: body.credit_account_id,
      entry_date: body.entry_date,
      amount: body.amount,
      remarks: body.remarks,
      updated_at: knex.fn.now(),
    });

  if (!updated) throw notFound('Journal voucher not found');

  return getJournalVoucherRow(shopId, id);
}

export async function deleteJournalVoucher(shopId, id) {
  const existing = await getJournalVoucherRow(shopId, id);
  if (!existing) throw notFound('Journal voucher not found');

  await knex('journal_vouchers').where({ shop_id: shopId, id }).delete();
  return existing;
}
