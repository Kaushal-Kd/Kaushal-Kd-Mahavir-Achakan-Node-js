import crypto from 'node:crypto';

import {
  defaultHalfHourTimes12,
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
} from '@wrs/shared';

/**
 * Inserts default time slots for a shop when it has none (active).
 * @param {import('knex').Knex} knex
 * @param {string} shopId
 */
export async function ensureDefaultTimeSlotsForShop(knex, shopId) {
  const hasActive = await knex('time_slots').where({ shop_id: shopId, is_active: true }).first();
  if (hasActive) return;

  const times = defaultHalfHourTimes12();
  const rows = times.map((time_value, idx) => ({
    id: crypto.randomUUID(),
    shop_id: shopId,
    time_value,
    sort_order: idx,
    is_active: true,
    is_default_delivery: time_value === FALLBACK_DEFAULT_DELIVERY_TIME,
    is_default_return: time_value === FALLBACK_DEFAULT_RETURN_TIME,
  }));
  await knex('time_slots').insert(rows);
}
