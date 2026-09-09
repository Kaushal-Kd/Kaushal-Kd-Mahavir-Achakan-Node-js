import knex from '../../db/knex.js';

/**
 * Attach linked accessories (code, qty, type, rent, given status) for item-stage export rows.
 *
 * @param {string} shopId
 * @param {Array<{ id?: string }>} rows
 */
export async function attachLineAccessoriesDetail(shopId, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;

  const itemIds = [...new Set(list.map((r) => r.id).filter(Boolean))];
  if (!itemIds.length) return;

  const accessoryRows = await knex('order_accessories as oa')
    .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
    .leftJoin('categories as cat', 'cat.id', 'a.category_id')
    .where({ 'oa.shop_id': shopId })
    .whereIn('oa.order_item_id', itemIds)
    .whereNotNull('oa.order_item_id')
    .select(
      'oa.id',
      'oa.order_item_id',
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

  const byItemId = new Map();
  for (const acc of accessoryRows) {
    const itemId = String(acc.order_item_id);
    if (!byItemId.has(itemId)) byItemId.set(itemId, []);
    byItemId.get(itemId).push({
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
    row.line_accessories = byItemId.get(String(row.id)) || [];
  }
}
