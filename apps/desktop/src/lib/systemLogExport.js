import {
  SYSTEM_LOG_MODULES,
  addDays,
  formatAuditDateTime,
  formatDate,
  formatDateTime,
  systemLogActionLabel,
  toISODate,
} from '@wrs/shared';

import { flattenSystemLogsToChangeRows } from './bookingAuditSummary.js';
import { displayChangeValue } from './snapshotDiffDisplay.js';

const EXPORT_PER_PAGE = 100;

export { EXPORT_PER_PAGE };

export function getDefaultSystemLogDateRange() {
  const today = new Date();
  return {
    from: toISODate(addDays(today, -6)),
    to: toISODate(today),
  };
}

/** @param {string|null|undefined} iso */
export function logDateTimeParts(iso) {
  if (!iso) return { date: '—', time: '—', dateTime: '—' };
  const dateTime = formatDateTime(iso);
  if (!dateTime) return { date: String(iso), time: '—', dateTime: String(iso) };
  const date = formatDate(iso) || '—';
  const time = dateTime.includes(' ') ? dateTime.slice(dateTime.indexOf(' ') + 1) : '—';
  return { date, time, dateTime };
}

/** Audit UI: dd-mm-yyyy HH:mm:ss (24-hour, India time). */
export { formatAuditDateTime } from '@wrs/shared';

/** @param {string|null|undefined} iso */
export function formatChangesWhenLabel(iso) {
  return formatAuditDateTime(iso) || '—';
}

/** @param {string} value */
function moduleLabel(value) {
  return SYSTEM_LOG_MODULES.find((m) => m.value === value)?.label || value || '—';
}

/** @param {string|null|undefined} id */
export function shortRefId(id) {
  if (!id) return '—';
  const s = String(id).replace(/-/g, '');
  return s.slice(0, 8).toUpperCase();
}

/** @param {string} kind */
function changeKindLabel(kind) {
  if (kind === 'added') return 'Added';
  if (kind === 'removed') return 'Removed';
  if (kind === 'changed') return 'Changed';
  return kind || '';
}

/** @param {Array<Record<string, unknown>>} logs */
export function flattenChangesForExport(logs) {
  return flattenSystemLogsToChangeRows(logs).map((row) => {
    const { date, time } = logDateTimeParts(row.created_at);
    const whenLabel = formatChangesWhenLabel(row.created_at);
    return {
      date,
      time,
      changed_on: whenLabel,
      ref_id: shortRefId(row.entity_id),
      entity_id: row.entity_id || '',
      bill_no: row.bill_no || '',
      module: moduleLabel(row.module),
      type: row.changeType === 'product' ? 'Product' : 'Bill',
      action: row.action || '',
      person: row.person || '',
      field: row.label || '',
      old_value: displayChangeValue(row.oldValue),
      new_value: displayChangeValue(row.newValue),
    };
  });
}

/** @deprecated Use flattenChangesForExport — kept for export button label compatibility */
export function flattenProductChangesForExport(logs) {
  return flattenChangesForExport(logs);
}

/** @param {Array<Record<string, unknown>>} logs */
export function buildSummaryExportRows(logs) {
  return (logs || []).map((log) => {
    const { date, time } = logDateTimeParts(log.created_at);
    const whenLabel = formatChangesWhenLabel(log.created_at);
    const productLines = Array.isArray(log.product_changes) ? log.product_changes : [];
    const productSummary = productLines
      .map((ch) => {
        const label = ch.label || ch.path || 'Field';
        const prev = ch.previous ?? '—';
        const next = ch.next ?? '—';
        const kind = ch.kind ? ` (${changeKindLabel(ch.kind)})` : '';
        return `${label}: ${prev} → ${next}${kind}`;
      })
      .join('; ');

    return {
      date,
      time,
      changed_on: whenLabel,
      ref_id: shortRefId(log.entity_id),
      entity_id: log.entity_id || '',
      bill_no: log.bill_no || '',
      module: moduleLabel(log.module),
      user: log.user_name || '',
      action: systemLogActionLabel(log.action_type),
      revision: log.change_count ?? '',
      bill_changes: log.bill_change_count ?? 0,
      product_changes: log.product_change_count ?? 0,
      responsible_by: log.responsible_by || '',
      product_change_details: productSummary,
    };
  });
}

export const SUMMARY_EXPORT_COLUMNS = [
  { key: 'date', header: 'Date' },
  { key: 'time', header: 'Time' },
  { key: 'changed_on', header: 'When' },
  { key: 'ref_id', header: 'Ref. Id' },
  { key: 'entity_id', header: 'Entity Id' },
  { key: 'bill_no', header: 'Bill No.' },
  { key: 'module', header: 'Module' },
  { key: 'user', header: 'User' },
  { key: 'action', header: 'Action' },
  { key: 'revision', header: 'Revision' },
  { key: 'bill_changes', header: 'Bill changes' },
  { key: 'product_changes', header: 'Product changes' },
  { key: 'responsible_by', header: 'Responsible By' },
  { key: 'product_change_details', header: 'Product change details' },
];

export const FLAT_CHANGES_EXPORT_COLUMNS = [
  { key: 'date', header: 'Date' },
  { key: 'time', header: 'Time' },
  { key: 'changed_on', header: 'Date time' },
  { key: 'ref_id', header: 'Ref. Id' },
  { key: 'entity_id', header: 'Entity Id' },
  { key: 'bill_no', header: 'Bill No.' },
  { key: 'module', header: 'Module' },
  { key: 'type', header: 'Type' },
  { key: 'action', header: 'Action' },
  { key: 'person', header: 'Person' },
  { key: 'field', header: 'Field' },
  { key: 'old_value', header: 'Old value' },
  { key: 'new_value', header: 'New value' },
];

/** @deprecated Use FLAT_CHANGES_EXPORT_COLUMNS */
export const PRODUCT_CHANGES_EXPORT_COLUMNS = FLAT_CHANGES_EXPORT_COLUMNS;
