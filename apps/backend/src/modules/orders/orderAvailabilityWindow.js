import { normalizeSqlDateToIso } from '@wrs/shared';

/**
 * Normalize MySQL DATE values before passing them to availability services.
 * A missing return date means a same-day booking; an invalid stored date does not.
 * @param {{ pickup_date?: unknown, return_date?: unknown } | null | undefined} order
 * @returns {{ from: string, to: string } | null}
 */
export function normalizeOrderAvailabilityWindow(order) {
  const from = normalizeSqlDateToIso(order?.pickup_date);
  const returnDateMissing = order?.return_date == null || order.return_date === '';
  const to = returnDateMissing ? from : normalizeSqlDateToIso(order.return_date);

  if (!from || !to) return null;
  return { from, to };
}
