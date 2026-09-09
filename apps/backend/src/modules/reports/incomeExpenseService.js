import {
  formatOrderPaymentExpenseDetails,
  formatOrderPaymentIncomeDetails,
  isDamageChargePayment,
  isOrderRentPaymentTransactionType,
  normalizeSqlDateToIso,
  orderPaymentDisplayStatusForFilter,
  resolvePaymentOrderStatus,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { serializeInstant } from '../../utils/serializeInstant.js';
import { excludeConditionPaymentMovements } from '../security-charges/ledgerPredicates.js';

import {
  sqlBookingPartForPayment,
  sqlFollowUpOrderPaymentSelect,
  sqlPaymentOrderStatusExpr,
  sqlPaymentOrderStatusSelect,
} from './orderPaymentReportHelpers.js';
import {
  excludePurchasePayments,
  formatPurchasePaymentDetails,
  onlyPurchasePayments,
} from './purchasePaymentReportHelpers.js';

const INCOME_PAYMENT_CATEGORIES = ['advance', 'partial', 'final'];
const EXPENSE_PAYMENT_CATEGORIES = ['refund'];
const ROW_LIMIT = 500;
const PER_BRANCH_LIMIT = 500;

function cashBankCaseSum(amountCol) {
  return {
    cash: knex.raw(
      `SUM(CASE WHEN LOWER(TRIM(pa.account_group)) = 'cash accounts' THEN ${amountCol} ELSE 0 END) as cash`
    ),
    bank: knex.raw(
      `SUM(CASE WHEN LOWER(TRIM(pa.account_group)) = 'bank accounts' THEN ${amountCol} ELSE 0 END) as bank`
    ),
    total: knex.raw(`SUM(${amountCol}) as total`),
  };
}

function num(v) {
  return Number(v == null ? 0 : v);
}

function addBuckets(a, b) {
  return {
    cash: num(a.cash) + num(b.cash),
    bank: num(a.bank) + num(b.bank),
    total: num(a.total) + num(b.total),
  };
}

function applySearchLike(qb, search, orCallback) {
  const t = search?.trim();
  if (!t) return;
  const like = `%${t}%`;
  qb.andWhere(function inner() {
    orCallback(this, like);
  });
}

function sqlBookingPart() {
  return sqlBookingPartForPayment();
}

function addFormattedIncomePaymentDetailsSearch(b, like) {
  const bookingPart = sqlBookingPart();
  b.orWhereRaw(
    `CONCAT(
      COALESCE(o.order_number, ''),
      CASE
        WHEN p.order_id IS NULL THEN ''
        WHEN p.notes LIKE ? OR p.notes LIKE ? THEN CONCAT(
          CASE WHEN COALESCE(o.order_number, '') <> '' THEN ' - ' ELSE '' END,
          'DAMAGE / MISSING CHARGE (', ${bookingPart}, ')'
        )
        ELSE CONCAT(
          CASE WHEN COALESCE(o.order_number, '') <> '' THEN ' - ' ELSE '' END,
          'PAYMENT (', ${bookingPart}, ')'
        )
      END
    ) LIKE ?`,
    ['%Damage charge%', '%damage_item:%', like]
  );
  b.orWhereRaw(
    `CONCAT(
      COALESCE(s.sale_number, ''),
      CASE WHEN p.sale_id IS NOT NULL THEN CONCAT(
        CASE WHEN COALESCE(s.sale_number, '') <> '' THEN ' - ' ELSE '' END,
        'PAYMENT (SALE - ', UPPER(COALESCE(s.status, 'ACTIVE')), ')'
      ) ELSE '' END
    ) LIKE ?`,
    [like]
  );
}

function addFormattedExpensePaymentDetailsSearch(b, like) {
  const bookingPart = sqlBookingPart();
  b.orWhereRaw(
    `CONCAT(
      COALESCE(o.order_number, ''),
      CASE
        WHEN p.order_id IS NULL THEN ''
        WHEN p.notes LIKE ? OR p.notes LIKE ? THEN CONCAT(
          CASE WHEN COALESCE(o.order_number, '') <> '' THEN ' - ' ELSE '' END,
          'DAMAGE CHARGE REVERSAL (', ${bookingPart}, ')'
        )
        ELSE CONCAT(
          CASE WHEN COALESCE(o.order_number, '') <> '' THEN ' - ' ELSE '' END,
          CASE WHEN p.category = 'deposit_refund' THEN 'DEPOSIT REFUND' ELSE 'REFUND' END,
          ' (', ${bookingPart}, ')'
        )
      END
    ) LIKE ?`,
    ['%Damage charge%', '%damage_item:%', like]
  );
  b.orWhereRaw(
    `CONCAT(
      COALESCE(s.sale_number, ''),
      CASE WHEN p.sale_id IS NOT NULL THEN CONCAT(
        CASE WHEN COALESCE(s.sale_number, '') <> '' THEN ' - ' ELSE '' END,
        'REFUND (SALE - ', UPPER(COALESCE(s.status, 'ACTIVE')), ')'
      ) ELSE '' END
    ) LIKE ?`,
    [like]
  );
}

function addFormattedPurchasePaymentDetailsSearch(b, like) {
  b.orWhereRaw(
    `CONCAT(
      COALESCE(pu.purchase_number, ''),
      CASE WHEN pu.id IS NOT NULL THEN CONCAT(
        CASE WHEN COALESCE(pu.purchase_number, '') <> '' THEN ' - ' ELSE '' END,
        'PAYMENT (PURCHASE - ', UPPER(COALESCE(pu.status, 'ACTIVE')), ')'
      ) ELSE 'PAYMENT (PURCHASE - ACTIVE)' END
    ) LIKE ?`,
    [like]
  );
}

function addFormattedPaymentVoucherDetailsSearch(b, like) {
  b.orWhereRaw(
    `CONCAT(
      'PAYMENT VOUCHER · ',
      CASE
        WHEN pv.bill_kind = 'washing' THEN CONCAT(
          'WASHING',
          CASE WHEN lj.job_no IS NOT NULL AND lj.job_no <> '' THEN CONCAT(' · Job ', lj.job_no) ELSE '' END
        )
        WHEN pv.bill_kind = 'purchase' THEN 'PURCHASE'
        ELSE 'VENDOR PAYMENT'
      END,
      CASE WHEN pv.voucher_number IS NOT NULL AND pv.voucher_number <> '' THEN CONCAT(' (', pv.voucher_number, ')') ELSE '' END
    ) LIKE ?`,
    [like]
  );
}

function addFormattedReceiptVoucherDetailsSearch(b, like) {
  b.orWhereRaw(
    `CONCAT(
      'RECEIPT',
      CASE WHEN rv.voucher_number IS NOT NULL AND rv.voucher_number <> '' THEN CONCAT(' (', rv.voucher_number, ')') ELSE '' END,
      ' · Received from ',
      COALESCE(ca.name, 'Party / vendor'),
      ' → ',
      COALESCE(pa.name, 'Bank / cash'),
      CASE WHEN rv.remarks IS NOT NULL AND rv.remarks <> '' THEN CONCAT(' · ', rv.remarks) ELSE '' END
    ) LIKE ?`,
    [like]
  );
  b.orWhereRaw(
    `CONCAT(
      'RECEIPT VOUCHER',
      CASE WHEN rv.voucher_number IS NOT NULL AND rv.voucher_number <> '' THEN CONCAT(' (', rv.voucher_number, ')') ELSE '' END,
      CASE WHEN rv.remarks IS NOT NULL AND rv.remarks <> '' THEN CONCAT(' · ', rv.remarks) ELSE '' END
    ) LIKE ?`,
    [like]
  );
}

function emptyBucket() {
  return { cash: 0, bank: 0, total: 0 };
}

function orderDateField(r, field) {
  const v = r[field];
  if (v == null || v === '') return '';
  return typeof v === 'string' ? v.slice(0, 10) : v;
}

function includeIncomeEntry(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || tx === 'income_entry';
}

function includeIncomePayments(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || isOrderRentPaymentTransactionType(tx) || tx === 'sale_payment';
}

function includeReceiptVoucher(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || tx === 'receipt_voucher';
}

function includeExpenseEntry(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || tx === 'expense_entry';
}

function includeExpensePayments(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || isOrderRentPaymentTransactionType(tx) || tx === 'sale_payment';
}

function includePurchase(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || tx === 'purchase';
}

function includePaymentVoucher(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || tx === 'payment_voucher';
}

function includeDamageBooking(transactionType) {
  const tx = transactionType || 'all';
  return tx === 'all' || isOrderRentPaymentTransactionType(tx);
}

function applyPaymentAccountFilter(qb, paymentAccountId, paAlias = 'pa') {
  const id = paymentAccountId?.trim();
  if (!id) return;
  qb.andWhere(`${paAlias}.id`, id);
}

function applyEntryPaymentAccountFilter(qb, paymentAccountId, column) {
  const id = paymentAccountId?.trim();
  if (!id) return;
  qb.andWhere(column, id);
}

function applyPaymentOrderStatusTypeFilter(qb, transactionType, { requireNoSale = false } = {}) {
  const displayStatus = orderPaymentDisplayStatusForFilter(transactionType);
  if (!displayStatus) return false;
  qb.whereNotNull('p.order_id');
  if (requireNoSale) qb.whereNull('p.sale_id');
  qb.whereRaw(`${sqlPaymentOrderStatusExpr()} = ?`, [displayStatus]);
  return true;
}

function applyIncomePaymentTypeFilter(qb, transactionType) {
  const tx = transactionType || 'all';
  if (tx === 'sale_payment') {
    qb.whereNotNull('p.sale_id');
    return;
  }
  if (applyPaymentOrderStatusTypeFilter(qb, tx, { requireNoSale: true })) return;
  if (tx === 'booking_payment') {
    qb.whereNotNull('p.order_id').whereNull('p.sale_id');
  }
}

function applyExpensePaymentTypeFilter(qb, transactionType) {
  const tx = transactionType || 'all';
  if (tx === 'sale_payment') {
    qb.whereNotNull('p.sale_id');
    return;
  }
  if (applyPaymentOrderStatusTypeFilter(qb, tx)) return;
  if (tx === 'booking_payment') {
    qb.whereNotNull('p.order_id');
  }
}

function applyPaymentDateRange(qb, from, to, dateBasis) {
  const basis = dateBasis || 'payment';
  if (basis === 'payment') {
    qb.whereBetween('p.payment_date', [from, to]);
    return;
  }

  qb.where(function dateRange() {
    if (basis === 'booking') {
      this.where(function orderBooking() {
        this.whereNotNull('p.order_id').whereBetween('o.booking_date', [from, to]);
      })
        .orWhere(function saleBooking() {
          this.whereNull('p.order_id').whereNotNull('p.sale_id').whereBetween('s.sale_date', [from, to]);
        })
        .orWhere(function purchaseBooking() {
          this.whereNotNull('p.purchase_id').whereBetween('pu.purchase_date', [from, to]);
        })
        .orWhere(function fallback() {
          this.whereNull('p.order_id')
            .whereNull('p.sale_id')
            .whereNull('p.purchase_id')
            .whereBetween('p.payment_date', [from, to]);
        });
      return;
    }

    if (basis === 'delivery') {
      this.where(function orderDelivery() {
        this.whereNotNull('p.order_id').whereBetween('o.pickup_date', [from, to]);
      })
        .orWhere(function purchaseDelivery() {
          this.whereNotNull('p.purchase_id').whereBetween('pu.purchase_date', [from, to]);
        })
        .orWhere(function fallback() {
          this.where(function noOrderPurchase() {
            this.whereNull('p.order_id').whereNull('p.purchase_id');
          }).whereBetween('p.payment_date', [from, to]);
        });
      return;
    }

    if (basis === 'return') {
      this.where(function orderReturn() {
        this.whereNotNull('p.order_id').whereNotNull('o.return_date').whereBetween('o.return_date', [from, to]);
      }).orWhere(function fallback() {
        this.where(function notOrderReturn() {
          this.whereNull('p.order_id').orWhereNull('o.return_date');
        }).whereBetween('p.payment_date', [from, to]);
      });
    }
  });
}

function paymentSearchOr(b, like) {
  b.where('pa.name', 'like', like)
    .orWhere('o.order_number', 'like', like)
    .orWhere('s.sale_number', 'like', like)
    .orWhere('s.customer_name', 'like', like)
    .orWhere('c.name', 'like', like)
    .orWhere('o.pickup_name', 'like', like)
    .orWhere('o.reference_name', 'like', like)
    .orWhere('p.notes', 'like', like)
    .orWhere('p.transaction_id', 'like', like);
  addFormattedIncomePaymentDetailsSearch(b, like);
}

function expensePaymentSearchOr(b, like) {
  paymentSearchOr(b, like);
  addFormattedExpensePaymentDetailsSearch(b, like);
}

function applyIncomePaymentSearch(qb, search) {
  applySearchLike(qb, search, (b, like) => {
    paymentSearchOr(b, like);
    b.orWhereRaw("(CASE WHEN p.sale_id IS NOT NULL THEN 'CUSTOMER SALE' WHEN p.order_id IS NOT NULL THEN 'CUSTOMER RENT' ELSE 'CUSTOMER PAYMENT' END) LIKE ?", [like])
      .orWhereRaw("(CASE WHEN p.notes LIKE '%Damage charge%' OR p.notes LIKE '%damage_item:%' THEN 'DAMAGE / MISSING CHARGE' ELSE '' END) LIKE ?", [like]);
  });
}

function applyExpensePaymentSearch(qb, search) {
  applySearchLike(qb, search, (b, like) => {
    expensePaymentSearchOr(b, like);
    b.orWhereRaw("(CASE WHEN p.order_id IS NOT NULL THEN 'CUSTOMER REFUND' ELSE 'REFUND' END) LIKE ?", [like])
      .orWhereRaw("(CASE WHEN p.notes LIKE '%Damage charge%' OR p.notes LIKE '%damage_item:%' THEN 'DAMAGE CHARGE REVERSAL' ELSE '' END) LIKE ?", [like]);
  });
}

function applyEntrySearch(qb, search, alias, numberColumn) {
  applySearchLike(qb, search, (b, like) => {
    b.where(`${alias}.name`, 'like', like).orWhere(`${alias}.details`, 'like', like)
      .orWhere(`${alias}.${numberColumn}`, 'like', like).orWhere('pa.name', 'like', like);
  });
}

function applyPurchasePaymentSearch(qb, search) {
  applySearchLike(qb, search, (b, like) => {
    b.where('pa.name', 'like', like).orWhere('pu.purchase_number', 'like', like)
      .orWhere('va.name', 'like', like).orWhereRaw("'VENDOR PURCHASE' LIKE ?", [like]);
    addFormattedPurchasePaymentDetailsSearch(b, like);
  });
}

function applyPaymentVoucherSearch(qb, search) {
  applySearchLike(qb, search, (b, like) => {
    b.where('pv.voucher_number', 'like', like).orWhere('pv.remarks', 'like', like)
      .orWhere('pa.name', 'like', like).orWhere('da.name', 'like', like).orWhere('lj.job_no', 'like', like)
      .orWhere('linked_purchase.purchase_number', 'like', like);
    addFormattedPaymentVoucherDetailsSearch(b, like);
  });
}

function applyReceiptVoucherSearch(qb, search) {
  applySearchLike(qb, search, (b, like) => {
    b.where('rv.voucher_number', 'like', like).orWhere('rv.remarks', 'like', like)
      .orWhere('pa.name', 'like', like).orWhere('ca.name', 'like', like);
    addFormattedReceiptVoucherDetailsSearch(b, like);
  });
}

function joinPaymentSearchCustomer(qb) {
  qb.leftJoin('customers as c', function joinCustomer() {
    this.on('c.id', 'o.customer_id').andOn('c.shop_id', 'o.shop_id');
  });
}

function joinPaymentVoucherBills(qb) {
  qb.leftJoin('payment_accounts as da', function joinDebit() {
    this.on('da.id', 'pv.debit_account_id').andOn('da.shop_id', 'pv.shop_id');
  }).leftJoin('laundry_jobs as lj', function joinLaundry() {
    this.on('lj.id', 'pv.bill_id').andOn('lj.shop_id', 'pv.shop_id').andOnVal('pv.bill_kind', 'washing');
  }).leftJoin('purchases as linked_purchase', function joinPurchase() {
    this.on('linked_purchase.id', 'pv.bill_id').andOn('linked_purchase.shop_id', 'pv.shop_id').andOnVal('pv.bill_kind', 'purchase');
  });
}

function formatSalePaymentDetails(saleNumber, saleStatus) {
  const label = saleStatus ? String(saleStatus).toUpperCase() : 'ACTIVE';
  if (saleNumber) return `${saleNumber} - PAYMENT (SALE - ${label})`;
  return `PAYMENT (SALE - ${label})`;
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

function applyDamageChargeNoteFilter(qb) {
  qb.andWhere(function damageNotes() {
    this.where('p.notes', 'like', '%Damage charge%').orWhere('p.notes', 'like', '%damage_item:%');
  });
}

function resolveRowDateTime(r) {
  return serializeInstant(r.created_at) || normalizeSqlDateToIso(r.row_date) || null;
}

function financialRowTimestamps(r) {
  const businessDate = normalizeSqlDateToIso(r.row_date) || null;
  return {
    created_at: serializeInstant(r.created_at),
    payment_date: businessDate,
    entry_date: businessDate,
  };
}

export function mapIncomeEntryRow(r) {
  return {
    source: 'income_entry',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: r.entry_number || '',
    name: r.row_name || '',
    details: r.row_details || '',
    payment_account: r.payment_account || '',
    amount: num(r.amount),
  };
}

export function mapExpenseEntryRow(r) {
  return {
    source: 'expense_entry',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: r.entry_number || '',
    name: r.row_name || '',
    details: r.row_details || '',
    payment_account: r.payment_account || '',
    amount: num(r.amount),
  };
}

function mapIncomePaymentRow(r) {
  const hasSale = Boolean(r.sale_id);
  const hasOrder = Boolean(r.order_id);
  const customerName = String(r.customer_name || '').trim();
  const isDamage = isDamageChargePayment(r.payment_notes);
  return {
    source: 'payment',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: r.sale_number || r.order_number || '',
    name:
      customerName ||
      (isDamage ? 'DAMAGE / MISSING' : hasSale ? 'CUSTOMER SALE' : hasOrder ? 'CUSTOMER RENT' : 'CUSTOMER PAYMENT'),
    details: hasSale
      ? formatSalePaymentDetails('', r.sale_status || null)
      : formatOrderPaymentIncomeDetails(
          '',
          paymentStatusForRow(r),
          r.payment_notes
        ),
    payment_account: r.payment_account || '',
    amount: num(r.amount),
    income_type: isDamage ? 'damage_missing' : 'booking',
    order_id: r.order_id || null,
    sale_id: r.sale_id || null,
    booking_date: orderDateField(r, 'booking_date'),
    pickup_date: orderDateField(r, 'pickup_date'),
    return_date: orderDateField(r, 'return_date'),
  };
}

function mapPurchaseExpensePaymentRow(r) {
  const vendorName = String(r.vendor_account_name || '').trim();
  return {
    source: 'payment',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: r.purchase_number || '',
    name: vendorName || 'VENDOR PURCHASE',
    details: formatPurchasePaymentDetails('', r.purchase_status || null),
    payment_account: r.payment_account || '',
    amount: num(r.amount),
    expense_type: 'purchase',
    purchase_id: r.purchase_id || null,
  };
}

export function mapExpensePaymentRow(r) {
  const hasOrder = Boolean(r.order_id);
  const customerName = String(r.customer_name || '').trim();
  const isDamage = isDamageChargePayment(r.payment_notes);
  return {
    source: 'payment',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: r.sale_number || r.order_number || '',
    name:
      customerName ||
      (isDamage ? 'DAMAGE / MISSING' : hasOrder ? 'CUSTOMER REFUND' : 'REFUND'),
    details: r.sale_id ? `REFUND (SALE - ${String(r.sale_status || 'ACTIVE').toUpperCase()})` : formatOrderPaymentExpenseDetails(
      '',
      paymentStatusForRow(r),
      r.payment_category || 'refund',
      r.payment_notes
    ),
    payment_account: r.payment_account || '',
    amount: num(r.amount),
    expense_type: isDamage ? 'damage_missing' : 'booking',
    order_id: r.order_id || null,
    sale_id: r.sale_id || null,
    booking_date: orderDateField(r, 'booking_date'),
    pickup_date: orderDateField(r, 'pickup_date'),
    return_date: orderDateField(r, 'return_date'),
  };
}

async function aggregateIncomeEntries(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('ie.amount');
  const qb = knex('income_entries as ie')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'ie.shop_id').andOn('pa.id', '=', 'ie.payment_account_id');
    })
    .where('ie.shop_id', shopId)
    .whereBetween('ie.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'ie.payment_account_id');
  applyEntrySearch(qb, opts.search, 'ie', 'income_number');
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregateIncomePayments(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('p.amount');
  const qb = excludePurchasePayments(
    knex('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('orders as o', function joinO() {
        this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
      })
      .leftJoin('sales as s', function joinS() {
        this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
      })
      .leftJoin('purchases as pu', function joinPu() {
        this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
      })
      .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
      .whereIn('p.category', INCOME_PAYMENT_CATEGORIES)
  );
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  applyIncomePaymentTypeFilter(qb, opts.transaction_type);
  joinPaymentSearchCustomer(qb);
  applyIncomePaymentSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregatePurchasePayments(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('p.amount');
  const qb = onlyPurchasePayments(
    knex('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('orders as o', function joinO() {
        this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
      })
      .leftJoin('sales as s', function joinS() {
        this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
      })
      .leftJoin('purchases as pu', function joinPu() {
        this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
      })
      .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
  );
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  qb.leftJoin('payment_accounts as va', function joinVendor() {
    this.on('va.id', 'pu.vendor_account_id').andOn('va.shop_id', 'pu.shop_id');
  });
  applyPurchasePaymentSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregateExpenseEntries(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('ee.amount');
  const qb = knex('expense_entries as ee')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'ee.shop_id').andOn('pa.id', '=', 'ee.payment_account_id');
    })
    .where('ee.shop_id', shopId)
    .whereBetween('ee.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'ee.payment_account_id');
  applyEntrySearch(qb, opts.search, 'ee', 'expense_number');
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregateExpensePayments(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('p.amount');
  const qb = knex('payments as p')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
    })
    .leftJoin('orders as o', function joinO() {
      this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
    })
    .leftJoin('sales as s', function joinS() {
      this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
    })
    .leftJoin('purchases as pu', function joinPu() {
      this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
    })
    .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
    .whereIn('p.category', EXPENSE_PAYMENT_CATEGORIES);
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  applyExpensePaymentTypeFilter(qb, opts.transaction_type);
  joinPaymentSearchCustomer(qb);
  applyExpensePaymentSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregateDamageIncomePayments(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('p.amount');
  const qb = excludePurchasePayments(
    knex('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('orders as o', function joinO() {
        this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
      })
      .leftJoin('sales as s', function joinS() {
        this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
      })
      .leftJoin('purchases as pu', function joinPu() {
        this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
      })
      .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
      .whereIn('p.category', ['partial', 'final'])
  );
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  applyIncomePaymentTypeFilter(qb, opts.transaction_type);
  applyDamageChargeNoteFilter(qb);
  joinPaymentSearchCustomer(qb);
  applyIncomePaymentSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregateDamageExpensePayments(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('p.amount');
  const qb = knex('payments as p')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
    })
    .leftJoin('orders as o', function joinO() {
      this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
    })
    .leftJoin('sales as s', function joinS() {
      this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
    })
    .leftJoin('purchases as pu', function joinPu() {
      this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
    })
    .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
    .where('p.category', 'refund');
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  applyExpensePaymentTypeFilter(qb, opts.transaction_type);
  applyDamageChargeNoteFilter(qb);
  joinPaymentSearchCustomer(qb);
  applyExpensePaymentSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function listIncomeEntriesRows(shopId, from, to, search, opts = {}) {
  const qb = knex('income_entries as ie')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'ie.shop_id').andOn('pa.id', '=', 'ie.payment_account_id');
    })
    .where('ie.shop_id', shopId)
    .whereBetween('ie.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'ie.payment_account_id');
  qb
    .select(
      knex.raw("'income_entry' as source"),
      'ie.id as source_id',
      'ie.entry_date as row_date',
      'ie.created_at',
      'ie.name as row_name',
      'ie.income_number as entry_number',
      'ie.details as row_details',
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      'ie.amount as amount'
    )
    .orderBy('ie.created_at', opts.sort_dir || 'desc').orderBy('ie.id')
    .limit(PER_BRANCH_LIMIT);

  applyEntrySearch(qb, search, 'ie', 'income_number');

  const rows = await qb;
  return rows.map(mapIncomeEntryRow);
}

