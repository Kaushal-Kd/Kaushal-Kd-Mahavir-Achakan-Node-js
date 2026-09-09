/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('avatar_url');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('avatar_url', 500).nullable();
  });
}
