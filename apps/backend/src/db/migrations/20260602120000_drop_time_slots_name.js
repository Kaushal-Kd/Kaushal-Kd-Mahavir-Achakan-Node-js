/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('time_slots', (t) => {
    t.dropColumn('name');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('time_slots', (t) => {
    t.string('name', 120).notNullable().defaultTo('');
  });
}
