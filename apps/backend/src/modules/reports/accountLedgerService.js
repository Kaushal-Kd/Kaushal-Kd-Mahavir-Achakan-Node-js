import {
  formatOrderPaymentLedgerDetails,
  normalizeSqlDateToIso,
  resolvePaymentOrderStatus,
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
  VENDOR_PAYMENT_CATEGORIES,
} from './purchasePaymentReportHelpers.js';

const ROW_LIMIT = 500;
const DEBIT_PAYMENT_CATEGORIES = ['advance', 'partial', 'final', 'deposit'];
const CREDIT_PAYMENT_CATEGORIES = ['refund', 'deposit_refund'];

function num(v) {
  return Number(v == null || v === '' ? 0 : v);
}

function dateStr(d) {
  return normalizeSqlDateToIso(d) || '';
}

function resolveLedgerDateTime(createdAt, fallbackDate) {
  return serializeInstant(createdAt) || fallbackDate || '';
}

function refJv(id) {
  const s = String(id || '').replace(/-/g, '');
  return `JV-${s.slice(0, 10)}`;
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

function refRv(id) {
  const s = String(id || '').replace(/-/g, '');
  return `RV-${s.slice(0, 10)}`;
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

async function sumAmount(qb) {
  const row = await qb.sum({ total: 'amount' }).first();
  return num(row?.total);
}

async function movementBefore(shopId, accountId, from) {
  const [
    jvDr,
    jvCr,
    rvDr,
    rvCr,
    iePayDr,
    ieIncCr,
    eeExpDr,
    eePayCr,
    payDr,
    payCr,
    pvDr,
    pvCr,
  ] = await Promise.all([
    sumAmount(
      knex('journal_vouchers')
        .where({ shop_id: shopId, debit_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('journal_vouchers')
        .where({ shop_id: shopId, credit_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('receipt_vouchers')
        .where({ shop_id: shopId, debit_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('receipt_vouchers')
        .where({ shop_id: shopId, credit_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('income_entries')
        .where({ shop_id: shopId, payment_account_id: accountId })
        .modify(excludeConditionIncomeCashLeg)
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('income_entries')
        .where({ shop_id: shopId, income_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('expense_entries')
        .where({ shop_id: shopId, expense_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('expense_entries')
        .where({ shop_id: shopId, payment_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      excludePurchasePayments(
        knex('payments')
          .where({ shop_id: shopId, payment_account_id: accountId, is_deleted: false })
          .whereIn('category', DEBIT_PAYMENT_CATEGORIES)
          .where('payment_date', '<', from),
        ''
      )
    ),
    sumAmount(
      knex('payments')
        .where({ shop_id: shopId, payment_account_id: accountId, is_deleted: false })
        .where('payment_date', '<', from)
        .where(function paymentOut() {
          this.whereIn('category', CREDIT_PAYMENT_CATEGORIES).orWhere(function purchaseOut() {
            this.whereNotNull('purchase_id').whereIn('category', VENDOR_PAYMENT_CATEGORIES);
          });
        })
    ),
    sumAmount(
      knex('payment_vouchers')
        .where({ shop_id: shopId, debit_account_id: accountId })
        .where('entry_date', '<', from)
    ),
    sumAmount(
      knex('payment_vouchers')
        .where({ shop_id: shopId, credit_account_id: accountId })
        .where('entry_date', '<', from)
    ),
  ]);

  const dr = jvDr + rvDr + iePayDr + eeExpDr + payDr + pvDr;
  const cr = jvCr + rvCr + ieIncCr + eePayCr + payCr + pvCr;
  return { dr, cr };
}

function ledgerRow({
  side,
  date,
  ref_no,
  customer_name,
  details,
  amount,
  source,
  source_id,
  order_id = null,
  sale_id = null,
}) {
  return {
    side,
    date: date ?? '',
    ref_no: ref_no || '',
    customer_name: customer_name || '',
    details: details || '',
    amount: num(amount),
    source,
    source_id,
    order_id: order_id || null,
    sale_id: sale_id || null,
  };
}

function rowKey(r) {
  return `${r.source}_${r.source_id}_${r.side}`;
}

async function listJournalLines(shopId, accountId, from, to) {
  const drQ = knex('journal_vouchers as jv')
    .where('jv.shop_id', shopId)
    .andWhere('jv.debit_account_id', accountId)
    .whereBetween('jv.entry_date', [from, to])
    .select('jv.id', 'jv.entry_date', 'jv.created_at', 'jv.amount', 'jv.remarks');

  const crQ = knex('journal_vouchers as jv')
    .where('jv.shop_id', shopId)
    .andWhere('jv.credit_account_id', accountId)
    .whereBetween('jv.entry_date', [from, to])
    .select('jv.id', 'jv.entry_date', 'jv.created_at', 'jv.amount', 'jv.remarks');

  const [drRows, crRows] = await Promise.all([drQ, crQ]);
  const out = [];
  for (const r of drRows) {
    out.push(
      ledgerRow({
        side: 'dr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: refJv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'journal_voucher',
        source_id: r.id,
      })
    );
  }
  for (const r of crRows) {
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: refJv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'journal_voucher',
        source_id: r.id,
      })
    );
  }
  return out;
}

async function listReceiptLines(shopId, accountId, from, to) {
  const drQ = knex('receipt_vouchers as rv')
    .where('rv.shop_id', shopId)
    .andWhere('rv.debit_account_id', accountId)
    .whereBetween('rv.entry_date', [from, to])
    .select('rv.id', 'rv.entry_date', 'rv.created_at', 'rv.amount', 'rv.remarks', 'rv.voucher_number');

  const crQ = knex('receipt_vouchers as rv')
    .where('rv.shop_id', shopId)
    .andWhere('rv.credit_account_id', accountId)
    .whereBetween('rv.entry_date', [from, to])
    .select('rv.id', 'rv.entry_date', 'rv.created_at', 'rv.amount', 'rv.remarks', 'rv.voucher_number');

  const [drRows, crRows] = await Promise.all([drQ, crQ]);
  const out = [];
  for (const r of drRows) {
    out.push(
      ledgerRow({
        side: 'dr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: r.voucher_number || refRv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'receipt_voucher',
        source_id: r.id,
      })
    );
  }
  for (const r of crRows) {
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: r.voucher_number || refRv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'receipt_voucher',
        source_id: r.id,
      })
    );
  }
  return out;
}

async function listPaymentVoucherLines(shopId, accountId, from, to) {
  const drQ = knex('payment_vouchers as pv')
    .where('pv.shop_id', shopId)
    .andWhere('pv.debit_account_id', accountId)
    .whereBetween('pv.entry_date', [from, to])
    .select('pv.id', 'pv.entry_date', 'pv.created_at', 'pv.amount', 'pv.remarks', 'pv.voucher_number');

  const crQ = knex('payment_vouchers as pv')
    .where('pv.shop_id', shopId)
    .andWhere('pv.credit_account_id', accountId)
    .whereBetween('pv.entry_date', [from, to])
    .select('pv.id', 'pv.entry_date', 'pv.created_at', 'pv.amount', 'pv.remarks', 'pv.voucher_number');

  const [drRows, crRows] = await Promise.all([drQ, crQ]);
  const out = [];
  for (const r of drRows) {
    out.push(
      ledgerRow({
        side: 'dr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: r.voucher_number || refPv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'payment_voucher',
        source_id: r.id,
      })
    );
  }
  for (const r of crRows) {
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: r.voucher_number || refPv(r.id),
        customer_name: '',
        details: r.remarks || '',
        amount: r.amount,
        source: 'payment_voucher',
        source_id: r.id,
      })
    );
  }
  return out;
}

async function listIncomeExpenseLines(shopId, accountId, from, to) {
  const ieDrQ = knex('income_entries as ie').modify(excludeConditionIncomeCashLeg, 'ie')
    .where('ie.shop_id', shopId)
    .andWhere('ie.payment_account_id', accountId)
    .whereBetween('ie.entry_date', [from, to])
    .select('ie.id', 'ie.entry_date', 'ie.created_at', 'ie.amount', 'ie.name', 'ie.details');

  const ieCrQ = knex('income_entries as ie')
    .where('ie.shop_id', shopId)
    .andWhere('ie.income_account_id', accountId)
    .whereBetween('ie.entry_date', [from, to])
    .select('ie.id', 'ie.entry_date', 'ie.created_at', 'ie.amount', 'ie.name', 'ie.details');

  const eeDrQ = knex('expense_entries as ee')
    .where('ee.shop_id', shopId)
    .andWhere('ee.expense_account_id', accountId)
    .whereBetween('ee.entry_date', [from, to])
    .select('ee.id', 'ee.entry_date', 'ee.created_at', 'ee.amount', 'ee.name', 'ee.details');

  const eeCrQ = knex('expense_entries as ee')
    .where('ee.shop_id', shopId)
    .andWhere('ee.payment_account_id', accountId)
    .whereBetween('ee.entry_date', [from, to])
    .select('ee.id', 'ee.entry_date', 'ee.created_at', 'ee.amount', 'ee.name', 'ee.details');

  const [ieDr, ieCr, eeDr, eeCr] = await Promise.all([ieDrQ, ieCrQ, eeDrQ, eeCrQ]);
  const out = [];
  for (const r of ieDr) {
    out.push(
      ledgerRow({
        side: 'dr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: refIe(r.id),
        customer_name: '',
        details: [r.name, r.details].filter(Boolean).join(' — ') || r.details || '',
        amount: r.amount,
        source: 'income_entry',
        source_id: r.id,
      })
    );
  }
  for (const r of ieCr) {
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: refIe(r.id),
        customer_name: '',
        details: [r.name, r.details].filter(Boolean).join(' — ') || r.details || '',
        amount: r.amount,
        source: 'income_entry',
        source_id: r.id,
      })
    );
  }
  for (const r of eeDr) {
    out.push(
      ledgerRow({
        side: 'dr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: refEe(r.id),
        customer_name: '',
        details: [r.name, r.details].filter(Boolean).join(' — ') || r.details || '',
        amount: r.amount,
        source: 'expense_entry',
        source_id: r.id,
      })
    );
  }
  for (const r of eeCr) {
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.entry_date),
        ref_no: refEe(r.id),
        customer_name: '',
        details: [r.name, r.details].filter(Boolean).join(' — ') || r.details || '',
        amount: r.amount,
        source: 'expense_entry',
        source_id: r.id,
      })
    );
  }
  return out;
}

