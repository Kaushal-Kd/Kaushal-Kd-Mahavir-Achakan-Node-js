import { formatIsoDateDisplay } from '@wrs/shared';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  return ISO_DATE.test(String(value || '').trim());
}

export function normalizeDateRange(from, to) {
  const start = isIsoDate(from) ? String(from).slice(0, 10) : '';
  const end = isIsoDate(to) ? String(to).slice(0, 10) : '';
  if (start && end) return start <= end ? { from: start, to: end } : { from: end, to: start };
  if (start) return { from: start, to: start };
  if (end) return { from: end, to: end };
  return { from: '', to: '' };
}

export function formatDateRangeDisplay(from, to) {
  const range = normalizeDateRange(from, to);
  if (!range.from) return '';
  const startLabel = formatIsoDateDisplay(range.from);
  if (range.from === range.to) return startLabel;
  return `${startLabel} – ${formatIsoDateDisplay(range.to)}`;
}

/**
 * First click starts a range; second click completes it (order-independent).
 * A third click after a completed range starts over.
 * @param {{ from: string, to: string, picking: boolean }} state
 * @param {string} iso
 */
export function applyDateRangeClick(state, iso) {
  const day = String(iso || '').slice(0, 10);
  if (!isIsoDate(day)) return state;
  if (!state?.picking || !isIsoDate(state.from)) {
    return { from: day, to: '', picking: true };
  }
  return { ...normalizeDateRange(state.from, day), picking: false };
}

export function isIsoInInclusiveRange(iso, from, to) {
  const day = String(iso || '').slice(0, 10);
  if (!isIsoDate(day)) return false;
  const range = normalizeDateRange(from, to || from);
  if (!range.from) return false;
  return day >= range.from && day <= range.to;
}
