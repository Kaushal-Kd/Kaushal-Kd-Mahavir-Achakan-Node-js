const COLUMNS = [
  'customer_behaviours_days',
  'referred_by',
  'lead_source',
  'id_proof_number',
  'id_proof_type',
  'id_proof_url',
];

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  for (const col of COLUMNS) {
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
  await knex.schema.alterTable('customers', (t) => {
    t.string('id_proof_url', 500).nullable();
    t.string('id_proof_type', 40).nullable();
    t.string('id_proof_number', 60).nullable();
    t.string('lead_source', 100).nullable();
    t.string('referred_by', 200).nullable();
    t.integer('customer_behaviours_days').notNullable().defaultTo(0);
  });
}
