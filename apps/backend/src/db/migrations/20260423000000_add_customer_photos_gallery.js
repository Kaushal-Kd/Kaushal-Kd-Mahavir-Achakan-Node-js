/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('customers', 'photos');
  if (!has) {
    await knex.schema.alterTable('customers', (t) => {
      t.json('photos').nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('customers', 'photos');
  if (has) {
    await knex.schema.alterTable('customers', (t) => {
      t.dropColumn('photos');
    });
  }
}
