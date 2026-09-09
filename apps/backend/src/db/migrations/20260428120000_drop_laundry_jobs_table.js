/**
 * Remove laundry module table.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.dropTableIfExists('laundry_jobs');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('laundry_jobs');
  if (hasTable) return;

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
}
