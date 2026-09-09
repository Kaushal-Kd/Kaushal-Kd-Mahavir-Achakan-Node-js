/**
 * Fan out order list rows into one row per product line (delivery / returns product-wise view).
 * @param {object[]} orders
 */
export function expandOrdersToProductWiseRows(orders) {
  const expanded = [];
  for (const order of orders || []) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) continue;
    for (const item of items) {
      expanded.push({
        ...order,
        id: `${order.id}::${item.id}`,
        _row_kind: 'product',
        order_id: order.id,
        product_item_id: item.id,
        product_name: item.name_snapshot || '',
        product_code: item.code_snapshot || '',
        product_image: item.main_image || item.image_url || null,
        product_qty: Number(item.qty || 0),
        product_line_total: Number(item.line_total || 0),
        product_type: item.type || 'rent',
        product_delivered_at: item.delivered_at ?? null,
        product_received_at: item.received_at ?? null,
        stage_flags: item.stage_flags ?? null,
      });
    }
  }
  return expanded;
}

/** When product-wise + search, show only lines matching product or order-level fields. */
export function filterProductWiseRows(rows, searchTerm) {
  const q = String(searchTerm || '')
    .trim()
    .toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    if ((r.product_name || '').toLowerCase().includes(q)) return true;
    if ((r.product_code || '').toLowerCase().includes(q)) return true;
    if ((r.order_number || '').toLowerCase().includes(q)) return true;
    if ((r.customer_name || r.pickup_name || '').toLowerCase().includes(q)) return true;
    if ((r.customer_phone || r.pickup_number || '').toLowerCase().includes(q)) return true;
    if ((r.customer_whatsapp || '').toLowerCase().includes(q)) return true;
    if ((r.customer_address || r.address || '').toLowerCase().includes(q)) return true;
    if ((r.reference_name || '').toLowerCase().includes(q)) return true;
    return false;
  });
}
