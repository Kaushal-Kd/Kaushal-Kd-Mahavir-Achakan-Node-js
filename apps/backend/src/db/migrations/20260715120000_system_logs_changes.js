/**
 * Store precomputed bill/product change diffs for readable system logs.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const hasBillChanges = await knex.schema.hasColumn('system_logs', 'bill_changes');
  if (hasBillChanges) return;

  await knex.schema.alterTable('system_logs', (t) => {
    t.json('bill_changes').nullable();
    t.json('product_changes').nullable();
    t.integer('bill_change_count').unsigned().notNullable().defaultTo(0);
    t.integer('product_change_count').unsigned().notNullable().defaultTo(0);
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasBillChanges = await knex.schema.hasColumn('system_logs', 'bill_changes');
  if (!hasBillChanges) return;

  await knex.schema.alterTable('system_logs', (t) => {
    t.dropColumn('bill_changes');
    t.dropColumn('product_changes');
    t.dropColumn('bill_change_count');
    t.dropColumn('product_change_count');
  });
}
