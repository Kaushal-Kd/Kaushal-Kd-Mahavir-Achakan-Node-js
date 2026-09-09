/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('reminders', (t) => {
    t.boolean('is_completed').notNullable().defaultTo(false);
    t.timestamp('completed_at').nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('reminders', (t) => {
    t.dropColumn('completed_at');
    t.dropColumn('is_completed');
  });
}
