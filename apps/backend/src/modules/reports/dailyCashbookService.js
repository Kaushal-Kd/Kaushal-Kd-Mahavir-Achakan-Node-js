import {
  formatOrderPaymentLedgerDetails,
  resolvePaymentOrderStatus,
  todayIndiaISODate,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { excludeConditionIncomeCashLeg } from '../security-charges/ledgerPredicates.js';
import { badRequest } from '../../utils/errors.js';
import { serializeInstant } from '../../utils/serializeInstant.js';
import { sqlFollowUpOrderPaymentSelect, sqlPaymentOrderStatusSelect } from './orderPaymentReportHelpers.js';
import {
  excludePurchasePayments,
  formatPurchasePaymentDetails,
  onlyPurchasePayments,
} from './purchasePaymentReportHelpers.js';
import { buildCashAccountState, latestCloseForDate } from './cashReconciliationService.js';

const INCOME_PAYMENT_CATEGORIES = ['advance', 'partial', 'final', 'deposit'];
const EXPENSE_PAYMENT_CATEGORIES = ['refund', 'deposit_refund'];
const ROW_LIMIT = 500;

function num(v) {
  return Number(v == null || v === '' ? 0 : v);
}

function refIe(id) {
  const s = String(id || '').replace(/-/g, '');
  return `IE-${s.slice(0, 10)}`;
}

function refEe(id) {
  const s = String(id || '').replace(/-/g, '');
  return `EE-${s.slice(0, 10)}`;
}

function refPay(id) {
  const s = String(id || '').replace(/-/g, '');
  return `PAY-${s.slice(0, 10)}`;
}

function refPv(id) {
  const s = String(id || '').replace(/-/g, '');
  return `PV-${s.slice(0, 10)}`;
}

function paymentStatusForRow(r) {
  return resolvePaymentOrderStatus({
    order_status_at_payment: r.order_status_at_payment,
    payment_stage: r.payment_stage,
    created_at: r.created_at,
    delivered_at: r.order_delivered_at,
    returned_at: r.order_returned_at,
    packed_at: r.order_packed_at,
    order_status: r.order_status,
    is_follow_up_order_payment: r.is_follow_up_order_payment,
  });
}

function cashbookLine({
  ref_no,
  customer_name,
  details,
  amount,
  source,
  source_id,
  created_at,
  entry_date,
  payment_date,
}) {
  return {
    ref_no: ref_no || '',
    customer_name: customer_name || '',
    details: details || '',
    amount: num(amount),
    row_id: `${source}_${source_id}`,
    created_at: serializeInstant(created_at) || created_at || null,
    entry_date: entry_date || payment_date || null,
    payment_date: payment_date || entry_date || null,
  };
}

function lineSortKey(row) {
  return String(row.created_at || row.entry_date || row.payment_date || row.ref_no || '');
}

function sortLines(rows) {
  return [...rows].sort((a, b) => lineSortKey(b).localeCompare(lineSortKey(a)));
}

function capLines(rows) {
  const sorted = sortLines(rows);
  return sorted.slice(0, ROW_LIMIT);
}

/**
 * Single-day cash movement per payment account (same sources as income/expense summary branches).
 *
 * @param {string} shopId
 * @param {{ date?: string }} query
 */
export async function getDailyCashbookReport(shopId, query) {
  const date =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(String(query.date))
      ? String(query.date).slice(0, 10)
      : todayIndiaISODate();

  const accounts = await knex('payment_accounts')
    .where({ shop_id: shopId, is_active: true })
    .orderBy('name', 'asc')
    .select('id', 'name', 'account_group', 'account_type', 'opening_balance');

  const [
    incomePaymentAgg,
    incomeEntryAgg,
    expensePaymentAgg,
    purchasePaymentAgg,
    expenseEntryAgg,
    paymentVoucherAgg,
  ] = await Promise.all([
    excludePurchasePayments(
      knex('payments')
        .where({ shop_id: shopId, is_deleted: false })
        .where('payment_date', date)
        .whereIn('category', INCOME_PAYMENT_CATEGORIES)
        .whereNotNull('payment_account_id'),
      ''
    )
      .groupBy('payment_account_id')
      .select('payment_account_id as account_id', knex.raw('SUM(amount) as total')),
knex('income_entries').modify(excludeConditionIncomeCashLeg)
      .where({ shop_id: shopId })
      .where('entry_date', date)
      .whereNotNull('payment_account_id')
      .groupBy('payment_account_id')
      .select('payment_account_id as account_id', knex.raw('SUM(amount) as total')),
    knex('payments')
      .where({ shop_id: shopId, is_deleted: false })
      .where('payment_date', date)
      .whereIn('category', EXPENSE_PAYMENT_CATEGORIES)
      .whereNotNull('payment_account_id')
      .groupBy('payment_account_id')
      .select('payment_account_id as account_id', knex.raw('SUM(amount) as total')),
    onlyPurchasePayments(
      knex('payments')
        .where({ shop_id: shopId, is_deleted: false })
        .where('payment_date', date)
        .whereNotNull('payment_account_id'),
      ''
    )
      .groupBy('payment_account_id')
      .select('payment_account_id as account_id', knex.raw('SUM(amount) as total')),
    knex('expense_entries')
      .where({ shop_id: shopId })
      .where('entry_date', date)
      .whereNotNull('payment_account_id')
      .groupBy('payment_account_id')
      .select('payment_account_id as account_id', knex.raw('SUM(amount) as total')),
    knex('payment_vouchers')
      .where({ shop_id: shopId })
      .where('entry_date', date)
      .whereNotNull('credit_account_id')
      .groupBy('credit_account_id')
      .select('credit_account_id as account_id', knex.raw('SUM(amount) as total')),
  ]);

  const sums = new Map();
  for (const a of accounts) {
    sums.set(String(a.id), { income: 0, expense: 0 });
  }

  const bumpIncome = (accountId, amount) => {
    if (!accountId) return;
    const id = String(accountId);
    if (!sums.has(id)) return;
    const cur = sums.get(id);
    cur.income += num(amount);
  };

  const bumpExpense = (accountId, amount) => {
    if (!accountId) return;
    const id = String(accountId);
    if (!sums.has(id)) return;
    const cur = sums.get(id);
    cur.expense += num(amount);
  };

  for (const row of incomePaymentAgg) bumpIncome(row.account_id, row.total);
  for (const row of incomeEntryAgg) bumpIncome(row.account_id, row.total);
  for (const row of expensePaymentAgg) bumpExpense(row.account_id, row.total);
  for (const row of purchasePaymentAgg) bumpExpense(row.account_id, row.total);
  for (const row of expenseEntryAgg) bumpExpense(row.account_id, row.total);
  for (const row of paymentVoucherAgg) bumpExpense(row.account_id, row.total);

  const accountRows = await Promise.all(accounts.map(async (a) => {
    const s = sums.get(String(a.id)) || { income: 0, expense: 0 };
    const income = num(s.income);
    const expense = num(s.expense);
    const row = {
      id: a.id,
      name: String(a.name || '').trim() || a.id,
      account_group: String(a.account_group || '').trim(),
      account_type: a.account_type || 'other',
      income,
      expense,
      has_activity: income > 1e-9 || expense > 1e-9,
    };
    if (row.account_type === 'cash') {
      const snapshot = await buildCashAccountState({ shopId, account: a, date, income, expense });
      const close = await latestCloseForDate(shopId, a.id, date);
      const stale = !!close && close.movement_fingerprint !== snapshot.movement_fingerprint;
      Object.assign(row, snapshot, {
        close: close
          ? {
              ...close,
              status: stale ? 'stale' : close.status,
              is_stale: stale,
            }
          : null,
      });
    }
    return row;
  }));

  const totals = accountRows.reduce(
    (acc, r) => {
      acc.income += r.income;
      acc.expense += r.expense;
      return acc;
    },
    { income: 0, expense: 0 }
  );

  const activeAccounts = accountRows.filter((r) => r.has_activity || r.account_type === 'cash');

  return {
    date,
    accounts: activeAccounts,
    summary: {
      income_total: totals.income,
      expense_total: totals.expense,
      net: totals.income - totals.expense,
    },
  };
}

/**
 * Line-level bifurcation for one payment account on one day (same sources as getDailyCashbookReport).
 *
 * @param {string} shopId
 * @param {{ date: string; account_id: string }} query
 */
export async function getDailyCashbookAccountLines(shopId, query) {
  const date =
    query.date && /^\d{4}-\d{2}-\d{2}$/.test(String(query.date))
      ? String(query.date).slice(0, 10)
      : todayIndiaISODate();
  const accountId = String(query.account_id || '').trim();

  const account = await knex('payment_accounts').where({ shop_id: shopId, id: accountId }).first();
  if (!account) throw badRequest('Unknown account');
  if (!account.is_active) throw badRequest('Account is inactive');

  const customerNameSql = knex.raw(
    "COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(pc.name), ''), NULLIF(TRIM(o.pickup_name), ''), NULLIF(TRIM(o.reference_name), ''), NULLIF(TRIM(s.customer_name), ''), '') as ledger_customer_name"
  );

  const incomePaymentQ = excludePurchasePayments(
    knex('payments as p')
      .leftJoin('orders as o', function joinO() {
        this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
      })
      .leftJoin('customers as c', function joinC() {
        this.on('c.shop_id', '=', 'o.shop_id').andOn('c.id', '=', 'o.customer_id');
      })
      .leftJoin('customers as pc', function joinPc() {
        this.on('pc.shop_id', '=', 'p.shop_id').andOn('pc.id', '=', 'p.customer_id');
      })
      .leftJoin('sales as s', function joinS() {
        this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
      })
      .where('p.shop_id', shopId)
      .andWhere('p.payment_account_id', accountId)
      .where('p.is_deleted', false)
      .whereIn('p.category', INCOME_PAYMENT_CATEGORIES)
      .where('p.payment_date', date)
  ).select(
    'p.id',
    'p.amount',
    'p.notes',
    'p.payment_date',
    'p.created_at',
    'o.order_number',
    'o.status as order_status',
    'o.delivered_at as order_delivered_at',
    'o.returned_at as order_returned_at',
    'o.packed_at as order_packed_at',
    'p.order_status_at_payment',
    'p.payment_stage',
    sqlPaymentOrderStatusSelect(knex),
    sqlFollowUpOrderPaymentSelect(knex),
    's.sale_number',
    customerNameSql
  );

  const incomeEntryQ = knex('income_entries as ie').modify(excludeConditionIncomeCashLeg, 'ie')
    .where('ie.shop_id', shopId)
    .andWhere('ie.payment_account_id', accountId)
    .where('ie.entry_date', date)
    .select('ie.id', 'ie.amount', 'ie.name', 'ie.details', 'ie.entry_date', 'ie.created_at');

  const expenseRefundQ = knex('payments as p')
    .leftJoin('orders as o', function joinO() {
      this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
    })
    .leftJoin('customers as c', function joinC() {
      this.on('c.shop_id', '=', 'o.shop_id').andOn('c.id', '=', 'o.customer_id');
    })
    .leftJoin('customers as pc', function joinPc() {
      this.on('pc.shop_id', '=', 'p.shop_id').andOn('pc.id', '=', 'p.customer_id');
    })
    .leftJoin('sales as s', function joinS() {
      this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
    })
    .where('p.shop_id', shopId)
    .andWhere('p.payment_account_id', accountId)
    .where('p.is_deleted', false)
    .whereNull('p.purchase_id')
    .whereIn('p.category', EXPENSE_PAYMENT_CATEGORIES)
    .where('p.payment_date', date)
    .select(
      'p.id',
      'p.amount',
      'p.notes',
      'p.payment_date',
      'p.created_at',
      'o.order_number',
      'o.status as order_status',
      'o.delivered_at as order_delivered_at',
      'o.returned_at as order_returned_at',
      'o.packed_at as order_packed_at',
      'p.order_status_at_payment',
      'p.payment_stage',
      sqlPaymentOrderStatusSelect(knex),
      sqlFollowUpOrderPaymentSelect(knex),
      's.sale_number',
      customerNameSql
    );

  const expensePurchaseQ = onlyPurchasePayments(
    knex('payments as p')
      .leftJoin('purchases as pu', function joinPu() {
        this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
      })
      .leftJoin('payment_accounts as va', function joinVa() {
        this.on('va.shop_id', '=', 'pu.shop_id').andOn('va.id', '=', 'pu.vendor_account_id');
      })
      .where('p.shop_id', shopId)
      .andWhere('p.payment_account_id', accountId)
      .where('p.is_deleted', false)
      .where('p.payment_date', date)
  ).select(
    'p.id',
    'p.amount',
    'p.payment_date',
    'p.created_at',
    'pu.purchase_number',
    'pu.status as purchase_status',
    knex.raw('COALESCE(va.name, ?) as vendor_account_name', [''])
  );

  const expenseEntryQ = knex('expense_entries as ee')
    .where('ee.shop_id', shopId)
    .andWhere('ee.payment_account_id', accountId)
    .where('ee.entry_date', date)
    .select('ee.id', 'ee.amount', 'ee.name', 'ee.details', 'ee.entry_date', 'ee.created_at');

  const paymentVoucherQ = knex('payment_vouchers as pv')
    .where('pv.shop_id', shopId)
    .andWhere('pv.credit_account_id', accountId)
    .where('pv.entry_date', date)
    .select('pv.id', 'pv.amount', 'pv.remarks', 'pv.voucher_number', 'pv.entry_date', 'pv.created_at');

  const [incomePayments, incomeEntries, expenseRefunds, expensePurchases, expenseEntries, paymentVouchers] =
    await Promise.all([
      incomePaymentQ,
      incomeEntryQ,
      expenseRefundQ,
      expensePurchaseQ,
      expenseEntryQ,
      paymentVoucherQ,
    ]);

  const incomeRaw = [];
  for (const r of incomePayments) {
    const billNo =
      String(r.order_number || '').trim() || String(r.sale_number || '').trim() || refPay(r.id);
    const billLabel = String(r.order_number || '').trim() || String(r.sale_number || '').trim();
    incomeRaw.push(
      cashbookLine({
        ref_no: billNo,
        customer_name: String(r.ledger_customer_name || '').trim(),
        details: formatOrderPaymentLedgerDetails(
          billLabel,
          paymentStatusForRow(r),
          false,
          r.notes
        ),
        amount: r.amount,
        source: 'payment',
        source_id: r.id,
        created_at: serializeInstant(r.created_at),
        payment_date: r.payment_date,
      })
    );
  }
  for (const r of incomeEntries) {
    incomeRaw.push(
      cashbookLine({
        ref_no: refIe(r.id),
        customer_name: r.name || '',
        details: r.details || '',
        amount: r.amount,
        source: 'income_entry',
        source_id: r.id,
        created_at: serializeInstant(r.created_at),
        entry_date: r.entry_date,
      })
    );
  }

  const expenseRaw = [];
  for (const r of expenseRefunds) {
    const billNo =
      String(r.order_number || '').trim() || String(r.sale_number || '').trim() || refPay(r.id);
    const billLabel = String(r.order_number || '').trim() || String(r.sale_number || '').trim();
    expenseRaw.push(
      cashbookLine({
        ref_no: billNo,
        customer_name: String(r.ledger_customer_name || '').trim(),
        details: formatOrderPaymentLedgerDetails(
          billLabel,
          paymentStatusForRow(r),
          true,
          r.notes
        ),
        amount: r.amount,
        source: 'payment',
        source_id: r.id,
        created_at: serializeInstant(r.created_at),
        payment_date: r.payment_date,
      })
    );
  }
  for (const r of expensePurchases) {
    const billNo = String(r.purchase_number || '').trim() || refPay(r.id);
    expenseRaw.push(
      cashbookLine({
        ref_no: billNo,
        customer_name: String(r.vendor_account_name || '').trim(),
        details: formatPurchasePaymentDetails(r.purchase_number || '', r.purchase_status || null),
        amount: r.amount,
        source: 'payment',
        source_id: r.id,
        created_at: serializeInstant(r.created_at),
        payment_date: r.payment_date,
      })
    );
  }
  for (const r of expenseEntries) {
    expenseRaw.push(
      cashbookLine({
        ref_no: refEe(r.id),
        customer_name: r.name || '',
        details: r.details || '',
        amount: r.amount,
        source: 'expense_entry',
        source_id: r.id,
        created_at: serializeInstant(r.created_at),
        entry_date: r.entry_date,
      })
    );
  }
  for (const r of paymentVouchers) {
    expenseRaw.push(
      cashbookLine({
        ref_no: r.voucher_number || refPv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'payment_voucher',
        source_id: r.id,
        created_at: serializeInstant(r.created_at),
        entry_date: r.entry_date,
      })
    );
  }

  const income_lines = capLines(incomeRaw);
  const expense_lines = capLines(expenseRaw);
  const income_total = incomeRaw.reduce((s, r) => s + num(r.amount), 0);
  const expense_total = expenseRaw.reduce((s, r) => s + num(r.amount), 0);

  return {
    date,
    account: { id: account.id, name: String(account.name || '').trim() || account.id },
    income_lines,
    expense_lines,
    summary: {
      income_total,
      expense_total,
      net: income_total - expense_total,
    },
    meta: {
      row_limit: ROW_LIMIT,
      income_truncated: incomeRaw.length > ROW_LIMIT,
      expense_truncated: expenseRaw.length > ROW_LIMIT,
    },
  };
}
