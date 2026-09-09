/**
 * Replace `orders.customer_behaviours_days` with `orders.next_booking_gap_days`
 * (operator-entered prep gap for this booking).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('orders', 'next_booking_gap_days'))) {
    await knex.schema.alterTable('orders', (t) => {
      t.integer('next_booking_gap_days').notNullable().defaultTo(0);
    });
  }
  if (await knex.schema.hasColumn('orders', 'customer_behaviours_days')) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('customer_behaviours_days');
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  if (!(await knex.schema.hasColumn('orders', 'customer_behaviours_days'))) {
    await knex.schema.alterTable('orders', (t) => {
      t.integer('customer_behaviours_days').notNullable().defaultTo(0);
    });
  }
  if (await knex.schema.hasColumn('orders', 'next_booking_gap_days')) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('next_booking_gap_days');
    });
  }
}
