/**
 * Optional operator notes per accessory line on an order.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('order_accessories', (t) => {
    t.string('remarks', 500).notNullable().defaultTo('');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('order_accessories', (t) => {
    t.dropColumn('remarks');
  });
}
