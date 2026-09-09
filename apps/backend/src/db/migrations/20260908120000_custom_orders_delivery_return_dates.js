/**
 * Replace marriage_date with delivery_date + return_date on custom_orders.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('custom_orders');
  if (!hasTable) return;

  const hasMarriage = await knex.schema.hasColumn('custom_orders', 'marriage_date');
  const hasDelivery = await knex.schema.hasColumn('custom_orders', 'delivery_date');

  if (!hasDelivery) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.date('delivery_date').nullable();
      t.date('return_date').nullable();
    });
  }

  if (hasMarriage) {
    await knex('custom_orders')
      .whereNotNull('marriage_date')
      .whereNull('delivery_date')
      .update({ delivery_date: knex.raw('marriage_date') });

    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropIndex(['shop_id', 'marriage_date']);
    });

    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('marriage_date');
    });
  }

  const hasDeliveryIndex = await knex.schema.hasColumn('custom_orders', 'delivery_date');
  if (hasDeliveryIndex) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.index(['shop_id', 'delivery_date']);
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('custom_orders');
  if (!hasTable) return;

  const hasDelivery = await knex.schema.hasColumn('custom_orders', 'delivery_date');
  const hasMarriage = await knex.schema.hasColumn('custom_orders', 'marriage_date');

  if (hasDelivery) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropIndex(['shop_id', 'delivery_date']);
    });
  }

  if (!hasMarriage) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.date('marriage_date').nullable();
    });

    await knex('custom_orders')
      .whereNotNull('delivery_date')
      .update({ marriage_date: knex.raw('delivery_date') });

    await knex.schema.alterTable('custom_orders', (t) => {
      t.index(['shop_id', 'marriage_date']);
    });
  }

  if (hasDelivery) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('delivery_date');
      t.dropColumn('return_date');
    });
  }
}
