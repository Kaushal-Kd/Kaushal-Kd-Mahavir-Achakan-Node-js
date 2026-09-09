/**
 * Tailor / Laundry / Repair / Notifications / Reports log / Sync queue / Drafts / Bill templates.
 * (Requirements §20, §21, §22, §35, §57, §66, §79, §73.)
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('tailor_jobs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('order_id').nullable().index();
    t.uuid('order_item_id').nullable().index();
    t.uuid('tailor_id').nullable().index();
    t.uuid('vendor_id').nullable().index();
    t.string('title', 200).notNullable();
    t.text('instructions').nullable();
    t.enu('status', ['pending', 'in_progress', 'ready', 'fit_check', 'completed', 'rejected'])
      .notNullable()
      .defaultTo('pending');
    t.enu('urgency', ['normal', 'same_day', 'next_day', 'rush']).notNullable().defaultTo('normal');
    t.date('due_date').nullable();
    t.decimal('charge', 12, 2).notNullable().defaultTo(0);
    t.timestamp('completed_at').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('order_id').references('orders.id').onDelete('SET NULL');
    t.foreign('order_item_id').references('order_items.id').onDelete('SET NULL');
    t.foreign('tailor_id').references('users.id').onDelete('SET NULL');
    t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('laundry_jobs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('vendor_id').nullable().index();
    t.uuid('order_id').nullable().index();
    t.uuid('order_item_id').nullable().index();
    t.uuid('product_id').nullable().index();
    t.enu('status', ['pending', 'sent', 'received', 'quality_ok', 'rejected'])
      .notNullable()
      .defaultTo('pending');
    t.date('sent_date').nullable();
    t.date('received_date').nullable();
    t.decimal('cost', 12, 2).notNullable().defaultTo(0);
    t.boolean('express').notNullable().defaultTo(false);
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
    t.foreign('order_id').references('orders.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('repair_jobs', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('vendor_id').nullable().index();
    t.uuid('product_id').nullable().index();
    t.uuid('order_id').nullable().index();
    t.text('issue').notNullable();
    t.enu('status', ['pending', 'in_progress', 'completed', 'cancelled'])
      .notNullable()
      .defaultTo('pending');
    t.decimal('cost', 12, 2).notNullable().defaultTo(0);
    t.date('completed_date').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('notifications', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').nullable().index();
    t.string('type', 60).notNullable();
    t.string('title', 200).notNullable();
    t.text('body').nullable();
    t.json('payload').nullable();
    t.string('link', 500).nullable();
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('read_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('reports_log', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('generated_by').nullable().index();
    t.string('report_type', 80).notNullable();
    t.json('params').nullable();
    t.string('file_url', 500).nullable();
    t.timestamp('generated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('sync_queue', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').nullable().index();
    t.uuid('user_id').nullable().index();
    t.string('entity', 60).notNullable();
    t.string('entity_id', 60).notNullable();
    t.enu('op', ['insert', 'update', 'delete']).notNullable();
    t.json('payload').nullable();
    t.enu('status', ['pending', 'processing', 'synced', 'failed'])
      .notNullable()
      .defaultTo('pending');
    t.text('error').nullable();
    t.integer('retry_count').notNullable().defaultTo(0);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('synced_at').nullable();
    t.index(['status', 'created_at']);
  });

  await knex.schema.createTable('drafts', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').notNullable().index();
    t.string('kind', 40).notNullable().defaultTo('order');
    t.json('data').nullable();
    t.string('title', 200).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('bill_templates', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('name', 120).notNullable();
    t.boolean('is_default').notNullable().defaultTo(false);
    t.enu('paper_size', ['A4', 'A5', 'thermal_58', 'thermal_80']).notNullable().defaultTo('A4');
    t.json('header_config').nullable();
    t.json('bill_info_config').nullable();
    t.json('items_config').nullable();
    t.json('footer_config').nullable();
    t.json('typography').nullable();
    t.json('page_settings').nullable();
    t.json('colors').nullable();
    t.json('custom_elements').nullable();
    t.json('custom_content').nullable();
    t.string('logo_url', 500).nullable();
    t.integer('logo_width').notNullable().defaultTo(120);
    t.integer('logo_height').notNullable().defaultTo(60);
    t.string('logo_position', 20).notNullable().defaultTo('left');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('inventory_transfers', (t) => {
    t.uuid('id').primary();
    t.uuid('from_shop_id').notNullable().index();
    t.uuid('to_shop_id').notNullable().index();
    t.uuid('product_id').nullable();
    t.uuid('accessory_id').nullable();
    t.integer('qty').notNullable().defaultTo(1);
    t.enu('status', ['pending', 'in_transit', 'received', 'cancelled'])
      .notNullable()
      .defaultTo('pending');
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('from_shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('to_shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('product_id').references('products.id').onDelete('SET NULL');
    t.foreign('accessory_id').references('accessories.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('inventory_transfers');
  await knex.schema.dropTableIfExists('bill_templates');
  await knex.schema.dropTableIfExists('drafts');
  await knex.schema.dropTableIfExists('sync_queue');
  await knex.schema.dropTableIfExists('reports_log');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('repair_jobs');
  await knex.schema.dropTableIfExists('laundry_jobs');
  await knex.schema.dropTableIfExists('tailor_jobs');
}
