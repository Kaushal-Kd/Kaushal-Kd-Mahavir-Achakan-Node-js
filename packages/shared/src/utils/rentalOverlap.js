import { addDays, toLocalISODate } from './date.js';

/**
 * Normalize to YYYY-MM-DD or null.
 * @param {unknown} value
 * @returns {string | null}
 */
export function toIsoDateOnly(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toLocalISODate(value);
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Add signed days to an ISO date string.
 * @param {string} iso
 * @param {number} days
 * @returns {string | null}
 */
export function addDaysIso(iso, days) {
  const base = toIsoDateOnly(iso);
  if (!base) return null;
  const next = addDays(`${base}T12:00:00`, Number(days) || 0);
  return next ? toLocalISODate(next) : null;
}

/**
 * Whether rental window [from, to] overlaps an existing order block
 * [pickup - prevGap, return + nextGap] (inclusive dates).
 *
 * @param {string} from
 * @param {string} to
 * @param {unknown} pickupDate
 * @param {unknown} returnDate
 * @param {number} [nextGapDays]
 * @param {number} [prevGapDays]
 * @returns {boolean}
 */
export function rentalDateRangeOverlaps(from, to, pickupDate, returnDate, nextGapDays = 0, prevGapDays = 0) {
  const winFrom = toIsoDateOnly(from);
  const winTo = toIsoDateOnly(to);
  const pickup = toIsoDateOnly(pickupDate);
  const ret = toIsoDateOnly(returnDate) || pickup;
  if (!winFrom || !winTo || !pickup || !ret) return false;

  const nextGap = Math.max(0, Math.floor(Number(nextGapDays) || 0));
  const prevGap = Math.max(0, Math.floor(Number(prevGapDays) || 0));
  const effectiveStart = addDaysIso(pickup, -prevGap);
  const effectiveEnd = addDaysIso(ret, nextGap);
  if (!effectiveStart || !effectiveEnd) return false;

  return effectiveStart <= winTo && effectiveEnd >= winFrom;
}

/**
 * Latest return date allowed before a later booking pickup (previous-gap rule).
 * @param {unknown} pickupDate
 * @param {number} prevGapDays
 * @returns {string | null}
 */
export function latestReturnBeforePickupGap(pickupDate, prevGapDays) {
  const pickup = toIsoDateOnly(pickupDate);
  const prevGap = Math.max(0, Math.floor(Number(prevGapDays) || 0));
  if (!pickup || prevGap <= 0) return null;
  return addDaysIso(pickup, -(prevGap + 1));
}

/**
 * Earliest pickup allowed after a prior booking return (next-gap rule).
 * @param {unknown} returnDate
 * @param {unknown} pickupDate
 * @param {number} nextGapDays
 * @returns {string | null}
 */
export function earliestPickupAfterReturnGap(returnDate, pickupDate, nextGapDays) {
  const base = toIsoDateOnly(returnDate) || toIsoDateOnly(pickupDate);
  const nextGap = Math.max(0, Math.floor(Number(nextGapDays) || 0));
  if (!base) return null;
  return addDaysIso(base, nextGap + 1);
}
