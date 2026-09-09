/**
 * Clear bucket-only backfill values from order_status_at_payment.
 * Those rows should use milestone / follow-up inference at report time instead.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex('payments')
    .whereNotNull('order_id')
    .whereIn('order_status_at_payment', ['booked', 'delivered', 'returned'])
    .update({ order_status_at_payment: null });
}

/** @param {import('knex').Knex} knex */
export async function down(_knex) {
  // Non-reversible without recomputing from order milestones.
}
