/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('credit_notes', (t) => {
    t.decimal('amount_settled', 12, 2).notNullable().defaultTo(0).after('amount_applied');
  });

  await knex.raw(`
    UPDATE credit_notes
    SET amount_settled = GREATEST(0, ROUND(amount - COALESCE(amount_applied, 0), 2))
    WHERE settled_at IS NOT NULL
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('credit_notes', (t) => {
    t.dropColumn('amount_settled');
  });
}
