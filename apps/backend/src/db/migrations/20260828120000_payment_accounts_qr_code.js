/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('payment_accounts');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('payment_accounts', 'qr_code_url');
  if (hasColumn) return;

  await knex.schema.alterTable('payment_accounts', (t) => {
    t.string('qr_code_url', 500).notNullable().defaultTo('');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('payment_accounts');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('payment_accounts', 'qr_code_url');
  if (!hasColumn) return;

  await knex.schema.alterTable('payment_accounts', (t) => {
    t.dropColumn('qr_code_url');
  });
}
