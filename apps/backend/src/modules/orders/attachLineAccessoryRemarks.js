import knex from '../../db/knex.js';

/**
 * Attach semicolon-separated accessory remarks for item-stage list rows (PDF export).
 *
 * @param {string} shopId
 * @param {Array<{ id?: string }>} rows
 */
export async function attachLineAccessoryRemarks(shopId, rows) {
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
    .whereRaw('TRIM(oa.remarks) <> ?', [''])
    .select(
      'oa.order_item_id',
      'oa.remarks',
      'cat.label as category_name',
      'oa.name_snapshot'
    )
    .orderBy(['oa.display_order', 'oa.created_at']);

  const byItemId = new Map();
  for (const acc of accessoryRows) {
    const itemId = String(acc.order_item_id);
    if (!byItemId.has(itemId)) byItemId.set(itemId, []);
    const cat = String(acc.category_name || '').trim();
    const name = String(acc.name_snapshot || '').trim();
    const label = cat || name || 'Accessory';
    const remark = String(acc.remarks || '').trim();
    if (!remark) continue;
    const entry = { label, remark };
    byItemId.get(itemId).push(entry);
  }

  for (const row of list) {
    const parts = byItemId.get(String(row.id)) || [];
    row.accessory_remarks_parts = parts;
    row.accessory_remarks_text = parts.length
      ? parts.map((p) => `${p.label}: ${p.remark}`).join('; ')
      : '';
  }
}
