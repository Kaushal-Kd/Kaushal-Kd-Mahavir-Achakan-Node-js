/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('receipt_vouchers', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('voucher_number', 40).notNullable();
    t.string('debit_account_id', 80).notNullable();
    t.string('credit_account_id', 80).notNullable();
    t.date('entry_date').notNullable().index();
    t.decimal('amount', 12, 2).notNullable();
    t.text('remarks').nullable();
    t.uuid('created_by').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('created_by').references('users.id').onDelete('SET NULL');
    t.unique(['shop_id', 'voucher_number']);
    t.index(['shop_id', 'entry_date']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('receipt_vouchers');
}