async function listPaymentLines(shopId, accountId, from, to) {
  const customerNameSql = knex.raw(
    "COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(pc.name), ''), NULLIF(TRIM(o.pickup_name), ''), NULLIF(TRIM(o.reference_name), ''), NULLIF(TRIM(s.customer_name), ''), '') as ledger_customer_name"
  );

  const drQ = excludePurchasePayments(
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
      .whereIn('p.category', DEBIT_PAYMENT_CATEGORIES)
      .whereBetween('p.payment_date', [from, to])
  )
    .select(
      'p.id',
      'p.payment_date',
      'p.created_at',
      'p.amount',
      'p.notes',
      'p.order_id',
      'p.sale_id',
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

  const crQ = knex('payments as p')
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
    .whereIn('p.category', CREDIT_PAYMENT_CATEGORIES)
    .whereBetween('p.payment_date', [from, to])
    .select(
      'p.id',
      'p.payment_date',
      'p.created_at',
      'p.amount',
      'p.notes',
      'p.category',
      'p.order_id',
      'p.sale_id',
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

  const purchaseCrQ = onlyPurchasePayments(
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
      .whereBetween('p.payment_date', [from, to])
  ).select(
    'p.id',
    'p.payment_date',
    'p.created_at',
    'p.amount',
    'pu.purchase_number',
    'pu.status as purchase_status',
    knex.raw('COALESCE(va.name, ?) as vendor_account_name', [''])
  );

  const [drRows, crRows, purchaseCrRows] = await Promise.all([drQ, crQ, purchaseCrQ]);
  const out = [];
  for (const r of drRows) {
    const billNo =
      String(r.order_number || '').trim() || String(r.sale_number || '').trim() || refPay(r.id);
    const customerNm = String(r.ledger_customer_name || '').trim();
    const billLabel = String(r.order_number || '').trim() || String(r.sale_number || '').trim();
    out.push(
      ledgerRow({
        side: 'dr',
        date: resolveLedgerDateTime(r.created_at, r.payment_date),
        ref_no: billNo,
        customer_name: customerNm,
        details: formatOrderPaymentLedgerDetails(
          billLabel,
          paymentStatusForRow(r),
          false,
          r.notes
        ),
        amount: r.amount,
        source: 'payment',
        source_id: r.id,
        order_id: r.order_id || null,
        sale_id: r.sale_id || null,
      })
    );
  }
  for (const r of crRows) {
    const billNo =
      String(r.order_number || '').trim() || String(r.sale_number || '').trim() || refPay(r.id);
    const customerNm = String(r.ledger_customer_name || '').trim();
    const billLabel = String(r.order_number || '').trim() || String(r.sale_number || '').trim();
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.payment_date),
        ref_no: billNo,
        customer_name: customerNm,
        details: formatOrderPaymentLedgerDetails(
          billLabel,
          paymentStatusForRow(r),
          true,
          r.notes
        ),
        amount: r.amount,
        source: 'payment',
        source_id: r.id,
        order_id: r.order_id || null,
        sale_id: r.sale_id || null,
      })
    );
  }
  for (const r of purchaseCrRows) {
    const billNo = String(r.purchase_number || '').trim() || refPay(r.id);
    const vendorNm = String(r.vendor_account_name || '').trim();
    out.push(
      ledgerRow({
        side: 'cr',
        date: resolveLedgerDateTime(r.created_at, r.payment_date),
        ref_no: billNo,
        customer_name: vendorNm,
        details: formatPurchasePaymentDetails(r.purchase_number || '', r.purchase_status || null),
        amount: r.amount,
        source: 'payment',
        source_id: r.id,
      })
    );
  }
  return out;
}

