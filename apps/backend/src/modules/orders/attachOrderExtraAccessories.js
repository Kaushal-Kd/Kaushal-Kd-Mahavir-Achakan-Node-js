import knex from '../../db/knex.js';

/**
 * Attach order-level accessories (not linked to a product line) for item-stage export rows.
 *
 * @param {string} shopId
 * @param {Array<{ order_id?: string }>} rows
 */
export async function attachOrderExtraAccessories(shopId, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;

  const orderIds = [...new Set(list.map((r) => r.order_id).filter(Boolean))];
  if (!orderIds.length) return;

  const accessoryRows = await knex('order_accessories as oa')
    .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
    .leftJoin('categories as cat', 'cat.id', 'a.category_id')
    .where({ 'oa.shop_id': shopId })
    .whereIn('oa.order_id', orderIds)
    .whereNull('oa.order_item_id')
    .select(
      'oa.id',
      'oa.order_id',
      'oa.name_snapshot',
      'oa.qty',
      'oa.type',
      'oa.line_total',
      'oa.given_status',
      'oa.stage_flags',
      'oa.remarks',
      'cat.label as category_name'
    )
    .orderBy(['oa.display_order', 'oa.created_at']);

  const byOrderId = new Map();
  for (const acc of accessoryRows) {
    const orderId = String(acc.order_id);
    if (!byOrderId.has(orderId)) byOrderId.set(orderId, []);
    byOrderId.get(orderId).push({
      id: acc.id,
      name_snapshot: acc.name_snapshot,
      category_name: acc.category_name,
      qty: acc.qty,
      type: acc.type,
      line_total: acc.line_total,
      given_status: acc.given_status,
      stage_flags: acc.stage_flags,
      remarks: acc.remarks,
    });
  }

  for (const row of list) {
    row.order_extra_accessories = byOrderId.get(String(row.order_id)) || [];
  }
}
