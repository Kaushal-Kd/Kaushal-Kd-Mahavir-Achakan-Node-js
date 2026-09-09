/**
 * Remove order_items.send_to_laundry flag after laundry module removal.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('order_items', 'send_to_laundry');
  if (hasColumn) {
    await knex.schema.alterTable('order_items', (t) => {
      t.dropColumn('send_to_laundry');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('order_items', 'send_to_laundry');
  if (!hasColumn) {
    await knex.schema.alterTable('order_items', (t) => {
      t.boolean('send_to_laundry').notNullable().defaultTo(false);
    });
  }
}
