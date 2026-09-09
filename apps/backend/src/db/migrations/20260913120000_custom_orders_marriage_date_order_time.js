/**
 * Restore marriage_date and add order_time (12h) for custom orders.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('custom_orders');
  if (!hasTable) return;

  const hasMarriage = await knex.schema.hasColumn('custom_orders', 'marriage_date');
  const hasOrderTime = await knex.schema.hasColumn('custom_orders', 'order_time');

  if (!hasMarriage || !hasOrderTime) {
    await knex.schema.alterTable('custom_orders', (t) => {
      if (!hasMarriage) t.date('marriage_date').nullable();
      if (!hasOrderTime) t.string('order_time', 12).nullable();
    });
  }

  if (!hasMarriage) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.index(['shop_id', 'marriage_date']);
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('custom_orders');
  if (!hasTable) return;

  const hasMarriage = await knex.schema.hasColumn('custom_orders', 'marriage_date');
  const hasOrderTime = await knex.schema.hasColumn('custom_orders', 'order_time');

  if (hasMarriage) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropIndex(['shop_id', 'marriage_date']);
    });
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('marriage_date');
    });
  }

  if (hasOrderTime) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('order_time');
    });
  }
}
