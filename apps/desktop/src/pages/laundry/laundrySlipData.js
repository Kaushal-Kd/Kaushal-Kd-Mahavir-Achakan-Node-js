import {
  formatDate,
  formatDateTime,
  formatOrderTime12,
  parseWallClockDateTimeParts,
} from '@wrs/shared';

import { PRIORITY_RANK } from './laundryQueueUtils.js';

/** Urgent product code label on washing slip — no special borders, text marker only */
export function formatUrgentCodeLabel(code) {
  return `*** ${String(code || '').trim() || '—'} ***`;
}

/** Laundry slip print/PDF date — dd/mm/yyyy */
export function formatLaundrySlipDate(value) {
  const s = formatDate(value);
  return s ? s.replace(/-/g, '/') : '';
}

/** Laundry slip print/PDF datetime — dd/mm/yyyy h:mm AM/PM (wall clock, no TZ shift) */
export function formatLaundrySlipDateTime(value) {
  const parts = parseWallClockDateTimeParts(value);
  if (parts) {
    const datePart = formatLaundrySlipDate(`${parts.year}-${parts.month}-${parts.day}`);
    const timePart = formatOrderTime12(`${parts.hour}:${parts.minute}`);
    if (!timePart || timePart === '—') return datePart;
    return `${datePart} ${timePart}`;
  }
  const formatted = formatDateTime(value);
  return formatted ? formatted.replace(/-/g, '/') : '';
}

const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low', 'No Schedule'];
/** Only these appear in "Products by priority" on the printed slip. */
export const SLIP_PRIORITY_ORDER = ['Urgent', 'High', 'Medium'];
export const MAX_CODE_ROWS_PER_COLUMN = 28;
export const MAX_CODE_COLUMNS_PER_TABLE = 8;

/** Keep each printable box within one page; continuing boxes retain their category identity. */
export function paginateLaundryCodeGroups(groups) {
  return (groups || []).flatMap((group) => {
    const entries = group.entries || [];
    const parts = Math.max(1, Math.ceil(entries.length / MAX_CODE_ROWS_PER_COLUMN));
    return Array.from({ length: parts }, (_, part) => ({
      ...group,
      label: parts > 1 ? `${group.label} (${part + 1}/${parts})` : group.label,
      entries: entries.slice(
        part * MAX_CODE_ROWS_PER_COLUMN,
        (part + 1) * MAX_CODE_ROWS_PER_COLUMN
      ),
    }));
  });
}

function normalizePriority(value) {
  const p = String(value || '').trim();
  return PRIORITY_ORDER.includes(p) ? p : 'No Schedule';
}

