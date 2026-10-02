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

/** Padded width for PREFIX-0001 style document numbers. */
export const DOCUMENT_SEQUENCE_PAD = 4;

export const DOCUMENT_START_SEQUENCE_MIN = 1;
export const DOCUMENT_START_SEQUENCE_MAX = 999999999;

/**
 * Transaction modules that each keep their own prefix + sequence.
 * `letterPrefix` types historically prepended the booking prefix (S+MAHAVIR).
 */
export const DOCUMENT_NUMBER_TYPES = Object.freeze([
  {
    key: 'booking',
    label: 'Bookings',
    defaultPrefix: 'O',
    hasFormat: true,
  },
  {
    key: 'sale',
    label: 'Sales',
    defaultPrefix: 'S',
    letterPrefix: true,
  },
  {
    key: 'custom_order',
    label: 'Custom Orders',
    defaultPrefix: 'CO',
  },
  {
    key: 'purchase',
    label: 'Purchases',
    defaultPrefix: 'P',
    letterPrefix: true,
  },
  {
    key: 'income',
    label: 'Income',
    defaultPrefix: 'I',
    letterPrefix: true,
  },
  {
    key: 'expense',
    label: 'Expense',
    defaultPrefix: 'E',
    letterPrefix: true,
  },
  {
    key: 'washing',
    label: 'Washing',
    defaultPrefix: 'W',
  },
  {
    key: 'payment_voucher',
    label: 'Payment Voucher',
    defaultPrefix: 'PV',
  },
  {
    key: 'receipt_voucher',
    label: 'Receipt Voucher',
    defaultPrefix: 'RV',
  },
  {
    key: 'credit_note',
    label: 'Credit Notes',
    defaultPrefix: 'CN',
  },
]);

export const DOCUMENT_NUMBER_TYPE_KEYS = DOCUMENT_NUMBER_TYPES.filter((t) => t.key !== 'booking').map(
  (t) => t.key
);

export const DOCUMENT_NUMBER_TYPE_BY_KEY = Object.freeze(
  Object.fromEntries(DOCUMENT_NUMBER_TYPES.map((t) => [t.key, t]))
);

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
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizeStartSequence(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < DOCUMENT_START_SEQUENCE_MIN) return DOCUMENT_START_SEQUENCE_MIN;
  if (n > DOCUMENT_START_SEQUENCE_MAX) return DOCUMENT_START_SEQUENCE_MAX;
  return n;
}

/**
 * Next sequence is the configured start, or one past the highest already used.
 * @param {unknown} maxExisting
 * @param {unknown} startSequence
 * @returns {number}
 */
