/**
 * Persist user-defined product line sequence on bookings (checklist + create order).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('order_items', 'display_order');
  if (!hasColumn) {
    await knex.schema.alterTable('order_items', (t) => {
      t.integer('display_order').notNullable().defaultTo(0);
    });

    await knex.raw(`
      UPDATE order_items oi
      INNER JOIN (
        SELECT id, (ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at) - 1) * 10 AS rn
        FROM order_items
      ) ranked ON ranked.id = oi.id
      SET oi.display_order = ranked.rn
    `);
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('order_items', 'display_order');
  if (hasColumn) {
    await knex.schema.alterTable('order_items', (t) => {
      t.dropColumn('display_order');
    });
  }
}
