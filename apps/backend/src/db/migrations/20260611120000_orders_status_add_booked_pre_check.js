/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE orders MODIFY COLUMN status ENUM(
      'draft',
      'booked',
      'pending',
      'confirmed',
      'pre_check',
      'in_preparation',
      'ready_for_delivery',
      'delivered',
      'partially_returned',
      'returned',
      'closed',
      'cancelled'
    ) NOT NULL DEFAULT 'pending'
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex('orders').whereIn('status', ['booked', 'pre_check']).update({ status: 'pending' });
  await knex.raw(`
    ALTER TABLE orders MODIFY COLUMN status ENUM(
      'draft',
      'pending',
      'confirmed',
      'in_preparation',
      'ready_for_delivery',
      'delivered',
      'partially_returned',
      'returned',
      'closed',
      'cancelled'
    ) NOT NULL DEFAULT 'pending'
  `);
}
