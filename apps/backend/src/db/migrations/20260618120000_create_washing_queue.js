export async function up(knex) {
  await knex.schema.createTable('washing_queue', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('product_id').notNullable();
    t.uuid('order_id').nullable();
    t.uuid('order_item_id').nullable();
    t.string('product_code', 80).nullable();
    t.string('product_name', 200).nullable();
    t.string('image_url', 500).nullable();
    t.uuid('category_id').nullable();
    t.integer('qty').notNullable().defaultTo(1);
    t.timestamp('queued_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('product_id').references('products.id').onDelete('CASCADE');
    t.index(['shop_id', 'product_id']);
    t.index(['shop_id', 'order_item_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('washing_queue');
}
