import { randomBytes } from 'node:crypto';

import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

function normalizeAccountGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const DEBIT_GROUPS = new Set(['bank accounts', 'cash accounts']);
const CREDIT_GROUPS = new Set(['parties', 'vendors']);

function buildVoucherNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `RV${y}${mo}${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function assertReceiptVoucherAccounts(shopId, body) {
  const debit = await knex('payment_accounts')
    .where({ shop_id: shopId, id: body.debit_account_id })
    .first();
  if (!debit || !debit.is_active) {
    throw badRequest('Unknown or inactive debited account');
  }
  const debitGroup = normalizeAccountGroup(debit.account_group);
  if (!DEBIT_GROUPS.has(debitGroup)) {
    throw badRequest('Debited account must be a bank or cash account');
  }

  const credit = await knex('payment_accounts')
    .where({ shop_id: shopId, id: body.credit_account_id })
    .first();
  if (!credit || !credit.is_active) {
    throw badRequest('Unknown or inactive credited account');
  }
  const creditGroup = normalizeAccountGroup(credit.account_group);
  if (!CREDIT_GROUPS.has(creditGroup)) {
    throw badRequest('Credited account must be a party or vendor');
  }

  if (body.debit_account_id === body.credit_account_id) {
    throw badRequest('Debited and credited accounts must differ');
  }
}

function normalizeRemarks(body) {
  const r = body.remarks;
  if (r == null) return null;
  const t = String(r).trim();
  return t === '' ? null : t;
}

export function buildReceiptVouchersListQuery(shopId) {
  return knex('receipt_vouchers as rv')
    .where({ 'rv.shop_id': shopId })
    .leftJoin('payment_accounts as da', function joinDa() {
      this.on('da.shop_id', '=', 'rv.shop_id').andOn('da.id', '=', 'rv.debit_account_id');
    })
    .leftJoin('payment_accounts as ca', function joinCa() {
      this.on('ca.shop_id', '=', 'rv.shop_id').andOn('ca.id', '=', 'rv.credit_account_id');
    })
    .select(
      'rv.id',
      'rv.shop_id',
      'rv.voucher_number',
      'rv.debit_account_id',
      'rv.credit_account_id',
      'rv.entry_date',
      'rv.amount',
      'rv.remarks',
      'rv.created_by',
      'rv.created_at',
      'rv.updated_at',
      knex.raw('da.name as debit_account_name'),
      knex.raw('ca.name as credit_account_name')
    );
}

export async function getReceiptVoucherRow(shopId, id) {
  return buildReceiptVouchersListQuery(shopId).where('rv.id', id).first();
}

export async function listReceiptVouchers(shopId, query) {
  const qb = buildReceiptVouchersListQuery(shopId);
  if (query.from) qb.andWhere('rv.entry_date', '>=', query.from);
  if (query.to) qb.andWhere('rv.entry_date', '<=', query.to);
  if (query.entry_date) qb.andWhere('rv.entry_date', query.entry_date);
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-rv.entry_date',
    search_fields: ['rv.voucher_number', 'rv.remarks', 'da.name', 'ca.name'],
  });
}

export async function createReceiptVoucher(shopId, authUserId, body) {
  await assertReceiptVoucherAccounts(shopId, body);
  const remarks = normalizeRemarks(body);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = uuid();
    const voucherNumber = buildVoucherNumber();
    try {
      await knex('receipt_vouchers').insert({
        id,
        shop_id: shopId,
        voucher_number: voucherNumber,
        debit_account_id: body.debit_account_id,
        credit_account_id: body.credit_account_id,
        entry_date: body.entry_date,
        amount: body.amount,
        remarks,
        created_by: authUserId || null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
      return buildReceiptVouchersListQuery(shopId).where('rv.id', id).first();
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) continue;
      throw err;
    }
  }

  throw badRequest('Could not allocate a unique voucher number');
}

export async function updateReceiptVoucher(shopId, id, body) {
  await assertReceiptVoucherAccounts(shopId, body);
  const remarks = normalizeRemarks(body);

  const updated = await knex('receipt_vouchers')
    .where({ shop_id: shopId, id })
    .update({
      debit_account_id: body.debit_account_id,
      credit_account_id: body.credit_account_id,
      entry_date: body.entry_date,
      amount: body.amount,
      remarks,
      updated_at: knex.fn.now(),
    });

  if (!updated) throw notFound('Receipt voucher not found');

  return getReceiptVoucherRow(shopId, id);
}

export async function deleteReceiptVoucher(shopId, id) {
  const existing = await getReceiptVoucherRow(shopId, id);
  if (!existing) throw notFound('Receipt voucher not found');

  await knex('receipt_vouchers').where({ shop_id: shopId, id }).delete();
  return existing;
}
