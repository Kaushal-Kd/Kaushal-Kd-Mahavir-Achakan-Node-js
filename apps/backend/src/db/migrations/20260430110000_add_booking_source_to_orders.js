/**
 * Add booking source (direct vs cart) for booking flow tracking.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.string('booking_source', 20).notNullable().defaultTo('direct');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('orders', (t) => {
    t.dropColumn('booking_source');
  });
}
