/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('custom_orders', (t) => {
    t.uuid('customer_id').nullable().index();
    t.string('customer_phone2', 20).nullable();
    t.string('customer_phone2_name', 120).nullable();
    t.string('customer_whatsapp', 20).nullable();
    t.string('customer_whatsapp_source', 16).nullable();
    t.uuid('category_id').nullable().index();
    t.string('product_name', 200).nullable();
    t.string('color', 60).nullable();
    t.string('size', 40).nullable();
    t.string('tailor_name', 120).nullable();
    t.uuid('linked_product_id').nullable().index();
    t.string('generated_product_code', 80).nullable();
  });

  await knex.schema.alterTable('custom_orders', (t) => {
    t.foreign('customer_id').references('customers.id').onDelete('SET NULL');
    t.foreign('category_id').references('categories.id').onDelete('SET NULL');
    t.foreign('linked_product_id').references('products.id').onDelete('SET NULL');
    t.foreign('linked_order_id').references('orders.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('custom_orders', (t) => {
    t.dropForeign(['customer_id']);
    t.dropForeign(['category_id']);
    t.dropForeign(['linked_product_id']);
    t.dropForeign(['linked_order_id']);
  });

  await knex.schema.alterTable('custom_orders', (t) => {
    t.dropColumn('customer_id');
    t.dropColumn('customer_phone2');
    t.dropColumn('customer_phone2_name');
    t.dropColumn('customer_whatsapp');
    t.dropColumn('customer_whatsapp_source');
    t.dropColumn('category_id');
    t.dropColumn('product_name');
    t.dropColumn('color');
    t.dropColumn('size');
    t.dropColumn('tailor_name');
    t.dropColumn('linked_product_id');
    t.dropColumn('generated_product_code');
  });
}
