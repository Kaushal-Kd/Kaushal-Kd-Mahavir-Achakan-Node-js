/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasPurchaseId = await knex.schema.hasColumn('payments', 'purchase_id');
  if (!hasPurchaseId) {
    await knex.schema.alterTable('payments', (t) => {
      t.uuid('purchase_id').nullable().index();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasPurchaseId = await knex.schema.hasColumn('payments', 'purchase_id');
  if (hasPurchaseId) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropColumn('purchase_id');
    });
  }
}
