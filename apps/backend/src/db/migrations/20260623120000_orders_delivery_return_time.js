/**
 * Scheduled delivery/return times captured on booking (HH:MM).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasDelivery = await knex.schema.hasColumn('orders', 'delivery_time');
  const hasReturn = await knex.schema.hasColumn('orders', 'return_time');
  if (hasDelivery && hasReturn) return;

  await knex.schema.alterTable('orders', (t) => {
    if (!hasDelivery) t.string('delivery_time', 5).nullable();
    if (!hasReturn) t.string('return_time', 5).nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasDelivery = await knex.schema.hasColumn('orders', 'delivery_time');
  const hasReturn = await knex.schema.hasColumn('orders', 'return_time');
  if (!hasDelivery && !hasReturn) return;

  await knex.schema.alterTable('orders', (t) => {
    if (hasDelivery) t.dropColumn('delivery_time');
    if (hasReturn) t.dropColumn('return_time');
  });
}
