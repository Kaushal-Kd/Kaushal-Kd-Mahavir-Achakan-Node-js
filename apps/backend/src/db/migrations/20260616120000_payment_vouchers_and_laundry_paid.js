/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('payment_vouchers', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('voucher_number', 40).notNullable();
    t.string('credit_account_id', 80).notNullable();
    t.string('debit_account_id', 80).notNullable();
    t.date('entry_date').notNullable().index();
    t.decimal('amount', 12, 2).notNullable();
    t.text('remarks').nullable();
    t.string('bill_kind', 20).notNullable().defaultTo('none');
    t.uuid('bill_id').nullable().index();
    t.uuid('created_by').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('created_by').references('users.id').onDelete('SET NULL');
    t.unique(['shop_id', 'voucher_number']);
    t.index(['shop_id', 'entry_date']);
  });

  const hasCol = await knex.schema.hasColumn('laundry_jobs', 'paid_to_washing_amount');
  if (!hasCol) {
    await knex.schema.alterTable('laundry_jobs', (t) => {
      t.decimal('paid_to_washing_amount', 12, 2).notNullable().defaultTo(0);
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('payment_vouchers');
  const hasCol = await knex.schema.hasColumn('laundry_jobs', 'paid_to_washing_amount');
  if (hasCol) {
    await knex.schema.alterTable('laundry_jobs', (t) => {
      t.dropColumn('paid_to_washing_amount');
    });
  }
}
