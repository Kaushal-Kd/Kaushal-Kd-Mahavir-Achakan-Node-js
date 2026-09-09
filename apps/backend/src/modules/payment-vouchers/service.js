import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import {
  formatPaymentVoucherNumber,
  nextPaymentVoucherSequenceStart,
  PAYMENT_VOUCHER_SEQUENCE_KEY,
} from './voucherNumber.js';

function normalizeAccountGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const CREDIT_GROUPS = new Set(['bank accounts', 'cash accounts']);
const DEBIT_GROUPS = new Set(['parties', 'vendors', 'laundry vendor']);

async function nextPaymentVoucherSequence(trx, shopId) {
  let row = await trx('settings')
    .where({ shop_id: shopId, key: PAYMENT_VOUCHER_SEQUENCE_KEY })
    .forUpdate()
    .first();

  if (!row) {
    const existing = await trx('payment_vouchers')
      .where({ shop_id: shopId })
      .pluck('voucher_number');
    const start = nextPaymentVoucherSequenceStart(existing);
    try {
      await trx('settings').insert({
        id: uuid(),
        shop_id: shopId,
        key: PAYMENT_VOUCHER_SEQUENCE_KEY,
        value: String(start + 1),
        updated_at: trx.fn.now(),
      });
      return start;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY' && error?.errno !== 1062) throw error;
      row = await trx('settings')
        .where({ shop_id: shopId, key: PAYMENT_VOUCHER_SEQUENCE_KEY })
        .forUpdate()
        .first();
    }
  }

  const sequence = Math.max(1, Number(row?.value) || 1);
  await trx('settings')
    .where({ shop_id: shopId, key: PAYMENT_VOUCHER_SEQUENCE_KEY })
    .update({ value: String(sequence + 1), updated_at: trx.fn.now() });
  return sequence;
}

function resolveBillIds(body) {
  if (Array.isArray(body.bill_ids) && body.bill_ids.length) {
    return [...new Set(body.bill_ids)];
  }
  if (body.bill_id) return [body.bill_id];
  return [];
}

async function assertPaymentVoucherAccounts(trx, shopId, body) {
  const credit = await trx('payment_accounts')
    .where({ shop_id: shopId, id: body.credit_account_id })
    .first();
  if (!credit || !credit.is_active) {
    throw badRequest('Unknown or inactive credited account');
  }
  const creditGroup = normalizeAccountGroup(credit.account_group);
  if (!CREDIT_GROUPS.has(creditGroup)) {
    throw badRequest('Credited account must be a bank or cash account');
  }

  const debit = await trx('payment_accounts')
    .where({ shop_id: shopId, id: body.debit_account_id })
    .first();
  if (!debit || !debit.is_active) {
    throw badRequest('Unknown or inactive debited account');
  }
  const debitGroup = normalizeAccountGroup(debit.account_group);
  if (!DEBIT_GROUPS.has(debitGroup)) {
    throw badRequest('Debited account must be a vendor or party account');
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function getBillRemaining(trx, shopId, billKind, billId, debitAccountId) {
  if (billKind === 'washing') {
    const job = await trx('laundry_jobs')
      .where({ id: billId, shop_id: shopId })
      .forUpdate()
      .first();
    if (!job) throw badRequest('Laundry job not found');
    const payable = Number(job.payable_amount || 0);
    const paid = Number(job.paid_to_washing_amount || 0);
    const balance = round2(payable - paid);
    if (balance <= 0) throw badRequest('This washing job has no pending amount');
    return balance;
  }

  if (billKind === 'purchase') {
    const purchase = await trx('purchases')
      .where({ id: billId, shop_id: shopId })
      .forUpdate()
      .first();
    if (!purchase) throw badRequest('Purchase not found');
    if (purchase.status === 'cancelled') {
      throw badRequest('Cancelled purchase cannot accept payments');
    }
    if (
      purchase.vendor_account_id &&
      String(purchase.vendor_account_id) !== String(debitAccountId)
    ) {
      throw badRequest('Debited account must match purchase vendor');
    }
    const paid = round2(purchase.advance || 0);
    const bill = round2(purchase.total_amount || 0);
    const pending = round2(Math.max(0, bill - paid));
    if (pending <= 0) throw badRequest('This purchase has no pending amount');
    return pending;
  }

  return 0;
}

async function insertPaymentVoucherForBill(
  trx,
  shopId,
  authUserId,
  body,
  billKind,
  billId,
  amount,
  remarks
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = uuid();
    const voucherNumber = formatPaymentVoucherNumber(await nextPaymentVoucherSequence(trx, shopId));
    try {
      await trx('payment_vouchers').insert({
        id,
        shop_id: shopId,
        voucher_number: voucherNumber,
        credit_account_id: body.credit_account_id,
        debit_account_id: body.debit_account_id,
        entry_date: body.entry_date,
        amount,
        remarks,
        bill_kind: billKind,
        bill_id: billId,
        created_by: authUserId || null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      if (billKind === 'washing' && billId) {
        await trx('laundry_jobs')
          .where({ id: billId, shop_id: shopId })
          .increment('paid_to_washing_amount', amount);
      }

      if (billKind === 'purchase' && billId) {
        const purchase = await trx('purchases').where({ id: billId, shop_id: shopId }).first();
        const nextPaid = round2(Number(purchase?.advance || 0) + amount);
        await trx('purchases').where({ id: billId, shop_id: shopId }).update({
          advance: nextPaid,
          advance_account_id: body.credit_account_id,
          updated_at: trx.fn.now(),
        });
      }

      return buildPaymentVouchersListQuery(shopId).transacting(trx).where('pv.id', id).first();
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) continue;
      throw err;
    }
  }

  throw badRequest('Could not allocate a unique voucher number');
}

export function buildPaymentVouchersListQuery(shopId) {
  return knex('payment_vouchers as pv')
    .where({ 'pv.shop_id': shopId })
    .leftJoin('payment_accounts as ca', function joinCa() {
      this.on('ca.shop_id', '=', 'pv.shop_id').andOn('ca.id', '=', 'pv.credit_account_id');
    })
    .leftJoin('payment_accounts as da', function joinDa() {
      this.on('da.shop_id', '=', 'pv.shop_id').andOn('da.id', '=', 'pv.debit_account_id');
    })
    .leftJoin('purchases as pur', function joinPur() {
      this.on('pur.id', '=', 'pv.bill_id').andOn('pv.bill_kind', '=', knex.raw('?', ['purchase']));
    })
    .leftJoin('laundry_jobs as lj', function joinLj() {
      this.on('lj.id', '=', 'pv.bill_id').andOn('pv.bill_kind', '=', knex.raw('?', ['washing']));
    })
    .select(
      'pv.id',
      'pv.shop_id',
      'pv.voucher_number',
      'pv.credit_account_id',
      'pv.debit_account_id',
      'pv.entry_date',
      'pv.amount',
      'pv.remarks',
      'pv.bill_kind',
      'pv.bill_id',
      'pv.created_by',
      'pv.created_at',
      'pv.updated_at',
      knex.raw('ca.name as credit_account_name'),
      knex.raw('da.name as debit_account_name'),
      knex.raw('pur.purchase_number as purchase_bill_number'),
      knex.raw('lj.job_no as washing_bill_number')
    );
}

export async function getPaymentVoucherRow(shopId, id) {
  return buildPaymentVouchersListQuery(shopId).where('pv.id', id).first();
}

export async function listPaymentVouchers(shopId, query) {
  const qb = buildPaymentVouchersListQuery(shopId);
  if (query.from) qb.andWhere('pv.entry_date', '>=', query.from);
  if (query.to) qb.andWhere('pv.entry_date', '<=', query.to);
  if (query.entry_date) qb.andWhere('pv.entry_date', query.entry_date);
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-pv.entry_date',
    search_fields: ['pv.voucher_number', 'pv.remarks', 'ca.name', 'da.name'],
  });
}

