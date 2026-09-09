/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const has = await knex.schema.hasColumn('laundry_jobs', 'laundry_at');
  if (has) return;

  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.dateTime('laundry_at').nullable();
  });

  await knex.raw(`
    UPDATE laundry_jobs
    SET laundry_at = CONCAT(laundry_date, ' ', TIME(created_at))
    WHERE laundry_at IS NULL AND laundry_date IS NOT NULL
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const has = await knex.schema.hasColumn('laundry_jobs', 'laundry_at');
  if (!has) return;
  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.dropColumn('laundry_at');
  });
}
