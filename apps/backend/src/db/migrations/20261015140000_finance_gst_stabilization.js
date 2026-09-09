/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('payment_accounts', 'account_type'))) {
    await knex.schema.alterTable('payment_accounts', (t) => {
      t.string('account_type', 20).notNullable().defaultTo('other').index();
    });
    await knex('payment_accounts')
      .where((qb) => {
        qb.whereRaw("LOWER(name) LIKE '%cash%'")
          .orWhereRaw("LOWER(account_group) LIKE '%cash%'")
          .orWhereRaw("LOWER(name) LIKE '%counter%'");
      })
      .update({ account_type: 'cash' });
    await knex('payment_accounts')
      .where((qb) => {
        qb.whereRaw("LOWER(name) LIKE '%upi%'")
          .orWhereRaw("LOWER(name) LIKE '%online%'")
          .orWhereRaw("LOWER(account_group) LIKE '%upi%'");
      })
      .andWhere('account_type', 'other')
      .update({ account_type: 'upi' });
    await knex('payment_accounts')
      .where((qb) => {
        qb.whereRaw("LOWER(name) LIKE '%bank%'")
          .orWhereRaw("LOWER(account_group) LIKE '%bank%'");
      })
      .andWhere('account_type', 'other')
      .update({ account_type: 'bank' });
  }

  if (!(await knex.schema.hasTable('cash_counter_reconciliations'))) {
    await knex.schema.createTable('cash_counter_reconciliations', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.string('payment_account_id', 80).notNullable();
      t.date('business_date').notNullable();
      t.integer('version').unsigned().notNullable().defaultTo(1);
      t.decimal('opening_cash', 14, 2).notNullable().defaultTo(0);
      t.decimal('income_total', 14, 2).notNullable().defaultTo(0);
      t.decimal('expense_total', 14, 2).notNullable().defaultTo(0);
      t.decimal('expected_closing', 14, 2).notNullable().defaultTo(0);
      t.decimal('counted_closing', 14, 2).notNullable().defaultTo(0);
      t.decimal('variance', 14, 2).notNullable().defaultTo(0);
      t.string('movement_fingerprint', 64).notNullable();
      t.string('idempotency_key', 80).notNullable();
      t.string('status', 20).notNullable().defaultTo('closed');
      t.text('notes').nullable();
      t.text('revision_reason').nullable();
      t.uuid('supersedes_id').nullable().index();
      t.uuid('closed_by_user_id').nullable().index();
      t.timestamp('closed_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['shop_id', 'payment_account_id', 'business_date', 'version'], 'uq_cash_close_version');
      t.unique(['shop_id', 'idempotency_key'], 'uq_cash_close_idempotency');
      t.index(['shop_id', 'payment_account_id', 'business_date'], 'idx_cash_close_lookup');
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.foreign('supersedes_id').references('cash_counter_reconciliations.id').onDelete('SET NULL');
      t.foreign('closed_by_user_id').references('users.id').onDelete('SET NULL');
    });
  }

  if (!(await knex.schema.hasColumn('orders', 'bill_type'))) {
    await knex.schema.alterTable('orders', (t) => {
      t.string('bill_type', 12).notNullable().defaultTo('kaccha').index();
    });
    await knex('orders').where({ gst_enabled: true }).update({ bill_type: 'gst' });
  }
  if (!(await knex.schema.hasColumn('sales', 'bill_type'))) {
    await knex.schema.alterTable('sales', (t) => {
      t.string('bill_type', 12).notNullable().defaultTo('kaccha').index();
    });
    await knex('sales').where('tax_total', '>', 0).update({ bill_type: 'gst' });
  }

  if (!(await knex.schema.hasTable('gst_bill_conversions'))) {
    await knex.schema.createTable('gst_bill_conversions', (t) => {
      t.uuid('id').primary();
      t.uuid('shop_id').notNullable().index();
      t.string('source_type', 20).notNullable();
      t.uuid('source_id').notNullable().index();
      t.string('idempotency_key', 80).notNullable();
      t.string('from_bill_type', 12).notNullable();
      t.string('to_bill_type', 12).notNullable();
      t.text('reason').notNullable();
      t.json('before_snapshot').notNullable();
      t.json('after_snapshot').notNullable();
      t.uuid('converted_by_user_id').nullable().index();
      t.timestamp('converted_at').notNullable().defaultTo(knex.fn.now());
      t.unique(['shop_id', 'source_type', 'source_id'], 'uq_gst_conversion_source');
      t.unique(['shop_id', 'idempotency_key'], 'uq_gst_conversion_idempotency');
      t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
      t.foreign('converted_by_user_id').references('users.id').onDelete('SET NULL');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('gst_bill_conversions');
  if (await knex.schema.hasColumn('sales', 'bill_type')) {
    await knex.schema.alterTable('sales', (t) => t.dropColumn('bill_type'));
  }
  if (await knex.schema.hasColumn('orders', 'bill_type')) {
    await knex.schema.alterTable('orders', (t) => t.dropColumn('bill_type'));
  }
  await knex.schema.dropTableIfExists('cash_counter_reconciliations');
  if (await knex.schema.hasColumn('payment_accounts', 'account_type')) {
    await knex.schema.alterTable('payment_accounts', (t) => t.dropColumn('account_type'));
  }
}