function compareCodesAsc(a, b) {
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

function sortCodesAsc(codes) {
  return [...codes].sort(compareCodesAsc);
}

function sortCodeEntriesAsc(entries) {
  return [...entries].sort((a, b) => compareCodesAsc(a.code, b.code));
}

/** @param {Record<string, unknown>} input */
export function normalizeLaundrySlipInput(input) {
  if (!input) return null;
  const categoryWashRates = input.categoryWashRates || {};
  const categorySummaries = (input.categorySummaries || []).map((row) => ({
    ...row,
    washPrice: Number(row.washPrice ?? categoryWashRates[row.key] ?? 0),
  }));
  return {
    jobNo: input.jobNo || input.job_no || '-',
    laundryDate: input.laundryDate || input.laundry_date,
    vendor: input.vendor || input.vendorName || '-',
    pickupBy: input.pickupBy || input.pickup_by || '',
    pickupAt: input.pickupAt || input.pickup_at || null,
    returnAt: input.returnAt || input.return_at || null,
    remarks: input.remarks || '',
    productRows: input.productRows || [],
    accessoryRows: input.accessoryRows || [],
    categorySummaries,
    productTotal: Number(input.productTotal ?? 0),
    accessoryTotal: Number(input.accessoryTotal ?? 0),
    subtotal: Number(input.subtotal ?? 0),
    discountAmount: Number(input.discountAmount ?? input.discount_amount ?? 0),
    payable: Number(input.payable ?? 0),
    vendorOutstanding: normalizeVendorOutstanding(input.vendorOutstanding),
  };
}

/** @param {Record<string, unknown>|null|undefined} raw */
export function normalizeVendorOutstanding(raw) {
  if (!raw || !raw.totals) return null;
  const billCount = Number(raw.totals.billCount ?? raw.totals.bill_count ?? 0);
  if (billCount <= 0) return null;

  return {
    isLatestBill: Boolean(raw.isLatestBill ?? raw.is_latest_bill),
    bills: (raw.bills || []).map((bill) => ({
      id: bill.id,
      jobNo: bill.jobNo || bill.job_no || '-',
      laundryDate: bill.laundryDate || bill.laundry_date || null,
      payable: Number(bill.payable ?? bill.payable_amount ?? 0),
      paid: Number(bill.paid ?? bill.paid_to_washing_amount ?? 0),
      remaining: Number(bill.remaining ?? bill.washing_balance ?? 0),
    })),
    totals: {
      totalPayable: Number(raw.totals.totalPayable ?? raw.totals.total_payable ?? 0),
      totalPaid: Number(raw.totals.totalPaid ?? raw.totals.total_paid ?? 0),
      totalRemaining: Number(raw.totals.totalRemaining ?? raw.totals.total_remaining ?? 0),
      billCount,
    },
  };
}

export function calculateVendorOutstandingAmounts({
  outstanding,
  currentBillAmount = 0,
  currentBillId = null,
  currentJobNo = null,
}) {
  const currentBill = Number(currentBillAmount || 0);
  const totalPending = Number(outstanding?.totals?.totalRemaining || 0);
  const currentOutstandingRow = (outstanding?.bills || []).find((bill) => {
    if (currentBillId && String(bill.id || '') === String(currentBillId)) return true;
    return currentJobNo && String(bill.jobNo || '') === String(currentJobNo);
  });
  const currentOutstanding = Number(currentOutstandingRow?.remaining ?? currentBill);
  return {
    currentBill,
    currentOutstanding,
    oldPending: Math.max(0, totalPending - currentOutstanding),
    totalPending,
  };
}

export function groupProductsByCategory(productRows) {
  const map = new Map();
  for (const row of productRows || []) {
    const key = String(row.categoryId || 'uncategorized');
    const label = String(row.categoryLabel || 'Uncategorized').trim() || 'Uncategorized';
    if (!map.has(key)) {
      map.set(key, { label, entries: [] });
    }
    const code = String(row.code || '').trim() || '-';
    const priority = normalizePriority(row.priority);
    const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
    for (let i = 0; i < qty; i += 1) {
      map.get(key).entries.push({ code, priority });
    }
  }
  return Array.from(map.values())
    .map((group) => ({
      label: group.label,
      entries: sortCodeEntriesAsc(group.entries),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

export function groupProductsByPriority(productRows) {
  const map = new Map(SLIP_PRIORITY_ORDER.map((p) => [p, []]));
  for (const row of productRows || []) {
    const priority = normalizePriority(row.priority);
    if (!SLIP_PRIORITY_ORDER.includes(priority)) continue;
    const code = String(row.code || '').trim() || '-';
    const qty = Math.max(1, Math.floor(Number(row.qty) || 1));
    for (let i = 0; i < qty; i += 1) {
      map.get(priority).push(code);
    }
  }
  return SLIP_PRIORITY_ORDER.filter((p) => (map.get(p) || []).length > 0)
    .map((priority) => ({ priority, codes: sortCodesAsc(map.get(priority)) }))
    .sort((a, b) => (PRIORITY_RANK[a.priority] || 99) - (PRIORITY_RANK[b.priority] || 99));
}

/** @param {Array<{ productCount?: number, qtyTotal?: number, washPrice?: number }>} rows */
export function sumCategoryPricingRows(rows) {
  let productCount = 0;
  let qtyTotal = 0;
  let lineTotal = 0;
  for (const row of rows || []) {
    const washPrice = Number(row.washPrice || 0);
    const qty = Number(row.qtyTotal || 0);
    productCount += Number(row.productCount || 0);
    qtyTotal += qty;
    lineTotal += qty * washPrice;
  }
  return { productCount, qtyTotal, lineTotal };
}

/** @param {Array<{ qty?: number, rate?: number }>} rows */
export function sumAccessoryRows(rows) {
  let qty = 0;
  let lineTotal = 0;
  for (const row of rows || []) {
    const q = Number(row.qty || 0);
    const rate = Number(row.rate || 0);
    qty += q;
    lineTotal += q * rate;
  }
  return { qty, lineTotal };
}

export function splitEntriesIntoColumns(entries) {
  const cols = [];
  for (let i = 0; i < entries.length; i += MAX_CODE_ROWS_PER_COLUMN) {
    cols.push(entries.slice(i, i + MAX_CODE_ROWS_PER_COLUMN));
  }
  if (cols.length > MAX_CODE_COLUMNS_PER_TABLE) {
    const merged = [];
    const perCol = Math.ceil(entries.length / MAX_CODE_COLUMNS_PER_TABLE);
    for (let i = 0; i < entries.length; i += perCol) {
      merged.push(entries.slice(i, i + perCol));
    }
    return merged;
  }
  return cols.length ? cols : [[]];
}
