/**
 * Remove legacy package builder tables.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.dropTableIfExists('package_items');
  await knex.schema.dropTableIfExists('packages');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasPackages = await knex.schema.hasTable('packages');
  if (!hasPackages) {
    await knex.schema.createTable('packages', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.string('name', 200).notNullable();
      t.text('description').nullable();
      t.string('image_url', 500).nullable();
      t.decimal('bundle_price', 12, 2).notNullable().defaultTo(0);
      t.boolean('is_customizable').notNullable().defaultTo(true);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    });
  }

  const hasPackageItems = await knex.schema.hasTable('package_items');
  if (!hasPackageItems) {
    await knex.schema.createTable('package_items', (t) => {
      t.uuid('id').primary();
      t.uuid('package_id').notNullable().index();
      t.enu('item_type', ['product', 'accessory']).notNullable();
      t.uuid('product_id').nullable();
      t.uuid('accessory_id').nullable();
      t.integer('qty').notNullable().defaultTo(1);
      t.foreign('package_id').references('packages.id').onDelete('CASCADE');
      t.foreign('product_id').references('products.id').onDelete('SET NULL');
      t.foreign('accessory_id').references('accessories.id').onDelete('SET NULL');
    });
  }
}
