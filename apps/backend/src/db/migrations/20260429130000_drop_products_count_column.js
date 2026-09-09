/**
 * Remove stored products.count since count is now computed live from orders.
 */
export async function up(knex) {
  const hasProducts = await knex.schema.hasTable('products');
  if (!hasProducts) return;

  const hasCount = await knex.schema.hasColumn('products', 'count');
  if (!hasCount) return;

  await knex.schema.alterTable('products', (t) => {
    t.dropColumn('count');
  });
}

export async function down(knex) {
  const hasProducts = await knex.schema.hasTable('products');
  if (!hasProducts) return;

  const hasCount = await knex.schema.hasColumn('products', 'count');
  if (hasCount) return;

  await knex.schema.alterTable('products', (t) => {
    t.integer('count').notNullable().defaultTo(0);
  });
}
