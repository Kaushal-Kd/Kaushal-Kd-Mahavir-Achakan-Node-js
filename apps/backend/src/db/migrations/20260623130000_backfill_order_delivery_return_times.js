/**
 * Backfill delivery/return times for bookings created before times were persisted.
 */

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex('orders').whereNull('delivery_time').update({ delivery_time: '15:30' });
  await knex('orders').whereNull('return_time').update({ return_time: '12:00' });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('orders')
    .where({ delivery_time: '15:30' })
    .update({ delivery_time: null });
  await knex('orders')
    .where({ return_time: '12:00' })
    .update({ return_time: null });
}
