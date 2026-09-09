/**
 * Remove purchases module tables.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.dropTableIfExists('purchase_items');
  await knex.schema.dropTableIfExists('purchases');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasPurchases = await knex.schema.hasTable('purchases');
  if (!hasPurchases) {
    await knex.schema.createTable('purchases', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.uuid('vendor_id').nullable().index();
      t.string('bill_number', 80).nullable();
      t.date('purchase_date').notNullable();
      t.decimal('total_amount', 12, 2).notNullable().defaultTo(0);
      t.decimal('paid_amount', 12, 2).notNullable().defaultTo(0);
      t.decimal('balance', 12, 2).notNullable().defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
    });
  }

  const hasPurchaseItems = await knex.schema.hasTable('purchase_items');
  if (!hasPurchaseItems) {
    await knex.schema.createTable('purchase_items', (t) => {
      t.uuid('id').primary();
      t.uuid('purchase_id').notNullable().index();
      t.uuid('product_id').nullable();
      t.uuid('accessory_id').nullable();
      t.string('name', 200).notNullable();
      t.integer('qty').notNullable().defaultTo(1);
      t.decimal('unit_price', 12, 2).notNullable().defaultTo(0);
      t.decimal('total_price', 12, 2).notNullable().defaultTo(0);
      t.foreign('purchase_id').references('purchases.id').onDelete('CASCADE');
      t.foreign('product_id').references('products.id').onDelete('SET NULL');
      t.foreign('accessory_id').references('accessories.id').onDelete('SET NULL');
    });
  }
}
