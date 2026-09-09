/**
 * Remove deprecated booking fields from orders table.
 *
 * payment_mode and tax_mode are no longer used in booking flow.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasPaymentMode = await knex.schema.hasColumn('orders', 'payment_mode');
  const hasTaxMode = await knex.schema.hasColumn('orders', 'tax_mode');

  if (!hasPaymentMode && !hasTaxMode) return;

  await knex.schema.alterTable('orders', (t) => {
    if (hasPaymentMode) t.dropColumn('payment_mode');
    if (hasTaxMode) t.dropColumn('tax_mode');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasPaymentMode = await knex.schema.hasColumn('orders', 'payment_mode');
  const hasTaxMode = await knex.schema.hasColumn('orders', 'tax_mode');

  await knex.schema.alterTable('orders', (t) => {
    if (!hasPaymentMode) t.enu('payment_mode', ['cash', 'upi', 'card', 'bank']).nullable();
    if (!hasTaxMode) t.enu('tax_mode', ['exclusive', 'inclusive']).notNullable().defaultTo('exclusive');
  });
}