async function listPurchasePaymentRows(shopId, from, to, search, opts = {}) {
  const qb = onlyPurchasePayments(
    knex('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('purchases as pu', function joinPu() {
        this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
      })
      .leftJoin('payment_accounts as va', function joinVa() {
        this.on('va.shop_id', '=', 'pu.shop_id').andOn('va.id', '=', 'pu.vendor_account_id');
      })
      .leftJoin('orders as o', function joinO() {
        this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
      })
      .leftJoin('sales as s', function joinS() {
        this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
      })
      .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
  );
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  qb
    .select(
      knex.raw("'payment' as source"),
      'p.id as source_id',
      'p.purchase_id',
      'p.payment_date as row_date',
      'p.created_at',
      'pu.purchase_number',
      'pu.status as purchase_status',
      knex.raw('COALESCE(va.name, ?) as vendor_account_name', ['']),
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      'p.amount as amount'
    );

  applyPurchasePaymentSearch(qb, search);

  qb.orderBy('p.created_at', opts.sort_dir || 'desc').orderBy('p.id').limit(PER_BRANCH_LIMIT);

  const rows = await qb;
  return rows.map(mapPurchaseExpensePaymentRow);
}

async function listIncomePaymentRows(shopId, from, to, search, opts = {}) {
  const qb = excludePurchasePayments(
    knex('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('orders as o', function joinO() {
        this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
      })
      .leftJoin('sales as s', function joinS() {
        this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
      })
      .leftJoin('purchases as pu', function joinPu() {
        this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
      })
      .leftJoin('customers as c', function joinC() {
        this.on('c.shop_id', '=', 'o.shop_id').andOn('c.id', '=', 'o.customer_id');
      })
      .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
      .whereIn('p.category', INCOME_PAYMENT_CATEGORIES)
  );
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  applyIncomePaymentTypeFilter(qb, opts.transaction_type);
  qb
    .select(
      knex.raw("'payment' as source"),
      'p.id as source_id',
      'p.payment_date as row_date',
      'p.created_at',
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
      'o.booking_date',
      'o.pickup_date',
      'o.return_date',
      's.sale_number',
      's.status as sale_status',
      knex.raw('COALESCE(c.name, s.customer_name, ?) as customer_name', ['']),
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      'p.amount as amount',
      'p.notes as payment_notes'
    )
    .orderBy('p.created_at', opts.sort_dir || 'desc').orderBy('p.id')
    .limit(PER_BRANCH_LIMIT);

  applyIncomePaymentSearch(qb, search);

  const rows = await qb;
  return rows.map(mapIncomePaymentRow);
}

