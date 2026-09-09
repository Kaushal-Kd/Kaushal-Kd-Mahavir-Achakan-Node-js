/**
 * Split category usage into:
 * - categories.category_type = product | accessory
 * - accessory_product_categories for accessory -> product-category mapping
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('categories', (t) => {
    t.enu('category_type', ['product', 'accessory']).notNullable().defaultTo('product');
  });

  await knex.schema.createTable('accessory_product_categories', (t) => {
    t.uuid('accessory_id').notNullable();
    t.uuid('category_id').notNullable();
    t.primary(['accessory_id', 'category_id']);
    t.foreign('accessory_id').references('accessories.id').onDelete('CASCADE');
    t.foreign('category_id').references('categories.id').onDelete('CASCADE');
  });

  // Existing accessory_categories rows were previously used as product-category
  // mapping for recommendations; preserve that mapping in the new table.
  await knex.raw(`
    INSERT IGNORE INTO accessory_product_categories (accessory_id, category_id)
    SELECT accessory_id, category_id
    FROM accessory_categories
  `);

  // accessory_categories is now reserved for accessory-type classification.
  await knex('accessory_categories').del();
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  // Restore previous behavior by moving product-category mapping back.
  await knex.raw(`
    INSERT IGNORE INTO accessory_categories (accessory_id, category_id)
    SELECT accessory_id, category_id
    FROM accessory_product_categories
  `);

  await knex.schema.dropTableIfExists('accessory_product_categories');
  await knex.schema.alterTable('categories', (t) => {
    t.dropColumn('category_type');
  });
}