export async function createPaymentVoucher(shopId, authUserId, body) {
  const remarks = normalizeRemarks(body);
  const billKind = body.bill_kind || 'none';
  const amount = Number(body.amount);
  if (Number.isNaN(amount) || amount <= 0) throw badRequest('Invalid amount');

  const billIds = resolveBillIds(body);

  return knex.transaction(async (trx) => {
    await assertPaymentVoucherAccounts(trx, shopId, body);

    if (billIds.length > 1) {
      if (billKind !== 'washing' && billKind !== 'purchase') {
        throw badRequest('Bill kind must be purchase or washing for multiple bills');
      }

      const remainings = [];
      for (const billId of billIds) {
        const remaining = await getBillRemaining(
          trx,
          shopId,
          billKind,
          billId,
          body.debit_account_id
        );
        remainings.push({ billId, remaining });
      }

      const totalRemaining = round2(remainings.reduce((sum, r) => sum + r.remaining, 0));
      if (Math.abs(totalRemaining - round2(amount)) > 1e-6) {
        throw badRequest('Amount must equal the total of selected bill balances');
      }

      const rows = [];
      for (const { billId, remaining } of remainings) {
        const row = await insertPaymentVoucherForBill(
          trx,
          shopId,
          authUserId,
          body,
          billKind,
          billId,
          remaining,
          remarks
        );
        rows.push(row);
      }

      return { rows, count: rows.length };
    }

    if (billIds.length === 1) {
      const billId = billIds[0];
      if (billKind === 'washing' || billKind === 'purchase') {
        const remaining = await getBillRemaining(
          trx,
          shopId,
          billKind,
          billId,
          body.debit_account_id
        );
        if (amount > remaining + 1e-6) {
          throw badRequest(
            billKind === 'washing'
              ? 'Amount exceeds remaining washing balance for this job'
              : 'Amount exceeds remaining purchase balance'
          );
        }
      }

      const row = await insertPaymentVoucherForBill(
        trx,
        shopId,
        authUserId,
        body,
        billKind,
        billKind === 'washing' || billKind === 'purchase' ? billId : null,
        amount,
        remarks
      );
      return row;
    }

    if (billKind === 'washing' || billKind === 'purchase') {
      throw badRequest(
        billKind === 'washing'
          ? 'Washing bill requires a laundry job'
          : 'Purchase bill requires a purchase'
      );
    }

    const row = await insertPaymentVoucherForBill(
      trx,
      shopId,
      authUserId,
      body,
      billKind,
      null,
      amount,
      remarks
    );
    return row;
  });
}