async function listExpenseEntriesRows(shopId, from, to, search, opts = {}) {
  const qb = knex('expense_entries as ee')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'ee.shop_id').andOn('pa.id', '=', 'ee.payment_account_id');
    })
    .where('ee.shop_id', shopId)
    .whereBetween('ee.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'ee.payment_account_id');
  qb
    .select(
      knex.raw("'expense_entry' as source"),
      'ee.id as source_id',
      'ee.entry_date as row_date',
      'ee.created_at',
      'ee.name as row_name',
      'ee.expense_number as entry_number',
      'ee.details as row_details',
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      'ee.amount as amount'
    )
    .orderBy('ee.created_at', opts.sort_dir || 'desc').orderBy('ee.id')
    .limit(PER_BRANCH_LIMIT);

  applyEntrySearch(qb, search, 'ee', 'expense_number');

  const rows = await qb;
  return rows.map(mapExpenseEntryRow);
}

async function listExpensePaymentRows(shopId, from, to, search, opts = {}) {
  const qb = knex('payments as p')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
    })
    .leftJoin('orders as o', function joinO() {
      this.on('o.shop_id', '=', 'p.shop_id').andOn('o.id', '=', 'p.order_id');
    })
    .leftJoin('sales as s', function joinS() {
      this.on('s.shop_id', '=', 'p.shop_id').andOn('s.id', '=', 'p.sale_id');
    })
    .leftJoin('purchases as pu', function joinPu() {
      this.on('pu.shop_id', '=', 'p.shop_id').andOn('pu.id', '=', 'p.purchase_id');
    })
    .leftJoin('customers as c', function joinC() {
      this.on('c.shop_id', '=', 'o.shop_id').andOn('c.id', '=', 'o.customer_id');
    })
    .where('p.shop_id', shopId)
