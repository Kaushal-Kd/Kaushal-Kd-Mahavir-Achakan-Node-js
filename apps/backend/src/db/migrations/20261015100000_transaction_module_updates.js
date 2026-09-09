export async function up(knex) {
  await knex.schema.alterTable('purchases', (t) => {
    t.json('image_urls').nullable();
  });

  await knex.schema.alterTable('income_entries', (t) => {
    t.integer('bill_no').unsigned().nullable();
    t.string('income_number', 40).nullable();
    t.index(['shop_id', 'bill_no']);
  });

  await knex.schema.alterTable('expense_entries', (t) => {
    t.integer('bill_no').unsigned().nullable();
    t.string('expense_number', 40).nullable();
    t.string('contact_no', 10).nullable();
    t.json('image_urls').nullable();
    t.index(['shop_id', 'bill_no']);
  });

  await knex.schema.alterTable('washing_queue', (t) => {
    t.string('item_kind', 20).notNullable().defaultTo('product');
    t.uuid('accessory_id').nullable();
    t.uuid('order_accessory_id').nullable();
    t.uuid('product_id').nullable().alter();
    t.index(['shop_id', 'order_accessory_id']);
    t.foreign('accessory_id').references('accessories.id').onDelete('CASCADE');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('washing_queue', (t) => {
    t.dropForeign('accessory_id');
    t.dropIndex(['shop_id', 'order_accessory_id']);
    t.dropColumn('order_accessory_id');
    t.dropColumn('accessory_id');
    t.dropColumn('item_kind');
    t.uuid('product_id').notNullable().alter();
  });

  await knex.schema.alterTable('expense_entries', (t) => {
    t.dropIndex(['shop_id', 'bill_no']);
    t.dropColumn('image_urls');
    t.dropColumn('contact_no');
    t.dropColumn('expense_number');
    t.dropColumn('bill_no');
  });

  await knex.schema.alterTable('income_entries', (t) => {
    t.dropIndex(['shop_id', 'bill_no']);
    t.dropColumn('income_number');
    t.dropColumn('bill_no');
  });

  await knex.schema.alterTable('purchases', (t) => {
    t.dropColumn('image_urls');
  });
}
