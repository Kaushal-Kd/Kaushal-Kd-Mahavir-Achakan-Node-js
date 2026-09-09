/**
 * Store order status at payment time for finance report Details.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('payments', 'order_status_at_payment');
  if (!hasColumn) {
    await knex.schema.alterTable('payments', (t) => {
      t.string('order_status_at_payment', 40).nullable();
      t.index(['order_id', 'order_status_at_payment'], 'idx_payments_order_status_at_payment');
    });
  }

  await knex.raw(`
    UPDATE payments p
    INNER JOIN orders o ON o.id = p.order_id AND o.shop_id = p.shop_id
    SET p.order_status_at_payment = CASE
      WHEN o.returned_at IS NOT NULL AND p.created_at >= o.returned_at THEN 'returned'
      WHEN o.delivered_at IS NOT NULL AND p.created_at >= o.delivered_at THEN 'delivered'
      ELSE 'booked'
    END
    WHERE p.order_id IS NOT NULL
      AND (p.order_status_at_payment IS NULL OR p.order_status_at_payment = '')
  `);
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('payments', 'order_status_at_payment');
  if (hasColumn) {
    await knex.schema.alterTable('payments', (t) => {
      t.dropIndex(['order_id', 'order_status_at_payment'], 'idx_payments_order_status_at_payment');
      t.dropColumn('order_status_at_payment');
    });
  }
}
