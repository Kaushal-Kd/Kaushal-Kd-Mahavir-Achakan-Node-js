/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.raw(`
    UPDATE order_items oi
    JOIN products p ON p.id = oi.product_id
    SET oi.code_snapshot = p.code
    WHERE (oi.code_snapshot IS NULL OR oi.code_snapshot = '')
      AND p.code IS NOT NULL
      AND p.code != ''
  `);
}

/** @param {import('knex').Knex} knex */
export async function down() {
  // no-op: cannot reliably revert a backfill
}
