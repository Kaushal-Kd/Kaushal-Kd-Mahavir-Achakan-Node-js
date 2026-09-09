/**
 * Per-booking buffer before pickup (blocks earlier bookings placed too close).
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('orders', 'previous_booking_gap_days'))) {
    await knex.schema.alterTable('orders', (t) => {
      t.integer('previous_booking_gap_days').notNullable().defaultTo(0);
    });
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  if (await knex.schema.hasColumn('orders', 'previous_booking_gap_days')) {
    await knex.schema.alterTable('orders', (t) => {
      t.dropColumn('previous_booking_gap_days');
    });
  }
}
