import { ordersApi } from './api/orders.js';
import { buildAccessoryTokenSegments, resolveSlipOrderAddress } from './deliverySlipFormat.js';

/** Flatten customer + bill fields for delivery slip header. */
function enrichSlipOrder(order, row) {
  const customer = order?.customer;
  return {
    ...order,
    customer_name:
      customer?.name ||
      order.customer_name ||
      row?.customer_name ||
      order.pickup_name ||
      row?.pickup_name ||
      '',
    customer_phone:
      customer?.phone1 ||
      order.customer_phone ||
      row?.customer_phone ||
      order.pickup_number ||
      row?.pickup_number ||
      '',
    customer_address: resolveSlipOrderAddress(order, row),
    customer_notes: order?.customer_notes ?? row?.customer_notes ?? '',
    order_number: order?.order_number || row?.order_number || '',
    pickup_date: order?.pickup_date ?? row?.pickup_date,
    return_date: order?.return_date ?? row?.return_date,
    pickup_name: order?.pickup_name || row?.pickup_name || '',
    pickup_number: order?.pickup_number || row?.pickup_number || '',
  };
}

/**
 * Build one delivery slip per product line (always product-wise).
 * Fetches parent orders so linked accessories appear on the slip.
 *
 * @param {object[]} lines — rows from GET /orders/items-to-collect
 * @returns {Promise<object[]>}
 */
export async function fetchProductWiseSlipTargets(lines) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return [];

  const orderIds = [...new Set(list.map((r) => r.order_id).filter(Boolean))];
  const orderResults = await Promise.all(
    orderIds.map((id) =>
      ordersApi
        .get(id)
        .then((r) => r.data)
        .catch(() => null)
    )
  );
  const orderById = new Map();
  for (const order of orderResults) {
    if (order?.id) orderById.set(order.id, order);
  }

  const targets = [];
  const accessoryOnlyOrderIds = new Set();
  for (const row of list) {
    const order = orderById.get(row.order_id);
    if (!order) continue;

    if (row.is_accessory_only) {
      if (accessoryOnlyOrderIds.has(order.id)) continue;
      accessoryOnlyOrderIds.add(order.id);
      const accessories = Array.isArray(order.accessories) ? order.accessories : [];
      const accessorySegments = buildAccessoryTokenSegments(accessories, { includeAll: true });
      if (!accessorySegments.length) continue;
      targets.push({
        ...enrichSlipOrder(order, row),
        id: `${order.id}::accessories`,
        slipKind: 'accessory',
        accessorySegments,
      });
      continue;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const item = items.find((it) => it.id === row.id) || {
      id: row.id,
      name_snapshot: row.product_name,
      code_snapshot: row.product_code,
      qty: row.qty,
      type: row.line_type || 'rent',
    };

    const slipItem = {
      ...item,
      product_catalog_notes: row.product_catalog_notes ?? item.product_catalog_notes ?? '',
    };

    targets.push({
      ...enrichSlipOrder(order, row),
      id: `${order.id}::${slipItem.id}`,
      items: [slipItem],
      product_catalog_notes: row.product_catalog_notes ?? '',
      accessories: (order.accessories || []).filter((a) => a.order_item_id === slipItem.id),
    });
  }
  return targets;
}