export async function deletePaymentVoucher(shopId, id) {
  return knex.transaction(async (trx) => {
    const existing = await trx('payment_vouchers')
      .where({ shop_id: shopId, id })
      .forUpdate()
      .first();
    if (!existing) throw notFound('Payment voucher not found');

    if (existing.bill_kind === 'washing' && existing.bill_id) {
      const amt = Number(existing.amount || 0);
      await trx('laundry_jobs')
        .where({ id: existing.bill_id, shop_id: shopId })
        .update({
          paid_to_washing_amount: knex.raw('GREATEST(0, paid_to_washing_amount - ?)', [amt]),
          updated_at: trx.fn.now(),
        });
    }

    if (existing.bill_kind === 'purchase' && existing.bill_id) {
      const amt = Number(existing.amount || 0);
      await trx('purchases')
        .where({ id: existing.bill_id, shop_id: shopId })
        .update({
          advance: knex.raw('GREATEST(0, advance - ?)', [amt]),
          updated_at: trx.fn.now(),
        });
    }

    await trx('payment_vouchers').where({ shop_id: shopId, id }).delete();
    return existing;
  });
}

async function reversePaymentVoucherSettlement(trx, shopId, existing) {
  if (existing.bill_kind === 'washing' && existing.bill_id) {
    const amt = Number(existing.amount || 0);
    await trx('laundry_jobs')
      .where({ id: existing.bill_id, shop_id: shopId })
      .update({
        paid_to_washing_amount: knex.raw('GREATEST(0, paid_to_washing_amount - ?)', [amt]),
        updated_at: trx.fn.now(),
      });
  }

  if (existing.bill_kind === 'purchase' && existing.bill_id) {
    const amt = Number(existing.amount || 0);
    await trx('purchases')
      .where({ id: existing.bill_id, shop_id: shopId })
      .update({
        advance: knex.raw('GREATEST(0, advance - ?)', [amt]),
        updated_at: trx.fn.now(),
      });
  }
}

async function applyPaymentVoucherSettlement(trx, shopId, body, billKind, billId, amount) {
  if (billKind === 'washing' && billId) {
    await trx('laundry_jobs')
      .where({ id: billId, shop_id: shopId })
      .increment('paid_to_washing_amount', amount);
  }

  if (billKind === 'purchase' && billId) {
    const purchase = await trx('purchases').where({ id: billId, shop_id: shopId }).first();
    const nextPaid = round2(Number(purchase?.advance || 0) + amount);
    await trx('purchases').where({ id: billId, shop_id: shopId }).update({
      advance: nextPaid,
      advance_account_id: body.credit_account_id,
      updated_at: trx.fn.now(),
    });
  }
}

export async function updatePaymentVoucher(shopId, id, authUserId, body) {
  const remarks = normalizeRemarks(body);
  const billKind = body.bill_kind || 'none';
  const amount = Number(body.amount);
  if (Number.isNaN(amount) || amount <= 0) throw badRequest('Invalid amount');

  const billIds = resolveBillIds(body);
  if (billIds.length > 1) throw badRequest('Edit supports a single linked bill only');

  return knex.transaction(async (trx) => {
    const existing = await trx('payment_vouchers')
      .where({ shop_id: shopId, id })
      .forUpdate()
      .first();
    if (!existing) throw notFound('Payment voucher not found');

    await reversePaymentVoucherSettlement(trx, shopId, existing);
    await assertPaymentVoucherAccounts(trx, shopId, body);

    const billId = billIds[0] || null;
    if (billKind === 'washing' || billKind === 'purchase') {
      if (!billId) {
        throw badRequest(
          billKind === 'washing'
            ? 'Washing bill requires a laundry job'
            : 'Purchase bill requires a purchase'
        );
      }
      const remaining = await getBillRemaining(
        trx,
        shopId,
        billKind,
        billId,
        body.debit_account_id
      );
      if (amount > remaining + 1e-6) {
        throw badRequest(
          billKind === 'washing'
            ? 'Amount exceeds remaining washing balance for this job'
            : 'Amount exceeds remaining purchase balance'
        );
      }
    }

    await trx('payment_vouchers')
      .where({ id, shop_id: shopId })
      .update({
        credit_account_id: body.credit_account_id,
        debit_account_id: body.debit_account_id,
        entry_date: body.entry_date,
        amount,
        remarks,
        bill_kind: billKind,
        bill_id: billKind === 'washing' || billKind === 'purchase' ? billId : null,
        updated_at: trx.fn.now(),
      });

    await applyPaymentVoucherSettlement(trx, shopId, body, billKind, billId, amount);

    return buildPaymentVouchersListQuery(shopId).transacting(trx).where('pv.id', id).first();
  });
}
