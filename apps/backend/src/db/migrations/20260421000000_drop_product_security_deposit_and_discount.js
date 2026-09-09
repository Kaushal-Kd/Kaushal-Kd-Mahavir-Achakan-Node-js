/**
 * Remove unused `security_deposit` and `discount_percent` columns from the
 * `products` table. These were never surfaced in the product form and are
 * captured per-order (see `orders.security_deposit`) rather than per-product.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasSecurity = await knex.schema.hasColumn('products', 'security_deposit');
  const hasDiscount = await knex.schema.hasColumn('products', 'discount_percent');
  if (!hasSecurity && !hasDiscount) return;

  await knex.schema.alterTable('products', (t) => {
    if (hasSecurity) t.dropColumn('security_deposit');
    if (hasDiscount) t.dropColumn('discount_percent');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasSecurity = await knex.schema.hasColumn('products', 'security_deposit');
  const hasDiscount = await knex.schema.hasColumn('products', 'discount_percent');

  await knex.schema.alterTable('products', (t) => {
    if (!hasSecurity) {
      t.decimal('security_deposit', 12, 2).notNullable().defaultTo(0);
    }
    if (!hasDiscount) {
      t.decimal('discount_percent', 5, 2).notNullable().defaultTo(0);
    }
  });
}
