import {
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
  formatOrderTime12,
  normalizeTime12,
} from '@wrs/shared';

import { notFound } from '../utils/errors.js';

/**
 * @param {import('knex').Knex} knex
 * @param {string} shopId
 * @returns {Promise<{
 *   default_delivery_slot_id: string|null,
 *   default_return_slot_id: string|null,
 *   default_delivery_time: string,
 *   default_return_time: string,
 * }>}
 */
export async function getTimeSlotDefaultsForShop(knex, shopId) {
  const rows = await knex('time_slots')
    .where({ shop_id: shopId, is_active: true })
    .select('id', 'time_value', 'is_default_delivery', 'is_default_return');

  const deliveryRow = rows.find((r) => r.is_default_delivery);
  const returnRow = rows.find((r) => r.is_default_return);

  const default_delivery_time =
    (deliveryRow && (normalizeTime12(deliveryRow.time_value) || formatOrderTime12(deliveryRow.time_value))) ||
    FALLBACK_DEFAULT_DELIVERY_TIME;
  const default_return_time =
    (returnRow && (normalizeTime12(returnRow.time_value) || formatOrderTime12(returnRow.time_value))) ||
    FALLBACK_DEFAULT_RETURN_TIME;

  return {
    default_delivery_slot_id: deliveryRow?.id ?? null,
    default_return_slot_id: returnRow?.id ?? null,
    default_delivery_time,
    default_return_time,
  };
}

/**
 * @param {import('knex').Knex} knex
 * @param {string} shopId
 * @param {{ default_delivery_slot_id?: string|null, default_return_slot_id?: string|null }} body
 */
export async function setTimeSlotDefaultsForShop(knex, shopId, body) {
  const deliveryId = body.default_delivery_slot_id ?? null;
  const returnId = body.default_return_slot_id ?? null;

  if (deliveryId) {
    const row = await knex('time_slots')
      .where({ id: deliveryId, shop_id: shopId, is_active: true })
      .first();
    if (!row) throw notFound('Default delivery time slot not found');
  }
  if (returnId) {
    const row = await knex('time_slots')
      .where({ id: returnId, shop_id: shopId, is_active: true })
      .first();
    if (!row) throw notFound('Default return time slot not found');
  }

  await knex.transaction(async (trx) => {
    await trx('time_slots')
      .where({ shop_id: shopId })
      .update({
        is_default_delivery: false,
        is_default_return: false,
        updated_at: trx.fn.now(),
      });

    if (deliveryId) {
      await trx('time_slots').where({ id: deliveryId }).update({
        is_default_delivery: true,
        updated_at: trx.fn.now(),
      });
    }
    if (returnId) {
      await trx('time_slots').where({ id: returnId }).update({
        is_default_return: true,
        updated_at: trx.fn.now(),
      });
    }
  });

  return getTimeSlotDefaultsForShop(knex, shopId);
}
