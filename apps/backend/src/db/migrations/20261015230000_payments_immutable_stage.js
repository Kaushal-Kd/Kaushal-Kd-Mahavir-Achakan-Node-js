export async function up(knex) {
  await knex.schema.alterTable('payments', (table) => {
    table.enum('payment_stage', ['booking', 'delivery', 'return']).nullable();
    table.index(['shop_id', 'payment_stage'], 'idx_payments_immutable_stage');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('payments', (table) => {
    table.dropIndex(['shop_id', 'payment_stage'], 'idx_payments_immutable_stage');
    table.dropColumn('payment_stage');
  });
}
