/**
 * @param {{ received?: boolean, gapDays?: number, thresholdDays?: number }} params
 * @returns {boolean}
 */
export function shouldShowNextBookingAlert({ received, gapDays, thresholdDays }) {
  if (received) return false;
  const threshold = Math.max(0, Math.floor(Number(thresholdDays) || 0));
  if (threshold <= 0) return false;
  const gap = Math.floor(Number(gapDays) || 0);
  if (!Number.isFinite(gap) || gap < 0) return false;
  return gap <= threshold;
}

/**
 * @param {{
 *   next_order_id?: string,
 *   next_order_number: string,
 *   next_pickup_date: string,
 *   gap_days: number,
 *   threshold_days?: number,
 *   name_snapshot?: string,
 * }} alert
 * @param {{ productLabel?: string }} [options]
 * @returns {string}
 */
export function formatNextBookingAlertMessage(alert, options = {}) {
  const gap = Math.max(0, Math.floor(Number(alert.gap_days) || 0));
  const gapLabel = gap === 1 ? '1-day gap' : `${gap}-day gap`;
  const productLabel = String(options.productLabel || alert.name_snapshot || '').trim();
  const bookingPart = `Next booking ${alert.next_order_number} on ${alert.next_pickup_date} (${gapLabel})`;
  return productLabel ? `${productLabel} · ${bookingPart}` : bookingPart;
}

/**
 * Normalize DB / JSON date values to `YYYY-MM-DD` for alerts and UI.
 * Knex + mysql2 often return JS `Date` for DATE columns; `String(date)` is not ISO.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeNextPickupDateToIso(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${day}`;
    }
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${mo}-${day}`;
    }
  }
  return null;
}

/**
 * @param {unknown} nextBooking
 * @param {number} thresholdDays
 * @returns {null | {
 *   next_order_id: string,
 *   next_order_number: string,
 *   next_pickup_date: string,
 *   gap_days: number,
 *   threshold_days: number,
 * }}
 */
export function buildNextBookingAlert(nextBooking, thresholdDays) {
  if (!nextBooking) return null;
  const gapDays = Math.floor(Number(nextBooking.gap_days) || 0);
  if (
    !shouldShowNextBookingAlert({
      received: false,
      gapDays,
      thresholdDays,
    })
  ) {
    return null;
  }
  const pickupIso = normalizeNextPickupDateToIso(nextBooking.next_pickup_date) || '';
  return {
    next_order_id: String(nextBooking.next_order_id),
    next_order_number: String(nextBooking.next_order_number),
    next_pickup_date: pickupIso,
    gap_days: gapDays,
    threshold_days: Math.max(0, Math.floor(Number(thresholdDays) || 0)),
  };
}

/**
 * @param {Array<{
 *   type?: string,
 *   product_id?: string | null,
 *   stage_flags?: { received?: boolean },
 *   next_booking_alert?: unknown,
 * }>} items
 * @param {Map<string, {
 *   next_order_id: string,
 *   next_order_number: string,
 *   next_pickup_date: string,
 *   gap_days: number,
 * }>} nextByProductId
 * @param {number} thresholdDays
 */
export function applyNextBookingAlertsToItems(items, nextByProductId, thresholdDays) {
  for (const item of items) {
    item.next_booking_alert = null;
    if (String(item.type || '').toLowerCase() !== 'rent' || !item.product_id) continue;
    if (item.stage_flags?.received) continue;
    const next = nextByProductId.get(String(item.product_id));
    item.next_booking_alert = buildNextBookingAlert(next, thresholdDays);
  }
}

/**
 * Earliest next pickup among order-level `next_booking_alerts` (one alert per product with a conflict).
 *
 * @param {Array<{ next_pickup_date?: string }> | null | undefined} alerts
 * @returns {string | null} ISO date `YYYY-MM-DD`, or null if none
 */
export function earliestNextBookingPickupIsoFromAlerts(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  let best = null;
  for (const a of alerts) {
    const iso = normalizeNextPickupDateToIso(a?.next_pickup_date);
    if (!iso) continue;
    if (best == null || iso < best) best = iso;
  }
  return best;
}

/**
 * Unique next bookings from order-level alerts, sorted by pickup date ascending.
 * Skips alerts without `next_order_id`.
 *
 * @param {Array<{ next_order_id?: string, next_order_number?: string, next_pickup_date?: unknown }> | null | undefined} alerts
 * @returns {Array<{ next_order_id: string, next_order_number: string, next_pickup_date: string }>}
 */
export function uniqueNextBookingsFromAlerts(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return [];
  const byKey = new Map();
  for (const alert of alerts) {
    const orderId = String(alert?.next_order_id || '').trim();
    if (!orderId) continue;
    const orderNumber = String(alert?.next_order_number || '').trim() || orderId;
    const pickupIso = normalizeNextPickupDateToIso(alert?.next_pickup_date) || '';
    const dedupeKey = orderId || orderNumber;
    const existing = byKey.get(dedupeKey);
    if (!existing || (pickupIso && (!existing.next_pickup_date || pickupIso < existing.next_pickup_date))) {
      byKey.set(dedupeKey, {
        next_order_id: orderId,
        next_order_number: orderNumber,
        next_pickup_date: pickupIso,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const da = a.next_pickup_date || '9999-99-99';
    const db = b.next_pickup_date || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    return a.next_order_number.localeCompare(b.next_order_number);
  });
}