.where('p.is_deleted', false)
      .modify(excludeConditionPaymentMovements, 'p')
    .whereIn('p.category', EXPENSE_PAYMENT_CATEGORIES);
  applyPaymentDateRange(qb, from, to, opts.date_basis);
  applyPaymentAccountFilter(qb, opts.payment_account_id);
  applyExpensePaymentTypeFilter(qb, opts.transaction_type);
  qb
    .select(
      knex.raw("'payment' as source"),
      'p.id as source_id',
      'p.payment_date as row_date',
      'p.created_at',
      'p.order_id',
      'p.category as payment_category',
      'p.sale_id',
      's.sale_number',
      's.status as sale_status',
      'o.order_number',
      'o.status as order_status',
      'o.delivered_at as order_delivered_at',
      'o.returned_at as order_returned_at',
      'o.packed_at as order_packed_at',
      'p.order_status_at_payment',
      'p.payment_stage',
      sqlPaymentOrderStatusSelect(knex),
      sqlFollowUpOrderPaymentSelect(knex),
      'o.booking_date',
      'o.pickup_date',
      'o.return_date',
      knex.raw('COALESCE(c.name, s.customer_name, ?) as customer_name', ['']),
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      'p.amount as amount',
      'p.notes as payment_notes'
    )
    .orderBy('p.created_at', opts.sort_dir || 'desc').orderBy('p.id')
    .limit(PER_BRANCH_LIMIT);

  applyExpensePaymentSearch(qb, search);

  const rows = await qb;
  return rows.map(mapExpensePaymentRow);
}

