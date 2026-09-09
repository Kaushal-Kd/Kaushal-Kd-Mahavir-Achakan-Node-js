import { randomUUID } from 'node:crypto';

const LEGACY_CHECKLIST_KEY = 'config.order_defaults.checklist_next_booking_alert_days';
const APP_CHECKLIST_KEY = 'CHECKLIST_NEXT_BOOKING_ALERT_DAYS';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('shops').select('id');
  for (const shop of shops) {
    const shopId = shop.id;
    const legacy = await knex('settings').where({ shop_id: shopId, key: LEGACY_CHECKLIST_KEY }).first();
    const appRow = await knex('settings').where({ shop_id: shopId, key: APP_CHECKLIST_KEY }).first();
    if (legacy?.value != null && !appRow) {
      const safe = Math.max(0, Math.floor(Number(legacy.value) || 0));
      await knex('settings').insert({
        id: randomUUID(),
        shop_id: shopId,
        key: APP_CHECKLIST_KEY,
        value: String(safe),
        updated_at: knex.fn.now(),
      });
    }
    await knex('settings').where({ shop_id: shopId, key: LEGACY_CHECKLIST_KEY }).del();
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Legacy checklist key is not restored automatically.
}
