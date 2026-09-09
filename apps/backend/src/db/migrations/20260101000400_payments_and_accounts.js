/**
 * Payments, user accounts, expenses, purchases (requirements §23-§26, §60, §61).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('user_accounts', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('user_id').notNullable().index();
    t.enu('account_type', ['bank', 'upi', 'wallet', 'cash']).notNullable();
    t.string('account_name', 200).notNullable();
    t.string('account_number', 60).nullable();
    t.string('ifsc_code', 20).nullable();
    t.string('bank_name', 120).nullable();
    t.string('branch_name', 120).nullable();
    t.string('account_holder_name', 200).nullable();
    t.string('upi_id', 120).nullable();
    t.string('upi_number', 30).nullable();
    t.string('qr_code_image', 500).nullable();
    t.boolean('is_primary').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.text('notes').nullable();
    t.json('metadata').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('user_id').references('users.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('payments', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('order_id').nullable().index();
    t.uuid('customer_id').nullable().index();
    t.uuid('received_by').nullable().index();
    t.uuid('received_in').nullable().index();

    t.enu('payment_type', ['cash', 'card', 'upi', 'transfer', 'wallet', 'cheque', 'other'])
      .notNullable();
    t.enu('category', ['advance', 'partial', 'final', 'refund', 'deposit', 'deposit_refund'])
      .notNullable()
      .defaultTo('partial');
    t.decimal('amount', 12, 2).notNullable();
    t.date('payment_date').notNullable();
    t.string('transaction_id', 100).nullable();
    t.text('notes').nullable();

    t.boolean('is_deleted').notNullable().defaultTo(false);
    t.timestamp('deleted_at').nullable();

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('order_id').references('orders.id').onDelete('SET NULL');
    t.foreign('customer_id').references('customers.id').onDelete('SET NULL');
    t.foreign('received_by').references('users.id').onDelete('SET NULL');
    t.foreign('received_in').references('user_accounts.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('expenses', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('created_by').nullable().index();
    t.uuid('paid_from').nullable().index();
    t.uuid('vendor_id').nullable().index();
    t.enu('category', ['laundry', 'repair', 'salary', 'rent', 'travel', 'utility', 'misc'])
      .notNullable()
      .defaultTo('misc');
    t.string('title', 200).notNullable();
    t.decimal('amount', 12, 2).notNullable();
    t.date('expense_date').notNullable();
    t.enu('payment_type', ['cash', 'card', 'upi', 'transfer', 'wallet', 'cheque', 'other'])
      .notNullable()
      .defaultTo('cash');
    t.string('receipt_url', 500).nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('created_by').references('users.id').onDelete('SET NULL');
    t.foreign('paid_from').references('user_accounts.id').onDelete('SET NULL');
    t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('purchases', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.uuid('vendor_id').nullable().index();
    t.string('bill_number', 80).nullable();
    t.date('purchase_date').notNullable();
    t.decimal('total_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('paid_amount', 12, 2).notNullable().defaultTo(0);
    t.decimal('balance', 12, 2).notNullable().defaultTo(0);
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
  });

  await knex.schema.createTable('purchase_items', (t) => {
    t.uuid('id').primary();
    t.uuid('purchase_id').notNullable().index();
    t.uuid('product_id').nullable();
    t.uuid('accessory_id').nullable();
    t.string('name', 200).notNullable();
    t.integer('qty').notNullable().defaultTo(1);
    t.decimal('unit_price', 12, 2).notNullable().defaultTo(0);
    t.decimal('total_price', 12, 2).notNullable().defaultTo(0);
    t.foreign('purchase_id').references('purchases.id').onDelete('CASCADE');
    t.foreign('product_id').references('products.id').onDelete('SET NULL');
    t.foreign('accessory_id').references('accessories.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('purchase_items');
  await knex.schema.dropTableIfExists('purchases');
  await knex.schema.dropTableIfExists('expenses');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('user_accounts');
}
