/**
 * Product-to-product related mapping for booking auto-add.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const exists = await knex.schema.hasTable('product_related_products');
  if (exists) return;

  await knex.schema.createTable('product_related_products', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('product_id').notNullable().index();
    t.uuid('related_product_id').notNullable().index();
    t.boolean('is_recommended').notNullable().defaultTo(true);
    t.boolean('is_required').notNullable().defaultTo(false);
    t.integer('display_order').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['product_id', 'related_product_id']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('product_id').references('products.id').onDelete('CASCADE');
    t.foreign('related_product_id').references('products.id').onDelete('CASCADE');
  });

  await knex.raw(`
    ALTER TABLE product_related_products
    ADD CONSTRAINT chk_product_related_not_self
    CHECK (product_id <> related_product_id)
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('product_related_products');
}
