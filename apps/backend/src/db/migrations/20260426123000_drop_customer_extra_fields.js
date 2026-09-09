const DROP_COLUMNS = ['city', 'state', 'pincode', 'dob', 'is_vip', 'is_blacklisted', 'photos'];

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  for (const col of DROP_COLUMNS) {
    const has = await knex.schema.hasColumn('customers', col);
    if (has) {
      await knex.schema.alterTable('customers', (t) => {
        t.dropColumn(col);
      });
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const addIfMissing = async (name, addColumn) => {
    const has = await knex.schema.hasColumn('customers', name);
    if (!has) {
      await knex.schema.alterTable('customers', addColumn);
    }
  };

  await addIfMissing('city', (t) => t.string('city', 100).nullable());
  await addIfMissing('state', (t) => t.string('state', 100).nullable());
  await addIfMissing('pincode', (t) => t.string('pincode', 20).nullable());
  await addIfMissing('dob', (t) => t.date('dob').nullable());
  await addIfMissing('is_vip', (t) => t.boolean('is_vip').notNullable().defaultTo(false));
  await addIfMissing('is_blacklisted', (t) =>
    t.boolean('is_blacklisted').notNullable().defaultTo(false)
  );
  await addIfMissing('photos', (t) => t.json('photos').nullable());
}
