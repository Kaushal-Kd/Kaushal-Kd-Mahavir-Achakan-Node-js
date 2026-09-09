/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('payment_accounts');
  if (!hasTable) return;
  const has = await knex.schema.hasColumn('payment_accounts', 'shop_name');
  if (!has) return;
  await knex.schema.alterTable('payment_accounts', (t) => {
    t.dropColumn('shop_name');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasTable = await knex.schema.hasTable('payment_accounts');
  if (!hasTable) return;
  const has = await knex.schema.hasColumn('payment_accounts', 'shop_name');
  if (has) return;
  await knex.schema.alterTable('payment_accounts', (t) => {
    t.string('shop_name', 200).notNullable().defaultTo('');
  });
}
