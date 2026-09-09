/**
 * Purchase module — vendor bills (mirror sales structure).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('purchases', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('purchase_number', 30).notNullable();
    t.integer('bill_no').unsigned().notNullable();
    t.date('purchase_date').notNullable();
    t.string('vendor_account_id', 80).notNullable();
    t.string('purchase_account_id', 80).notNullable();
    t.integer('terms_days').notNullable().defaultTo(0);

    t.text('remark').nullable();

    t.string('discount_type', 10).notNullable().defaultTo('flat');
    t.decimal('discount_value', 14, 2).notNullable().defaultTo(0);
    t.decimal('discount_amount', 14, 2).notNullable().defaultTo(0);

    t.decimal('subtotal', 14, 2).notNullable().defaultTo(0);
    t.decimal('cgst_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('sgst_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('igst_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('tax_total', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);

    t.decimal('advance', 14, 2).notNullable().defaultTo(0);
    t.string('advance_account_id', 80).nullable();

    t.string('status', 30).notNullable().defaultTo('active');
    t.uuid('created_by').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());

    t.unique(['shop_id', 'bill_no']);
    t.index(['shop_id', 'purchase_date']);
  });

  await knex.schema.createTable('purchase_items', (t) => {
    t.uuid('id').primary();
    t.uuid('purchase_id').notNullable().index();
    t.uuid('shop_id').notNullable();
    t.string('item_type', 20).notNullable().defaultTo('item');
    t.uuid('product_id').nullable();
    t.uuid('accessory_id').nullable();
    t.string('name_snapshot', 255).notNullable();
    t.integer('qty').unsigned().notNullable().defaultTo(1);
    t.decimal('price', 14, 2).notNullable().defaultTo(0);
    t.decimal('discount', 14, 2).notNullable().defaultTo(0);
    t.decimal('taxable_price', 14, 2).notNullable().defaultTo(0);
    t.decimal('cgst_percent', 6, 2).notNullable().defaultTo(0);
    t.decimal('cgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('sgst_percent', 6, 2).notNullable().defaultTo(0);
    t.decimal('sgst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('igst_percent', 6, 2).notNullable().defaultTo(0);
    t.decimal('igst_amount', 14, 2).notNullable().defaultTo(0);
    t.decimal('net_price', 14, 2).notNullable().defaultTo(0);
    t.decimal('total_amount', 14, 2).notNullable().defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());

    t.foreign('purchase_id').references('purchases.id').onDelete('CASCADE');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('purchase_items');
  await knex.schema.dropTableIfExists('purchases');
}
