/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('security_charges', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('order_id').notNullable().index();
    t.uuid('customer_id').nullable().index();
    t.decimal('amount', 12, 2).notNullable().defaultTo(0);
    t.text('remarks').nullable();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.string('source', 30).notNullable().defaultTo('return_modal');
    t.string('item_type', 20).nullable();
    t.uuid('item_id').nullable();
    t.string('payment_account_id', 80).nullable();
    t.uuid('income_entry_id').nullable().index();
    t.timestamp('settled_at').nullable();
    t.uuid('created_by').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('order_id').references('orders.id').onDelete('CASCADE');
    t.foreign('customer_id').references('customers.id').onDelete('SET NULL');
    t.index(['shop_id', 'status', 'created_at']);
    t.index(['shop_id', 'order_id', 'status']);
    t.index(['shop_id', 'item_type', 'item_id', 'status']);
  });

  await knex.raw(`
    INSERT INTO security_charges (
      id, shop_id, order_id, customer_id, amount, remarks, status, source,
      item_type, item_id, created_at, updated_at
    )
    SELECT
      UUID(), oi.shop_id, oi.order_id, o.customer_id, oi.damage_charge,
      CONCAT('Backfill · item ', oi.id), 'pending', 'checklist',
      'item', oi.id, NOW(), NOW()
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id AND o.shop_id = oi.shop_id
    WHERE oi.damage_charge > 0
      AND NOT EXISTS (
        SELECT 1 FROM security_charges sc
        WHERE sc.shop_id = oi.shop_id AND sc.order_id = oi.order_id
          AND sc.item_type = 'item' AND sc.item_id = oi.id AND sc.status = 'pending'
      )
  `);

  await knex.raw(`
    INSERT INTO security_charges (
      id, shop_id, order_id, customer_id, amount, remarks, status, source,
      item_type, item_id, created_at, updated_at
    )
    SELECT
      UUID(), oa.shop_id, oa.order_id, o.customer_id, oa.damage_charge,
      CONCAT('Backfill · accessory ', oa.id), 'pending', 'checklist',
      'accessory', oa.id, NOW(), NOW()
    FROM order_accessories oa
    INNER JOIN orders o ON o.id = oa.order_id AND o.shop_id = oa.shop_id
    WHERE oa.damage_charge > 0
      AND NOT EXISTS (
        SELECT 1 FROM security_charges sc
        WHERE sc.shop_id = oa.shop_id AND sc.order_id = oa.order_id
          AND sc.item_type = 'accessory' AND sc.item_id = oa.id AND sc.status = 'pending'
      )
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('security_charges');
}
