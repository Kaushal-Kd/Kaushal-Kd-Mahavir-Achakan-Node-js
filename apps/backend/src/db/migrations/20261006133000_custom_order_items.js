import { v4 as uuid } from 'uuid';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const exists = await knex.schema.hasTable('custom_order_items');
  if (!exists) {
    await knex.schema.createTable('custom_order_items', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.uuid('custom_order_id').notNullable().index();
      t.string('design_name', 200).nullable();
      t.uuid('category_id').nullable().index();
      t.string('product_name', 200).nullable();
      t.string('color', 60).nullable();
      t.string('size', 40).nullable();
      t.uuid('linked_product_id').nullable().index();
      t.string('generated_product_code', 80).nullable();
      t.integer('display_order').notNullable().defaultTo(0);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.foreign('custom_order_id').references('custom_orders.id').onDelete('CASCADE');
    });
  }

  const hasParent = await knex.schema.hasTable('custom_orders');
  if (!hasParent) return;

  const existing = await knex('custom_orders').select(
    'id',
    'shop_id',
    'design_name',
    'category_id',
    'product_name',
    'color',
    'size',
    'linked_product_id',
    'generated_product_code'
  );
  const already = await knex('custom_order_items').select('custom_order_id');
  const seen = new Set(already.map((r) => String(r.custom_order_id)));
  const rows = [];
  for (const order of existing) {
    if (seen.has(String(order.id))) continue;
    const hasAny =
      order.design_name ||
      order.category_id ||
      order.product_name ||
      order.color ||
      order.size ||
      order.linked_product_id;
    if (!hasAny) continue;
    rows.push({
      id: uuid(),
      shop_id: order.shop_id,
      custom_order_id: order.id,
      design_name: order.design_name || null,
      category_id: order.category_id || null,
      product_name: order.product_name || null,
      color: order.color || null,
      size: order.size || null,
      linked_product_id: order.linked_product_id || null,
      generated_product_code: order.generated_product_code || null,
      display_order: 0,
    });
  }
  if (rows.length) await knex('custom_order_items').insert(rows);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('custom_order_items');
}