async function aggregatePaymentVouchers(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('pv.amount');
  const qb = knex('payment_vouchers as pv')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'pv.shop_id').andOn('pa.id', '=', 'pv.credit_account_id');
    })
    .where('pv.shop_id', shopId)
    .whereBetween('pv.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'pv.credit_account_id');
  joinPaymentVoucherBills(qb);
  applyPaymentVoucherSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

async function aggregateReceiptVouchers(shopId, from, to, opts = {}) {
  const { cash, bank, total } = cashBankCaseSum('rv.amount');
  const qb = knex('receipt_vouchers as rv')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'rv.shop_id').andOn('pa.id', '=', 'rv.debit_account_id');
    })
    .where('rv.shop_id', shopId)
    .whereBetween('rv.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'rv.debit_account_id');
  qb.leftJoin('payment_accounts as ca', function joinCreditor() {
    this.on('ca.id', 'rv.credit_account_id').andOn('ca.shop_id', 'rv.shop_id');
  });
  applyReceiptVoucherSearch(qb, opts.search);
  const row = await qb.select(cash, bank, total).first();
  return { cash: num(row?.cash), bank: num(row?.bank), total: num(row?.total) };
}

export function mapPaymentVoucherRow(r) {
  const vn = String(r.voucher_number || '').trim();
  const jobNo = String(r.job_no || '').trim();
  const jobPart = jobNo ? ` · Job ${jobNo}` : '';
  const kindPart =
    r.bill_kind === 'washing' ? `WASHING${jobPart}` : r.bill_kind === 'purchase' ? 'PURCHASE' : 'VENDOR PAYMENT';
  return {
    source: 'payment_voucher',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: vn || '',
    name: String(r.debit_account_name || '').trim() || 'VENDOR',
    details: `PAYMENT VOUCHER · ${kindPart}`,
    payment_account: r.payment_account || '',
    amount: num(r.amount),
    voucher_id: r.source_id,
    reference_kind: 'payment_voucher',
    voucher_number: vn,
    bill_kind: r.bill_kind || 'none',
    linked_bill_id: r.bill_id || null,
    linked_bill_number: r.bill_kind === 'purchase' ? r.purchase_number || '' : jobNo,
  };
}

