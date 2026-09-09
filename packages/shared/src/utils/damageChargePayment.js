/**
 * Booking payments created when missing/damage charges are collected or reversed
 * (see orders service `updateItemCondition`).
 *
 * @param {string|null|undefined} notes
 * @returns {boolean}
 */
export function isDamageChargePayment(notes) {
  const n = String(notes ?? '').toLowerCase();
  return n.includes('damage charge') || n.includes('damage_item:');
}
