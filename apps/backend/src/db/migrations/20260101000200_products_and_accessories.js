/**
 * Products + accessories + history + linking (requirements §11, §12, §54, §55).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('vendors', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('name', 200).notNullable();
    t.enu('vendor_type', ['supplier', 'tailor', 'laundry', 'repair', 'planner']).notNullable();
    t.string('phone', 30).nullable();
    t.string('email', 200).nullable();
    t.text('address').nullable();
    t.string('gstin', 20).nullable();
    t.text('notes').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('products', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('category_id').nullable().index();
    t.uuid('vendor_id').nullable().index();

    t.string('name', 200).notNullable();
    t.string('code', 80).notNullable();
    t.string('barcode', 100).nullable().index();
    t.string('qr_code', 200).nullable();

    t.enu('type', ['rent', 'sell', 'both']).notNullable().defaultTo('rent');
    t.string('color', 60).nullable();
    t.string('color_family', 60).nullable();
    t.string('size', 40).nullable();
    t.text('design_details').nullable();

    t.decimal('default_length', 6, 2).nullable();
    t.decimal('default_sleeves', 6, 2).nullable();

    t.decimal('price_rent', 12, 2).notNullable().defaultTo(0);
    t.decimal('price_sell', 12, 2).notNullable().defaultTo(0);
    t.decimal('purchase_price', 12, 2).notNullable().defaultTo(0);
    t.decimal('security_deposit', 12, 2).notNullable().defaultTo(0);
    t.decimal('discount_percent', 5, 2).notNullable().defaultTo(0);

    t.integer('qty').notNullable().defaultTo(1);
    t.integer('gap_days').notNullable().defaultTo(0);
    t.integer('lifetime_gap').notNullable().defaultTo(0);
    t.integer('count').notNullable().defaultTo(0);

    t.enu('status', [
      'available',
      'booked',
      'delivered',
      'returned',
      'washing',
      'repair',
      'sold',
      'lost',
    ])
      .notNullable()
      .defaultTo('available');

    t.json('photos').nullable();
    t.string('main_image', 500).nullable();
    t.text('notes').nullable();

    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['shop_id', 'code']);
    t.index(['shop_id', 'category_id']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('category_id').references('categories.id').onDelete('SET NULL');
    t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('product_history', (t) => {
    t.uuid('id').primary();
    t.uuid('product_id').notNullable().index();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').nullable();
    t.uuid('order_id').nullable().index();
    t.string('action', 40).notNullable();
    t.text('note').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('product_id').references('products.id').onDelete('CASCADE');
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('accessories', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();

    t.string('code', 80).notNullable();
    t.string('name', 200).notNullable();
    t.string('image_url', 500).nullable();

    t.integer('qty').notNullable().defaultTo(0);
    t.integer('threshold').notNullable().defaultTo(0);
    t.string('unit', 20).notNullable().defaultTo('pcs');

    t.decimal('price_rent', 12, 2).notNullable().defaultTo(0);
    t.decimal('price_sell', 12, 2).notNullable().defaultTo(0);
    t.decimal('purchase_price', 12, 2).notNullable().defaultTo(0);

    t.enu('default_type', ['rent', 'sell']).notNullable().defaultTo('sell');
    t.enu('default_order_status', ['given_with_rent', 'pack_with_rent', 'regular'])
      .notNullable()
      .defaultTo('regular');

    t.text('notes').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.unique(['shop_id', 'code']);
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('accessory_categories', (t) => {
    t.uuid('accessory_id').notNullable();
    t.uuid('category_id').notNullable();
    t.primary(['accessory_id', 'category_id']);
    t.foreign('accessory_id').references('accessories.id').onDelete('CASCADE');
    t.foreign('category_id').references('categories.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('product_accessories', (t) => {
    t.uuid('id').primary();
    t.uuid('product_id').notNullable().index();
    t.uuid('accessory_id').notNullable().index();
    t.boolean('is_recommended').notNullable().defaultTo(true);
    t.boolean('is_required').notNullable().defaultTo(false);
    t.integer('display_order').notNullable().defaultTo(0);
    t.text('notes').nullable();
    t.unique(['product_id', 'accessory_id']);
    t.foreign('product_id').references('products.id').onDelete('CASCADE');
    t.foreign('accessory_id').references('accessories.id').onDelete('CASCADE');
  });

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

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('package_items');
  await knex.schema.dropTableIfExists('packages');
  await knex.schema.dropTableIfExists('product_accessories');
  await knex.schema.dropTableIfExists('accessory_categories');
  await knex.schema.dropTableIfExists('accessories');
  await knex.schema.dropTableIfExists('product_history');
  await knex.schema.dropTableIfExists('products');
  await knex.schema.dropTableIfExists('vendors');
}
