export const requiresExplicitRun = true;

export async function up(knex) {
  await knex.schema.alterTable('security_charges', (table) => {
    table.integer('money_flow_version').nullable();
  });
  await knex.schema.createTable('security_charge_operations', (table) => {
    table.uuid('id').primary();
    table.uuid('shop_id').notNullable().index();
    table.uuid('charge_id').notNullable().index();
    table.uuid('order_id').notNullable().index();
    table.uuid('command_id').notNullable();
    table.integer('operation_index').notNullable();
    table.string('kind', 16).notNullable();
    table.decimal('amount', 12, 2).notNullable();
    table.uuid('funding_operation_id').nullable().index();
    table.uuid('source_deposit_payment_id').nullable().index();
    table.uuid('payment_id').nullable().unique();
    table.uuid('income_entry_id').nullable().unique();
    table.string('payment_account_id', 80).nullable();
    table.string('security_account_id', 80).nullable();
    table.date('payment_date').notNullable();
    table.string('remarks', 2000).nullable();
    table.uuid('created_by').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['shop_id', 'command_id', 'operation_index'], 'security_charge_command_operation');
    table.foreign('charge_id').references('security_charges.id').onDelete('RESTRICT');
    table.foreign('shop_id').references('shops.id').onDelete('RESTRICT');
  });
}

export async function down(knex) {
  const used = await knex('security_charge_operations').first('id');
  if (used)
    throw new Error('Cannot remove the condition ledger while recorded money operations exist');
  await knex.schema.dropTable('security_charge_operations');
  await knex.schema.alterTable('security_charges', (table) =>
    table.dropColumn('money_flow_version')
  );
}
