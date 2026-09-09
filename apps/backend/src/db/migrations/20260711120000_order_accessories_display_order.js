/**
 * Persist accessory line order (matches product/category recommendation display_order).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('order_accessories', 'display_order');
  if (!hasColumn) {
    await knex.schema.alterTable('order_accessories', (t) => {
      t.integer('display_order').notNullable().defaultTo(0);
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('order_accessories', 'display_order');
  if (hasColumn) {
    await knex.schema.alterTable('order_accessories', (t) => {
      t.dropColumn('display_order');
    });
  }
}
