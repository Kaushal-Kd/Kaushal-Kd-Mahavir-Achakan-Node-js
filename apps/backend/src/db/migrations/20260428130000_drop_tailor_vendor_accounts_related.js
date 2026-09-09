/**
 * Remove tailor/vendor/user-account related tables and dependencies.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasExpenses = await knex.schema.hasTable('expenses');
  if (hasExpenses) {
    await knex.schema.dropTableIfExists('expenses');
  }

  const hasPaymentsReceivedIn = await knex.schema.hasColumn('payments', 'received_in');
  if (hasPaymentsReceivedIn) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropForeign(['received_in']);
    });
    await knex.schema.alterTable('payments', (t) => {
      t.dropColumn('received_in');
    });
  }

  await knex.schema.dropTableIfExists('repair_jobs');
  await knex.schema.dropTableIfExists('tailor_jobs');

  const hasProductsVendorId = await knex.schema.hasColumn('products', 'vendor_id');
  if (hasProductsVendorId) {
    await knex.schema.alterTable('products', (t) => {
      t.dropForeign(['vendor_id']);
    });
  }

  await knex.schema.dropTableIfExists('vendors');
  await knex.schema.dropTableIfExists('user_accounts');
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasUserAccounts = await knex.schema.hasTable('user_accounts');
  if (!hasUserAccounts) {
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
  }

  const hasVendors = await knex.schema.hasTable('vendors');
  if (!hasVendors) {
    await knex.schema.createTable('vendors', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.string('name', 200).notNullable();
      t.enu('vendor_type', ['supplier', 'tailor', 'laundry', 'repair', 'planner']).notNullable();
      t.string('phone', 30).nullable();
      t.string('email', 200).nullable();
      t.text('address').nullable();
      t.string('gstin', 20).nullable();
      t.text('notes').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    });
  }

  const hasProductsVendorId = await knex.schema.hasColumn('products', 'vendor_id');
  if (hasProductsVendorId) {
    await knex.schema.alterTable('products', (t) => {
      t.foreign('vendor_id').references('vendors.id').onDelete('SET NULL');
    });
  }

  const hasTailorJobs = await knex.schema.hasTable('tailor_jobs');
  if (!hasTailorJobs) {
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
  }

  const hasRepairJobs = await knex.schema.hasTable('repair_jobs');
  if (!hasRepairJobs) {
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
  }

  const hasPaymentsReceivedIn = await knex.schema.hasColumn('payments', 'received_in');
  if (!hasPaymentsReceivedIn) {
    await knex.schema.alterTable('payments', (t) => {
      t.uuid('received_in').nullable().index();
    });
    await knex.schema.alterTable('payments', (t) => {
      t.foreign('received_in').references('user_accounts.id').onDelete('SET NULL');
    });
  }

  const hasExpenses = await knex.schema.hasTable('expenses');
  if (!hasExpenses) {
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
  }
}