async function listPaymentVoucherRows(shopId, from, to, search, opts = {}) {
  const qb = knex('payment_vouchers as pv')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'pv.shop_id').andOn('pa.id', '=', 'pv.credit_account_id');
    })
    .modify(joinPaymentVoucherBills)
    .where('pv.shop_id', shopId)
    .whereBetween('pv.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'pv.credit_account_id');
  qb
    .select(
      knex.raw("'payment_voucher' as source"),
      'pv.id as source_id',
      'pv.entry_date as row_date',
      'pv.created_at',
      'pv.voucher_number',
      'pv.bill_kind',
      'pv.bill_id',
      'pv.amount',
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      knex.raw('COALESCE(da.name, ?) as debit_account_name', ['']),
      'lj.job_no',
      'linked_purchase.purchase_number'
    );

  applyPaymentVoucherSearch(qb, search);

  qb.orderBy('pv.created_at', opts.sort_dir || 'desc').orderBy('pv.id').limit(PER_BRANCH_LIMIT);

  const rows = await qb;
  return rows.map(mapPaymentVoucherRow);
}

export function mapReceiptVoucherRow(r) {
  const vn = String(r.voucher_number || '').trim();
  const remarks = String(r.remarks || '').trim();
  const fromName = String(r.credit_account_name || '').trim() || 'Party / vendor';
  const intoName = String(r.payment_account || '').trim() || 'Bank / cash';
  const flowPart = `Received from ${fromName} → ${intoName}`;
  const detailsBase = `RECEIPT · ${flowPart}`;
  return {
    source: 'receipt_voucher',
    source_id: r.source_id,
    date: resolveRowDateTime(r),
    ...financialRowTimestamps(r),
    bill_no: vn || '',
    name: fromName,
    voucher_id: r.source_id,
    reference_kind: 'receipt_voucher',
    voucher_number: vn,
    details: remarks ? `${detailsBase} · ${remarks}` : detailsBase,
    payment_account: intoName,
    amount: num(r.amount),
  };
}

