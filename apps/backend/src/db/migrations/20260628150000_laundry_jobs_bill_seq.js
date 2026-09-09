/**
 * Sequence counter for laundry job numbers (W-0001, W-0002, …).
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('laundry_jobs', 'bill_seq');
  if (has) return;

  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.integer('bill_seq').unsigned().nullable();
  });

  const jobs = await knex('laundry_jobs').select('id', 'job_no');
  for (const job of jobs) {
    const match = /^W-(\d+)$/i.exec(String(job.job_no || '').trim());
    if (!match) continue;
    const seq = Number.parseInt(match[1], 10);
    if (!Number.isFinite(seq)) continue;
    await knex('laundry_jobs').where({ id: job.id }).update({ bill_seq: seq });
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('laundry_jobs', 'bill_seq');
  if (!has) return;
  await knex.schema.alterTable('laundry_jobs', (t) => {
    t.dropColumn('bill_seq');
  });
}
