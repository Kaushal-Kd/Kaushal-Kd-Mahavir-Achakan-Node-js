/**
 * Optional trial product reference (code or name) on custom orders.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('custom_orders', 'trial_product');
  if (!hasColumn) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.string('trial_product', 200).nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('custom_orders', 'trial_product');
  if (hasColumn) {
    await knex.schema.alterTable('custom_orders', (t) => {
      t.dropColumn('trial_product');
    });
  }
}
