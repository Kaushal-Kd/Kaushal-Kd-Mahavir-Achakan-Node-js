import crypto from 'node:crypto';

import { addDays, normalizeSqlDateToIso, round2 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { excludeConditionIncomeCashLeg } from '../security-charges/ledgerPredicates.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';

import { excludePurchasePayments, onlyPurchasePayments } from './purchasePaymentReportHelpers.js';

const INCOME_PAYMENT_CATEGORIES = ['advance', 'partial', 'final', 'deposit'];
const EXPENSE_PAYMENT_CATEGORIES = ['refund', 'deposit_refund'];

function num(value) {
  return Number(value == null || value === '' ? 0 : value);
}

export function calculateCashClosing(openingCash, incomeTotal, expenseTotal, countedClosing = null) {
  const opening = round2(num(openingCash));
  const income = round2(num(incomeTotal));
  const expense = round2(num(expenseTotal));
  const expected = round2(opening + income - expense);
  return {
    opening_cash: opening,
    income_total: income,
    expense_total: expense,
    expected_closing: expected,
    ...(countedClosing == null
      ? {}
      : {
          counted_closing: round2(num(countedClosing)),
          variance: round2(num(countedClosing) - expected),
        }),
  };
}

async function sumFirst(query) {
  const row = await query.sum({ total: 'amount' }).first();
  return num(row?.total);
}

async function movements(shopId, accountId, from, to, trx = knex) {
  if (!from || !to || from > to) return { income: 0, expense: 0 };
  const [paymentsIn, incomeEntries, refunds, purchases, expenseEntries, vouchers] =
    await Promise.all([
      sumFirst(
        excludePurchasePayments(
          trx('payments')
            .where({ shop_id: shopId, payment_account_id: accountId, is_deleted: false })
            .whereIn('category', INCOME_PAYMENT_CATEGORIES)
            .whereBetween('payment_date', [from, to]),
          ''
        )
      ),
      sumFirst(
        trx('income_entries').modify(excludeConditionIncomeCashLeg)
          .where({ shop_id: shopId, payment_account_id: accountId })
          .whereBetween('entry_date', [from, to])
      ),
      sumFirst(
        trx('payments')
          .where({ shop_id: shopId, payment_account_id: accountId, is_deleted: false })
          .whereNull('purchase_id')
          .whereIn('category', EXPENSE_PAYMENT_CATEGORIES)
          .whereBetween('payment_date', [from, to])
      ),
      sumFirst(
        onlyPurchasePayments(
          trx('payments')
            .where({ shop_id: shopId, payment_account_id: accountId, is_deleted: false })
            .whereBetween('payment_date', [from, to]),
          ''
        )
      ),
      sumFirst(
        trx('expense_entries')
          .where({ shop_id: shopId, payment_account_id: accountId })
          .whereBetween('entry_date', [from, to])
      ),
      sumFirst(
        trx('payment_vouchers')
          .where({ shop_id: shopId, credit_account_id: accountId })
          .whereBetween('entry_date', [from, to])
      ),
    ]);
  return {
    income: round2(paymentsIn + incomeEntries),
    expense: round2(refunds + purchases + expenseEntries + vouchers),
  };
}

function fingerprint(payload) {
  return crypto
    .createHash('sha256')
    .update(
      [
        payload.shop_id,
        payload.payment_account_id,
        payload.business_date,
        payload.opening_cash.toFixed(2),
        payload.income_total.toFixed(2),
        payload.expense_total.toFixed(2),
        payload.expected_closing.toFixed(2),
      ].join('|')
    )
    .digest('hex');
}

export async function buildCashAccountState({ shopId, account, date, income, expense, trx = knex }) {
  const previous = await trx('cash_counter_reconciliations')
    .where({ shop_id: shopId, payment_account_id: account.id })
    .where('business_date', '<', date)
    .whereIn('status', ['closed', 'stale'])
    .orderBy('business_date', 'desc')
    .orderBy('version', 'desc')
    .first();

  let opening = num(account.opening_balance);
  if (previous) {
    const previousBusinessDate = normalizeSqlDateToIso(previous.business_date);
    if (!previousBusinessDate) throw badRequest('Previous cash close has an invalid business date');
    const gap = await movements(
      shopId,
      account.id,
      addDays(previousBusinessDate, 1),
      addDays(date, -1),
      trx
    );
    opening = num(previous.counted_closing) + gap.income - gap.expense;
  }
  const totals = calculateCashClosing(opening, income, expense);
  const snapshot = {
    shop_id: shopId,
    payment_account_id: account.id,
    business_date: date,
    ...totals,
  };
  return { ...snapshot, movement_fingerprint: fingerprint(snapshot) };
}

export async function latestCloseForDate(shopId, accountId, date, trx = knex) {
  return trx('cash_counter_reconciliations')
    .where({ shop_id: shopId, payment_account_id: accountId, business_date: date })
    .orderBy('version', 'desc')
    .first();
}

export async function createCashReconciliation({ shopId, userId, body, authorizeRevision }) {
  const replay = await knex('cash_counter_reconciliations')
    .where({ shop_id: shopId, idempotency_key: body.idempotency_key })
    .first();
  if (replay) return { ...replay, replayed: true };

  return knex.transaction(async (trx) => {
    const account = await trx('payment_accounts')
      .where({ shop_id: shopId, id: body.payment_account_id, is_active: true })
      .forUpdate()
      .first();
    if (!account) throw notFound('Cash counter account not found');
    if (account.account_type !== 'cash') throw badRequest('Only cash accounts can be reconciled');
    const lockedReplay = await trx('cash_counter_reconciliations')
      .where({ shop_id: shopId, idempotency_key: body.idempotency_key })
      .first();
    if (lockedReplay) return { ...lockedReplay, replayed: true };

    const dayMovement = await movements(
      shopId,
      account.id,
      body.business_date,
      body.business_date,
      trx
    );
    const snapshot = await buildCashAccountState({
      shopId,
      account,
      date: body.business_date,
      income: dayMovement.income,
      expense: dayMovement.expense,
      trx,
    });
    if (snapshot.movement_fingerprint !== body.expected_total_fingerprint) {
      throw conflict('Cash movements changed. Refresh the cashbook and count again.');
    }

    const previous = await latestCloseForDate(shopId, account.id, body.business_date, trx);
    if (previous && !String(body.revision_reason || '').trim()) {
      throw badRequest('Revision reason is required');
    }
    if (previous) {
      if (!body.admin_password) {
        throw badRequest('Master Password is required to revise this cash counter close');
      }
      await authorizeRevision?.(body.admin_password);
    }
    if (previous) {
      await trx('cash_counter_reconciliations').where({ id: previous.id }).update({ status: 'replaced' });
    }

    const countedTotals = calculateCashClosing(
      snapshot.opening_cash,
      snapshot.income_total,
      snapshot.expense_total,
      body.counted_closing
    );
    const row = {
      id: uuid(),
      ...snapshot,
      counted_closing: countedTotals.counted_closing,
      variance: countedTotals.variance,
      version: num(previous?.version) + 1,
      idempotency_key: body.idempotency_key,
      status: 'closed',
      notes: body.notes || null,
      revision_reason: previous ? body.revision_reason : null,
      supersedes_id: previous?.id || null,
      closed_by_user_id: userId,
      closed_at: trx.fn.now(),
      created_at: trx.fn.now(),
    };
    await trx('cash_counter_reconciliations').insert(row);
    return { ...row, replayed: false };
  });
}

export async function listCashReconciliations(shopId, query) {
  const qb = knex('cash_counter_reconciliations as r')
    .join('payment_accounts as pa', function joinAccount() {
      this.on('pa.shop_id', '=', 'r.shop_id').andOn('pa.id', '=', 'r.payment_account_id');
    })
    .leftJoin('users as u', 'u.id', 'r.closed_by_user_id')
    .where('r.shop_id', shopId)
    .select('r.*', 'pa.name as account_name', 'u.name as closed_by_name')
    .orderBy('r.business_date', 'desc')
    .orderBy('r.version', 'desc');
  if (query.date) qb.andWhere('r.business_date', query.date);
  if (query.payment_account_id) qb.andWhere('r.payment_account_id', query.payment_account_id);
  return qb;
}

export { movements as getCashAccountMovements };
