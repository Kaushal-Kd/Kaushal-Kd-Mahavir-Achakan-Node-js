/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('expense_entries', (t) => {
    t.uuid('id').primary();
    t.uuid('shop_id').notNullable().index();
    t.string('expense_account_id', 80).notNullable();
    t.string('payment_account_id', 80).notNullable();
    t.string('name', 200).notNullable();
    t.date('entry_date').notNullable().index();
    t.decimal('amount', 12, 2).notNullable();
    t.text('details').notNullable();
    t.uuid('created_by').nullable().index();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    t.foreign('shop_id').references('shops.id').onDelete('CASCADE');
    t.foreign('created_by').references('users.id').onDelete('SET NULL');
    t.index(['shop_id', 'entry_date']);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('expense_entries');
}
