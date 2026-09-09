export async function up(knex) {
  const hasSalesmanId = await knex.schema.hasColumn('sales', 'salesman_id');
  if (hasSalesmanId) {
    await knex.schema.alterTable('sales', (t) => {
      t.dropColumn('salesman_id');
    });
  }
}

export async function down(knex) {
  const hasSalesmanId = await knex.schema.hasColumn('sales', 'salesman_id');
  if (!hasSalesmanId) {
    await knex.schema.alterTable('sales', (t) => {
      t.uuid('salesman_id').nullable();
    });
  }
}
