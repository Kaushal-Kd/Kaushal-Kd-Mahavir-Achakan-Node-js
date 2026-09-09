/** Dashboard KPI drill-down: show all orders for the date (matches KPI count). */
export const DRILL_TODAY = 'today';

/**
 * @param {import('react-router-dom').URLSearchParams | null | undefined} searchParams
 */
export function isDrillToday(searchParams) {
  return String(searchParams?.get('drill') || '').trim() === DRILL_TODAY;
}

/**
 * @param {import('react-router-dom').URLSearchParams} searchParams
 * @returns {URLSearchParams}
 */
export function clearDrillParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  next.delete('drill');
  next.delete('bucket');
  return next;
}

/**
 * Update a date query param and clear drill/bucket locks.
 * @param {import('react-router-dom').URLSearchParams} searchParams
 * @param {'from' | 'to'} key
 * @param {string} value
 * @returns {URLSearchParams}
 */
export function syncDateParam(searchParams, key, value) {
  const next = clearDrillParams(searchParams);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}