function sortLedgerAsc(rows) {
  return [...rows].sort((a, b) => {
    const c = String(a.date).localeCompare(String(b.date));
    if (c !== 0) return c;
    return String(a.ref_no).localeCompare(String(b.ref_no));
  });
}

function splitSides(rows) {
  const dr = [];
  const cr = [];
  for (const r of rows) {
    if (r.side === 'dr') dr.push(r);
    else cr.push(r);
  }
  return { dr: sortLedgerAsc(dr), cr: sortLedgerAsc(cr) };
}

function stripSideForResponse(r) {
  const { side: _side, ...rest } = r;
  return { ...rest, row_id: rowKey(r) };
}

function signedSideLabel(signed) {
  if (Math.abs(signed) < 1e-9) return { amount: 0, side: 'flat' };
  return {
    amount: Math.abs(signed),
    side: signed >= 0 ? 'Dr' : 'Cr',
  };
}

/**
 * @param {string} shopId
 * @param {{ account_id: string; from: string; to: string }} query
 */
export async function getAccountLedgerReport(shopId, query) {
  const { account_id: accountId, from, to } = query;

  const account = await knex('payment_accounts').where({ shop_id: shopId, id: accountId }).first();
  if (!account) throw badRequest('Unknown account');
  if (!account.is_active) throw badRequest('Account is inactive');

  const ob = num(account.opening_balance);
  const { dr: beforeDr, cr: beforeCr } = await movementBefore(shopId, accountId, from);
  /** Positive signed = net debit balance (Dr). */
  const openingSigned = ob + beforeDr - beforeCr;

  const [jv, rv, pv, ieee, pay] = await Promise.all([
    listJournalLines(shopId, accountId, from, to),
    listReceiptLines(shopId, accountId, from, to),
    listPaymentVoucherLines(shopId, accountId, from, to),
    listIncomeExpenseLines(shopId, accountId, from, to),
    listPaymentLines(shopId, accountId, from, to),
  ]);

  const allPeriod = [...jv, ...rv, ...pv, ...ieee, ...pay];
  const periodDrTotal = allPeriod.filter((r) => r.side === 'dr').reduce((s, r) => s + num(r.amount), 0);
  const periodCrTotal = allPeriod.filter((r) => r.side === 'cr').reduce((s, r) => s + num(r.amount), 0);

  const closingSigned = openingSigned + periodDrTotal - periodCrTotal;

  const { dr, cr } = splitSides(allPeriod);
  const dr_rows = dr.slice(0, ROW_LIMIT).map(stripSideForResponse);
  const cr_rows = cr.slice(0, ROW_LIMIT).map(stripSideForResponse);

  const openingFmt = signedSideLabel(openingSigned);
  const closingFmt = signedSideLabel(closingSigned);

  return {
    range: { from, to },
    account: { id: account.id, name: account.name || account.id },
    summary: {
      from_period: from,
      to_period: to,
      opening_balance: openingFmt.amount,
      opening_side: openingFmt.side,
      closing_balance: closingFmt.amount,
      closing_side: closingFmt.side,
      period_dr_total: periodDrTotal,
      period_cr_total: periodCrTotal,
    },
    dr_rows,
    cr_rows,
    meta: { row_limit: ROW_LIMIT },
  };
}