export function nextDocumentSequence(maxExisting, startSequence) {
  const start = normalizeStartSequence(startSequence);
  const max = Math.max(0, Math.floor(Number(maxExisting) || 0));
  return Math.max(start, max + 1);
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function escapePrefixForRegExp(prefix) {
  return String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highest trailing sequence for `PREFIX-0007` style numbers. Ignores date/hex ids.
 * @param {unknown[]} values
 * @param {unknown} prefix
 * @returns {number}
 */
export function maxPrefixedSequence(values, prefix) {
  const p = normalizeOrderNumberPrefix(prefix);
  if (!p) return 0;
  const re = new RegExp(`^${escapePrefixForRegExp(p)}-(\\d+)$`, 'i');
  let max = 0;
  for (const value of values || []) {
    const match = String(value || '').trim().match(re);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function parseDocumentNumberingJson(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore invalid JSON */
  }
  return {};
}

/**
 * Historical default: sales used `S` + booking prefix (`SMAHAVIR`).
 * @param {string} letter
 * @param {unknown} bookingPrefix
 * @returns {string}
 */
export function composeLetterDocumentPrefix(letter, bookingPrefix) {
  const letterPrefix = normalizeOrderNumberPrefix(letter) || 'X';
  const shop = normalizeOrderNumberPrefix(bookingPrefix);
  if (!shop) return letterPrefix;
  return `${letterPrefix}${shop}`.slice(0, ORDER_NUMBER_PREFIX_MAX);
}

/**
 * @param {{ key: string, defaultPrefix: string, letterPrefix?: boolean }} type
 * @param {unknown} bookingPrefix
 * @param {{ customOrderPrefix?: unknown }} [extras]
 * @returns {string}
 */
export function defaultPrefixForDocumentType(type, bookingPrefix, extras = {}) {
  if (type.key === 'booking') {
    return normalizeOrderNumberPrefix(bookingPrefix) || type.defaultPrefix;
  }
  if (type.key === 'custom_order') {
    return (
      normalizeOrderNumberPrefix(extras.customOrderPrefix) ||
      type.defaultPrefix
    );
  }
  if (type.letterPrefix) {
    return composeLetterDocumentPrefix(type.defaultPrefix, bookingPrefix);
  }
  return type.defaultPrefix;
}

/**
 * Build PREFIX-0001 (sequence is left-padded to 4, then grows naturally).
 * @param {{ prefix?: string, sequence: number, pad?: number }} args
 * @returns {string}
 */
export function buildPrefixedDocumentNumber({ prefix = 'O', sequence, pad = DOCUMENT_SEQUENCE_PAD } = {}) {
  const n = Math.max(1, Math.floor(Number(sequence) || 1));
  const width = Math.max(1, Math.floor(Number(pad) || DOCUMENT_SEQUENCE_PAD));
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

/**
 * Effective numbering for every document type from shop columns + JSON.
 * @param {{
 *   order_number_prefix?: unknown,
 *   order_number_format?: unknown,
 *   order_start_sequence?: unknown,
 *   document_numbering?: unknown,
 * }} [shop]
 * @param {{ customOrderPrefix?: unknown }} [extras]
 */
export function resolveShopDocumentNumbering(shop = {}, extras = {}) {
  const stored = parseDocumentNumberingJson(shop?.document_numbering);
  const bookingPrefix = normalizeOrderNumberPrefix(shop?.order_number_prefix);
  const bookingFormat = normalizeOrderNumberFormat(shop?.order_number_format);
  const bookingStart = normalizeStartSequence(shop?.order_start_sequence);
  const documents = {};

  for (const type of DOCUMENT_NUMBER_TYPES) {
    if (type.key === 'booking') {
      const prefix = bookingPrefix || type.defaultPrefix;
      documents.booking = {
        prefix: bookingPrefix,
        effective_prefix: prefix,
        format: bookingFormat,
        start_sequence: bookingStart,
        preview: buildOrderNumber({
          format: bookingFormat,
          prefix,
          sequence: bookingStart,
          previewDate: todayIndiaISODate(),
        }),
      };
      continue;
    }

    const row = stored[type.key] && typeof stored[type.key] === 'object' ? stored[type.key] : {};
    const savedPrefix = Object.prototype.hasOwnProperty.call(row, 'prefix')
      ? normalizeOrderNumberPrefix(row.prefix)
      : null;
    const hasSaved = Object.prototype.hasOwnProperty.call(stored, type.key);
    const effectivePrefix =
      savedPrefix ||
      (hasSaved ? type.defaultPrefix : defaultPrefixForDocumentType(type, bookingPrefix, extras));
    const startSequence = Object.prototype.hasOwnProperty.call(row, 'start_sequence')
      ? normalizeStartSequence(row.start_sequence)
      : DOCUMENT_START_SEQUENCE_MIN;

    documents[type.key] = {
      prefix: savedPrefix,
      effective_prefix: effectivePrefix,
      start_sequence: startSequence,
      preview: buildPrefixedDocumentNumber({
        prefix: effectivePrefix,
        sequence: startSequence,
      }),
    };
  }

  return {
    order_number_prefix: bookingPrefix,
    order_number_format: bookingFormat,
    order_start_sequence: bookingStart,
    documents,
  };
}

/**
 * JSON payload persisted on `shops.document_numbering` (booking stays on dedicated columns).
 * @param {unknown} documents
 * @returns {Record<string, { prefix: string|null, start_sequence: number }>}
 */
export function serializeDocumentNumbering(documents) {
  const src = documents && typeof documents === 'object' ? documents : {};
  const out = {};
  for (const key of DOCUMENT_NUMBER_TYPE_KEYS) {
    const row = src[key] && typeof src[key] === 'object' ? src[key] : {};
    out[key] = {
      prefix: normalizeOrderNumberPrefix(row.prefix),
      start_sequence: normalizeStartSequence(row.start_sequence),
    };
  }
  return out;
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
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build a sale number like "S-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildSaleNumber({ prefix = 'S', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build a purchase number like "P-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildPurchaseNumber({ prefix = 'P', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build a washing job number like "W-0001" from a prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildWashingJobNumber({ prefix = 'W', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build an income entry number like "I-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildIncomeNumber({ prefix = 'I', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build an expense entry number like "E-0001" from a shop prefix and running sequence.
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildExpenseNumber({ prefix = 'E', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build a payment voucher number like "PV-0001".
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildPaymentVoucherNumber({ prefix = 'PV', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build a receipt voucher number like "RV-0001".
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildReceiptVoucherNumber({ prefix = 'RV', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
}

/**
 * Build a credit note number like "CN-0001".
 * @param {{ prefix?: string, sequence: number }} args
 * @returns {string}
 */
export function buildCreditNoteNumber({ prefix = 'CN', sequence }) {
  return buildPrefixedDocumentNumber({ prefix, sequence });
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
