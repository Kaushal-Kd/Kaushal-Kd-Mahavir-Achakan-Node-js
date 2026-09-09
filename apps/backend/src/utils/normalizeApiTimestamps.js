import { serializeInstant } from './serializeInstant.js';

/**
 * TIMESTAMP columns that represent an instant in time and must be emitted as
 * ISO-8601 UTC (with Z) so the frontend can convert them to India time.
 *
 * NOTE: wall-clock DATETIME columns (e.g. `laundry_at`) are intentionally
 * excluded — they store the exact clock value the user entered and must not be
 * shifted to UTC.
 */
export const DEFAULT_INSTANT_FIELDS = [
  'created_at',
  'updated_at',
  'deleted_at',
  'delivered_at',
  'prepared_at',
  'received_at',
  'packed_at',
  'canceled_at',
  'cancelled_at',
  'completed_at',
  'settled_at',
  'last_login_at',
  'items_received_at',
  'product_delivered_at',
  'product_received_at',
  'event_at',
  'queued_at',
  'generated_at',
  'read_at',
  'synced_at',
  'returned_at',
];

/**
 * Normalize instant timestamp fields on a plain row object to ISO UTC strings.
 * @template {Record<string, unknown>} T
 * @param {T|null|undefined} row
 * @param {readonly string[]} [fields]
 * @returns {T}
 */
export function normalizeApiTimestamps(row, fields = DEFAULT_INSTANT_FIELDS) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const key of fields) {
    if (out[key] != null) {
      out[key] = serializeInstant(out[key]) ?? out[key];
    }
  }
  return out;
}

/**
 * Normalize instant timestamp fields for a list of rows.
 * @param {Array<Record<string, unknown>>|null|undefined} rows
 * @param {readonly string[]} [fields]
 */
export function normalizeApiTimestampsList(rows, fields = DEFAULT_INSTANT_FIELDS) {
  return Array.isArray(rows) ? rows.map((r) => normalizeApiTimestamps(r, fields)) : rows;
}

const INSTANT_FIELD_SET = new Set(DEFAULT_INSTANT_FIELDS);

/**
 * Recursively convert known instant timestamp fields to ISO UTC (with Z) in
 * place. Used as a response-wide normalizer so every module's payload emits
 * consistent instants regardless of how each service builds its rows.
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function normalizeInstantFieldsDeep(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      normalizeInstantFieldsDeep(value[i], seen);
    }
    return value;
  }

  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child == null) continue;
    const isInstantValue = child instanceof Date || typeof child === 'string' || typeof child === 'number';
    if (INSTANT_FIELD_SET.has(key) && isInstantValue) {
      value[key] = serializeInstant(child) ?? child;
    } else if (typeof child === 'object') {
      normalizeInstantFieldsDeep(child, seen);
    }
  }
  return value;
}
