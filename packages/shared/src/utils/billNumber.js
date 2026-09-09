/**
 * Bill / Order number helpers (requirements §50 order numbering).
 */

import { normalizeSqlDateToIso, todayIndiaISODate } from './date.js';

/** Max length for `order_number_prefix` on shops (letters + digits only). */
export const ORDER_NUMBER_PREFIX_MAX = 12;

export const ORDER_NUMBER_FORMAT = Object.freeze({
  PREFIX_SEQUENCE: 'prefix_sequence',
  DATE_SEQUENCE: 'date_sequence',
  PREFIX_DATE_SEQUENCE: 'prefix_date_sequence',
});

/** UI + validation options for rental booking bill numbers. */
export const ORDER_NUMBER_FORMATS = Object.freeze([
  {
    value: ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE,
    label: 'Prefix + sequence',
    example: 'MAHAVIR-0001',
  },
  {
    value: ORDER_NUMBER_FORMAT.DATE_SEQUENCE,
    label: 'Date + sequence',
    example: '2026070401',
  },
  {
    value: ORDER_NUMBER_FORMAT.PREFIX_DATE_SEQUENCE,
    label: 'Prefix + date + sequence',
    example: 'MAHAVIR-2026070401',
  },
]);

export const ORDER_NUMBER_FORMAT_VALUES = ORDER_NUMBER_FORMATS.map((f) => f.value);

/**
 * Normalize a user-entered bill prefix for storage and `buildOrderNumber`.
 * Returns `null` when empty (caller should use default `"O"`).
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeOrderNumberPrefix(raw) {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  return s.slice(0, ORDER_NUMBER_PREFIX_MAX);
}

/**
 * @param {unknown} raw
 * @returns {'prefix_sequence'|'date_sequence'|'prefix_date_sequence'}
 */
export function normalizeOrderNumberFormat(raw) {
  const s = String(raw || '').trim();
  if (ORDER_NUMBER_FORMAT_VALUES.includes(s)) return s;
  return ORDER_NUMBER_FORMAT.PREFIX_SEQUENCE;
}

/**
 * @param {unknown} bookingDate
 * @param {{ fallbackDate?: unknown }} [opts]
 * @returns {string}
 */
export function formatBookingDateKey(bookingDate, { fallbackDate } = {}) {
  const iso = normalizeSqlDateToIso(bookingDate);
  if (iso) return iso.replace(/-/g, '');
  const fb = normalizeSqlDateToIso(fallbackDate) || todayIndiaISODate();
  return String(fb).replace(/-/g, '');
}

/**
 * @param {number} sequence
 * @returns {string}
 */
function formatDateEmbeddedSequence(sequence) {
  const n = Math.max(0, Math.floor(Number(sequence) || 0));
  if (n >= 100) return String(n);
  return String(n).padStart(2, '0');
}

/**
 * Build a rental booking order number from shop settings and global bill sequence.
 * @param {{ format?: string, prefix?: string, sequence: number, bookingDate?: unknown, previewDate?: unknown }} args
 * @returns {string}
 */
export function buildOrderNumber({
  format,
  prefix = 'O',
  sequence,
  bookingDate,
  previewDate,
} = {}) {
  const fmt = normalizeOrderNumberFormat(format);
  if (
    fmt === ORDER_NUMBER_FORMAT.DATE_SEQUENCE ||
    fmt === ORDER_NUMBER_FORMAT.PREFIX_DATE_SEQUENCE
  ) {
    const dateKey = formatBookingDateKey(bookingDate, { fallbackDate: previewDate });
    const seqSuffix = formatDateEmbeddedSequence(sequence);
    if (fmt === ORDER_NUMBER_FORMAT.DATE_SEQUENCE) {
      return `${dateKey}${seqSuffix}`;
    }
    return `${prefix}-${dateKey}${seqSuffix}`;
  }
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Build a sale number like "S-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildSaleNumber({ prefix = 'S', sequence }) {
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Build a purchase number like "P-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildPurchaseNumber({ prefix = 'P', sequence }) {
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Build a washing job number like "W-0001" from a prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildWashingJobNumber({ prefix = 'W', sequence }) {
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Build an income entry number like "I-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildIncomeNumber({ prefix = 'I', sequence }) {
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Build an expense entry number like "E-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildExpenseNumber({ prefix = 'E', sequence }) {
  const seq = String(sequence).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Financial year label (India): April..March. e.g. "2025-26".
 * @param {Date} [date]
 * @returns {string}
 */
export function financialYear(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}
