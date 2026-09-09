/** Optional time of day for reminders (12h string e.g. "2:30 PM"). */
export async function up(knex) {
  const has = await knex.schema.hasColumn('reminders', 'reminder_time');
  if (!has) {
    await knex.schema.alterTable('reminders', (t) => {
      t.string('reminder_time', 20).nullable();
    });
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('reminders', 'reminder_time');
  if (has) {
    await knex.schema.alterTable('reminders', (t) => {
      t.dropColumn('reminder_time');
    });
  }
}
