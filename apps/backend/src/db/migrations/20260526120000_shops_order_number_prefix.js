/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('shops', (t) => {
    t.string('order_number_prefix', 12).nullable().comment('Booking / bill number prefix (per shop)');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('shops', (t) => {
    t.dropColumn('order_number_prefix');
  });
}
