import { randomUUID } from 'node:crypto';

/**
 * Copy legacy config.gst / config.order_defaults gap into app-settings keys,
 * then remove legacy keys.
 */

const LEGACY_GAP_KEY = 'config.order_defaults.next_booking_gap_days';
const LEGACY_GST_ENABLED_KEY = 'config.gst.enabled';
const LEGACY_GST_RATE_KEY = 'config.gst.default_rate';
const APP_GAP_KEY = 'CHECK_AVAILABILITY_GAP_DAYS_BETWEEN_TWO_ORDERS';
const APP_GST_KEY = 'GST_PERCENTAGE';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('shops').select('id');
  for (const shop of shops) {
    const shopId = shop.id;

    const gapRow = await knex('settings').where({ shop_id: shopId, key: LEGACY_GAP_KEY }).first();
    const appGapRow = await knex('settings').where({ shop_id: shopId, key: APP_GAP_KEY }).first();
    if (gapRow?.value != null && !appGapRow) {
      const safe = Math.max(0, Math.floor(Number(gapRow.value) || 0));
      await knex('settings').insert({
        id: randomUUID(),
        shop_id: shopId,
        key: APP_GAP_KEY,
        value: String(safe),
        updated_at: knex.fn.now(),
      });
    }

    const gstEnabledRow = await knex('settings')
      .where({ shop_id: shopId, key: LEGACY_GST_ENABLED_KEY })
      .first();
    const gstRateRow = await knex('settings')
      .where({ shop_id: shopId, key: LEGACY_GST_RATE_KEY })
      .first();
    const appGstRow = await knex('settings').where({ shop_id: shopId, key: APP_GST_KEY }).first();
    if (!appGstRow && (gstEnabledRow || gstRateRow)) {
      const enabledRaw = String(gstEnabledRow?.value ?? '1').toLowerCase();
      const enabled = !(enabledRaw === '0' || enabledRaw === 'false' || enabledRaw === 'no');
      const rateNum = Number(gstRateRow?.value ?? 0);
      const rate = Number.isFinite(rateNum) ? Math.max(0, Math.min(100, rateNum)) : 0;
      const value = enabled && rate > 0 ? `${rate}|${rate}` : '0|0';
      await knex('settings').insert({
        id: randomUUID(),
        shop_id: shopId,
        key: APP_GST_KEY,
        value,
        updated_at: knex.fn.now(),
      });
    }

    await knex('settings').where({ shop_id: shopId, key: LEGACY_GAP_KEY }).del();
    await knex('settings').where({ shop_id: shopId, key: LEGACY_GST_ENABLED_KEY }).del();
    await knex('settings').where({ shop_id: shopId, key: LEGACY_GST_RATE_KEY }).del();
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Legacy keys are not restored automatically.
}
