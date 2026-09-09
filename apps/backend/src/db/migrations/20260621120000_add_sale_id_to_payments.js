export async function up(knex) {
  const hasSaleId = await knex.schema.hasColumn('payments', 'sale_id');
  if (!hasSaleId) {
    await knex.schema.alterTable('payments', (t) => {
      t.uuid('sale_id').nullable().index();
    });
  }
}

export async function down(knex) {
  const hasSaleId = await knex.schema.hasColumn('payments', 'sale_id');
  if (hasSaleId) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropColumn('sale_id');
    });
  }
}
