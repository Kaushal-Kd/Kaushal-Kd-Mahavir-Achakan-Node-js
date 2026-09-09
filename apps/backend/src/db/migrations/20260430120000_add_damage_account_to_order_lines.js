/**
 * Track accounting ledger account used for damage/missing charges.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('order_items', (t) => {
    t.string('damage_account_id', 80).nullable();
  });
  await knex.schema.alterTable('order_accessories', (t) => {
    t.string('damage_account_id', 80).nullable();
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('order_accessories', (t) => {
    t.dropColumn('damage_account_id');
  });
  await knex.schema.alterTable('order_items', (t) => {
    t.dropColumn('damage_account_id');
  });
}
