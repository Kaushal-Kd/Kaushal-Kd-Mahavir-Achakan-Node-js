/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('laundry_jobs', 'vendor_account_id');
  if (has) return;
  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.string('vendor_account_id', 80).nullable().index();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('laundry_jobs', 'vendor_account_id');
  if (!has) return;
  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.dropColumn('vendor_account_id');
  });
}
