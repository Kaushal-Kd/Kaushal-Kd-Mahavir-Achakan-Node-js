/**
 * Per-shop rental booking bill number format (prefix / date / sequence).
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('shops', 'order_number_format');
  if (!hasColumn) {
    await knex.schema.alterTable('shops', (t) => {
      t.string('order_number_format', 32).nullable().defaultTo('prefix_sequence');
    });
  }

  await knex('shops')
    .whereNull('order_number_format')
    .orWhere('order_number_format', '')
    .update({ order_number_format: 'prefix_sequence' });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('shops', 'order_number_format');
  if (hasColumn) {
    await knex.schema.alterTable('shops', (t) => {
      t.dropColumn('order_number_format');
    });
  }
}
