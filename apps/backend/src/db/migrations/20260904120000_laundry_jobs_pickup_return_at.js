/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasPickup = await knex.schema.hasColumn('laundry_jobs', 'pickup_at');
  if (!hasPickup) {
    await knex.schema.alterTable('laundry_jobs', (t) => {
      t.datetime('pickup_at').nullable();
    });
  }
  const hasReturn = await knex.schema.hasColumn('laundry_jobs', 'return_at');
  if (!hasReturn) {
    await knex.schema.alterTable('laundry_jobs', (t) => {
      t.datetime('return_at').nullable();
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasPickup = await knex.schema.hasColumn('laundry_jobs', 'pickup_at');
  if (hasPickup) {
    await knex.schema.alterTable('laundry_jobs', (t) => {
      t.dropColumn('pickup_at');
    });
  }
  const hasReturn = await knex.schema.hasColumn('laundry_jobs', 'return_at');
  if (hasReturn) {
    await knex.schema.alterTable('laundry_jobs', (t) => {
      t.dropColumn('return_at');
    });
  }
}
