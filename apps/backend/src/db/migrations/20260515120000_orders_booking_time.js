/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('orders', 'booking_time');
  if (has) return;
  await knex.schema.alterTable('orders', (t) => {
    t.string('booking_time', 5).nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('orders', 'booking_time');
  if (!has) return;
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('booking_time');
  });
}