async function listReceiptVoucherRows(shopId, from, to, search, opts = {}) {
  const qb = knex('receipt_vouchers as rv')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'rv.shop_id').andOn('pa.id', '=', 'rv.debit_account_id');
    })
    .leftJoin('payment_accounts as ca', function joinCa() {
      this.on('ca.shop_id', '=', 'rv.shop_id').andOn('ca.id', '=', 'rv.credit_account_id');
    })
    .where('rv.shop_id', shopId)
    .whereBetween('rv.entry_date', [from, to]);
  applyEntryPaymentAccountFilter(qb, opts.payment_account_id, 'rv.debit_account_id');
  qb
    .select(
      knex.raw("'receipt_voucher' as source"),
      'rv.id as source_id',
      'rv.entry_date as row_date',
      'rv.created_at',
      'rv.voucher_number',
      'rv.remarks',
      'rv.amount',
      knex.raw('COALESCE(pa.name, ?) as payment_account', ['']),
      knex.raw('COALESCE(ca.name, ?) as credit_account_name', [''])
    );

  applyReceiptVoucherSearch(qb, search);

  qb.orderBy('rv.created_at', opts.sort_dir || 'desc').orderBy('rv.id').limit(PER_BRANCH_LIMIT);

  const rows = await qb;
  return rows.map(mapReceiptVoucherRow);
}

