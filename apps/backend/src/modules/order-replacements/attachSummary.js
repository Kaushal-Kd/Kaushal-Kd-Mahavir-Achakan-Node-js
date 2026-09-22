/**
 * @param {object[]} rows
 * @returns {Map<string, object[]>}
 */
export function groupDamageReplacementsByTargetOrder(rows) {
  const byOrder = new Map();
  for (const row of rows || []) {
    const orderId = String(row.target_order_id || '').trim();
    if (!orderId) continue;
    if (!byOrder.has(orderId)) byOrder.set(orderId, []);
    byOrder.get(orderId).push({
      requirement_id: row.id || null,
      target_order_item_id: row.target_order_item_id || null,
      source_order_id: row.source_order_id || null,
      source_product_id: row.source_product_id || null,
      source_product_label: String(row.source_product_label || '').trim() || 'Damaged product',
      pickup_date: row.pickup_date || null,
      customer_name: String(row.customer_name || '').trim(),
      customer_phone: String(row.customer_phone || '').trim(),
      customer_whatsapp: String(row.customer_whatsapp || '').trim(),
    });
  }
  return byOrder;
}

/**
 * @param {object[]} orders
 * @param {Map<string, object[]>} byOrder
 */
export function applyDamageReplacementSummary(orders, byOrder) {
  for (const order of orders || []) {
    const list = byOrder.get(String(order.id)) || [];
    order.has_damage_replacement = list.length > 0;
    order.damage_replacement_count = list.length;
    order.damage_replacements = list;
  }
}

/**
 * Line lists use item id as `id` and order id as `order_id`.
 * @param {object[]} rows
 * @param {Map<string, object[]>} byOrder
 */
export function applyDamageReplacementSummaryToLines(rows, byOrder) {
  for (const row of rows || []) {
    const orderId = String(row.order_id || row.id || '').trim();
    const list = byOrder.get(orderId) || [];
    const lineId = String(row.id || '');
    const lineHits = list.filter((item) => String(item.target_order_item_id || '') === lineId);
    row.has_damage_replacement = list.length > 0;
    row.damage_replacement_count = list.length;
    row.damage_replacements = list;
    row.line_has_damage_replacement = lineHits.length > 0;
  }
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {string[]} orderIds
 */
export async function loadPendingDamageReplacementsByOrder(db, shopId, orderIds) {
  const ids = [...new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await db('order_item_replacement_requirements as rr')
    .join('orders as o', function joinOrder() {
      this.on('o.id', '=', 'rr.target_order_id').andOn('o.shop_id', '=', 'rr.shop_id');
    })
    .leftJoin('customers as c', function joinCustomer() {
      this.on('c.id', '=', 'o.customer_id').andOn('c.shop_id', '=', 'o.shop_id');
    })
    .where('rr.shop_id', shopId)
    .whereIn('rr.target_order_id', ids)
    .andWhere('rr.status', 'pending')
    .select(
      'rr.id',
      'rr.target_order_id',
      'rr.target_order_item_id',
      'rr.source_order_id',
      'rr.source_product_id',
      'rr.source_product_label',
      'o.pickup_date',
      'c.name as customer_name',
      'c.phone1 as customer_phone',
      'c.whatsapp as customer_whatsapp'
    )
    .orderBy('o.pickup_date', 'asc');

  return groupDamageReplacementsByTargetOrder(rows);
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {object[]} orders
 */
export async function attachDamageReplacementSummaryToOrders(db, shopId, orders) {
  applyDamageReplacementSummary(orders || [], new Map());
  if (!orders?.length) return;
  const byOrder = await loadPendingDamageReplacementsByOrder(
    db,
    shopId,
    orders.map((order) => order.id)
  );
  applyDamageReplacementSummary(orders, byOrder);
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {object[]} rows
 */
export async function attachDamageReplacementSummaryToLines(db, shopId, rows) {
  applyDamageReplacementSummaryToLines(rows || [], new Map());
  if (!rows?.length) return;
  const byOrder = await loadPendingDamageReplacementsByOrder(
    db,
    shopId,
    rows.map((row) => row.order_id || row.id)
  );
  applyDamageReplacementSummaryToLines(rows, byOrder);
}
