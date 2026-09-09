/**
 * Drop orders.cancel_reason (no longer collected in UI).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('orders', 'cancel_reason');
  if (!has) return;
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('cancel_reason');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('orders', 'cancel_reason');
  if (has) return;
  await knex.schema.alterTable('orders', (t) => {
    t.text('cancel_reason').nullable();
  });
}

