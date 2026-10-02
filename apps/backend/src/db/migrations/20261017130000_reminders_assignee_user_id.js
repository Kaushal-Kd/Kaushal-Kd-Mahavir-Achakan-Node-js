/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('reminders', 'assignee_user_id');
  if (has) return;
  await knex.schema.alterTable('reminders', (t) => {
    t.uuid('assignee_user_id').nullable().index();
    t.foreign('assignee_user_id').references('users.id').onDelete('SET NULL');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('reminders', 'assignee_user_id');
  if (!has) return;
  await knex.schema.alterTable('reminders', (t) => {
    t.dropForeign('assignee_user_id');
    t.dropColumn('assignee_user_id');
  });
}