export function mergeByDate(a, b, limit, sortDir = 'desc') {
  const direction = sortDir === 'asc' ? 1 : -1;
  const merged = [...a, ...b].sort((x, y) => {
    const cmp = String(x.date).localeCompare(String(y.date)) * direction;
    if (cmp !== 0) return cmp;
    return String(x.source_id).localeCompare(String(y.source_id));
  });
  return merged.slice(0, limit);
}

/**
 * @param {string} shopId
 * @param {{ from: string; to: string; search?: string; date_basis?: string; payment_account_id?: string; transaction_type?: string }} query
 */
export async function getIncomeExpenseReport(shopId, query) {
  const { from, to, search, date_basis, payment_account_id, transaction_type, sort_dir } = query;
  const opts = { date_basis, payment_account_id, transaction_type, search, sort_dir };

  const [
    ieAgg,
    ipAgg,
    rvAgg,
    eeAgg,
    epAgg,
    purchasePayAgg,
    pvAgg,
    damageIncomeAgg,
    damageExpenseAgg,
  ] = await Promise.all([
    includeIncomeEntry(transaction_type)
      ? aggregateIncomeEntries(shopId, from, to, opts)
      : emptyBucket(),
    includeIncomePayments(transaction_type)
      ? aggregateIncomePayments(shopId, from, to, opts)
      : emptyBucket(),
    includeReceiptVoucher(transaction_type)
      ? aggregateReceiptVouchers(shopId, from, to, opts)
      : emptyBucket(),
    includeExpenseEntry(transaction_type)
      ? aggregateExpenseEntries(shopId, from, to, opts)
      : emptyBucket(),
    includeExpensePayments(transaction_type)
      ? aggregateExpensePayments(shopId, from, to, opts)
      : emptyBucket(),
    includePurchase(transaction_type)
      ? aggregatePurchasePayments(shopId, from, to, opts)
      : emptyBucket(),
    includePaymentVoucher(transaction_type)
      ? aggregatePaymentVouchers(shopId, from, to, opts)
      : emptyBucket(),
    includeDamageBooking(transaction_type)
      ? aggregateDamageIncomePayments(shopId, from, to, opts)
      : emptyBucket(),
    includeDamageBooking(transaction_type)
      ? aggregateDamageExpensePayments(shopId, from, to, opts)
      : emptyBucket(),
  ]);

  const incomeBuckets = addBuckets(addBuckets(ieAgg, ipAgg), rvAgg);
  const expenseBuckets = addBuckets(addBuckets(addBuckets(eeAgg, epAgg), purchasePayAgg), pvAgg);
  const profit = incomeBuckets.total - expenseBuckets.total;

  const [incomeA, incomeB, incomeRv, expenseA, expenseB, expensePurchase, expensePv] = await Promise.all([
    includeIncomeEntry(transaction_type)
      ? listIncomeEntriesRows(shopId, from, to, search, opts)
      : [],
    includeIncomePayments(transaction_type)
      ? listIncomePaymentRows(shopId, from, to, search, opts)
      : [],
    includeReceiptVoucher(transaction_type)
      ? listReceiptVoucherRows(shopId, from, to, search, opts)
      : [],
    includeExpenseEntry(transaction_type)
      ? listExpenseEntriesRows(shopId, from, to, search, opts)
      : [],
    includeExpensePayments(transaction_type)
      ? listExpensePaymentRows(shopId, from, to, search, opts)
      : [],
    includePurchase(transaction_type)
      ? listPurchasePaymentRows(shopId, from, to, search, opts)
      : [],
    includePaymentVoucher(transaction_type)
      ? listPaymentVoucherRows(shopId, from, to, search, opts)
      : [],
  ]);

  const income_rows = mergeByDate(mergeByDate(incomeA, incomeB, ROW_LIMIT, sort_dir), incomeRv, ROW_LIMIT, sort_dir);
  const expense_rows = mergeByDate(
    mergeByDate(mergeByDate(expenseA, expenseB, ROW_LIMIT, sort_dir), expensePurchase, ROW_LIMIT, sort_dir),
    expensePv,
    ROW_LIMIT,
    sort_dir
  );

  return {
    range: { from, to },
    summary: {
      income_cash: incomeBuckets.cash,
      income_bank: incomeBuckets.bank,
      income_total: incomeBuckets.total,
      damage_missing_income_total: damageIncomeAgg.total,
      damage_missing_income_cash: damageIncomeAgg.cash,
      damage_missing_income_bank: damageIncomeAgg.bank,
      expense_cash: expenseBuckets.cash,
      expense_bank: expenseBuckets.bank,
      expense_total: expenseBuckets.total,
      damage_missing_expense_total: damageExpenseAgg.total,
      profit,
    },
    income_rows,
    expense_rows,
    meta: {
      row_limit: ROW_LIMIT,
      date_basis: date_basis || 'payment',
      transaction_type: transaction_type || 'all',
      sort_dir: sort_dir || 'desc',
    },
  };
}
