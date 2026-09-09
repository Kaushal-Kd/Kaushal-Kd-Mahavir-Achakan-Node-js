import { ensureDefaultTimeSlotsForShop } from '../../lib/defaultTimeSlots.js';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('shops').select('id');
  for (const { id: shopId } of shops) {
    await ensureDefaultTimeSlotsForShop(knex, shopId);
  }
}

/** @param {import('knex').Knex} knex */
export async function down() {
  /* Data seed: no safe automatic rollback without marking inserted rows. */
}
