/**
 * Sales module — standalone sell transactions (not rental bookings).
 * sale_number uses a separate prefix (default "S") and its own sequence.
 */
export function up(knex) {
  return knex.schema
    .createTable('sales', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.uuid('customer_id').nullable().index();
      t.string('sale_number', 30).notNullable();
      t.integer('bill_no').unsigned().notNullable();
      t.date('sale_date').notNullable();
      t.string('customer_name', 200).notNullable();
      t.string('contact_no', 20).nullable();
      t.text('address').nullable();
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
      t.uuid('advance_account_id').nullable();

      t.string('status', 30).notNullable().defaultTo('active');
      t.uuid('created_by').nullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());

      t.unique(['shop_id', 'bill_no']);
      t.index(['shop_id', 'sale_date']);
    })
    .createTable('sale_items', (t) => {
      t.uuid('id').primary();
      t.uuid('sale_id').notNullable().index();
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

      t.foreign('sale_id').references('sales.id').onDelete('CASCADE');
    });
}

export function down(knex) {
  return knex.schema.dropTableIfExists('sale_items').dropTableIfExists('sales');
}
