import { formatSnapshotDisplayValue } from '@wrs/shared';

import { formatAuditDateTime } from './systemLogExport.js';

export { formatSnapshotDisplayValue };

/** @param {unknown} v */
function looksLikeDateTimeValue(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}(T|\s)/.test(s)) return !Number.isNaN(new Date(s).getTime());
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
  return false;
}

/** @param {unknown} v @param {{ maxLength?: number }} [opts] */
export function displayChangeValue(v, opts = {}) {
  const maxLength = opts.maxLength ?? 120;
  if (v === null || v === undefined || v === '') return '—';
  if (looksLikeDateTimeValue(v)) return formatAuditDateTime(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'object') return formatSnapshotDisplayValue(v);
  const s = String(v);
  if (looksLikeDateTimeValue(s)) return formatAuditDateTime(s);
  if (maxLength <= 0 || s.length <= maxLength) return s;
  return `${s.slice(0, maxLength - 1)}…`;
}
