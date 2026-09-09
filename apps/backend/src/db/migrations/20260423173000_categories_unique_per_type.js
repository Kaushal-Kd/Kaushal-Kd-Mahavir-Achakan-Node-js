/**
 * Allow same category key across different category types.
 * Before: unique(shop_id, key)
 * After:  unique(shop_id, category_type, key)
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('categories', (t) => {
    t.dropUnique(['shop_id', 'key']);
  });

  await knex.schema.alterTable('categories', (t) => {
    t.unique(['shop_id', 'category_type', 'key']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('categories', (t) => {
    t.dropUnique(['shop_id', 'category_type', 'key']);
  });

  await knex.schema.alterTable('categories', (t) => {
    t.unique(['shop_id', 'key']);
  });
}
