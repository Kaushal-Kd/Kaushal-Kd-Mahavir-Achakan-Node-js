import { todayIndiaISODate } from '@wrs/shared';
import knex from '../../db/knex.js';

export const NEXT_PICKUP_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
];

function todayIso() {
  return todayIndiaISODate();
}

function mapUpcomingRow(row) {
  return {
    order_id: row.order_id,
    order_number: row.order_number,
    bill_no: row.bill_no,
    pickup_date: row.pickup_date,
    return_date: row.return_date || null,
    status: row.status,
    booked_qty: Number(row.booked_qty || 0),
    customer_name: row.customer_name || null,
  };
}

/**
 * Future rent bookings per product (earliest pickup first).
 * @param {string} shopId
 * @param {string[]} productIds
 * @param {{ fromDate?: string }} [options]
 * @returns {Promise<Map<string, object[]>>}
 */
export async function groupUpcomingBookingsByProductId(shopId, productIds, options = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const minPickup = options.fromDate || todayIso();
  const rows = await knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oi.shop_id', shopId)
    .whereIn('oi.product_id', ids)
    .andWhere('o.is_deleted', false)
    .andWhere('oi.type', 'rent')
    .whereIn('o.status', NEXT_PICKUP_STATUSES)
    .andWhere('o.pickup_date', '>=', minPickup)
    .orderBy('o.pickup_date', 'asc')
    .orderBy('o.order_number', 'asc')
    .select(
      'oi.product_id',
      'o.id as order_id',
      'o.order_number',
      'o.bill_no',
      'o.pickup_date',
      'o.return_date',
      'o.status',
      'oi.qty as booked_qty',
      'c.name as customer_name'
    );

  for (const row of rows) {
    if (!map.has(row.product_id)) map.set(row.product_id, []);
    map.get(row.product_id).push(mapUpcomingRow(row));
  }
  return map;
}

/**
 * Future rent bookings per accessory (earliest pickup first).
 * @param {string} shopId
 * @param {string[]} accessoryIds
 * @param {{ fromDate?: string }} [options]
 * @returns {Promise<Map<string, object[]>>}
 */
export async function groupUpcomingBookingsByAccessoryId(shopId, accessoryIds, options = {}) {
  const ids = [...new Set((accessoryIds || []).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;

  const minPickup = options.fromDate || todayIso();
  const rows = await knex('order_accessories as oa')
    .join('orders as o', 'o.id', 'oa.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oa.shop_id', shopId)
    .whereIn('oa.accessory_id', ids)
    .andWhere('o.is_deleted', false)
    .andWhere('oa.type', 'rent')
    .whereIn('o.status', NEXT_PICKUP_STATUSES)
    .andWhere('o.pickup_date', '>=', minPickup)
    .orderBy('o.pickup_date', 'asc')
    .orderBy('o.order_number', 'asc')
    .select(
      'oa.accessory_id',
      'o.id as order_id',
      'o.order_number',
      'o.bill_no',
      'o.pickup_date',
      'o.return_date',
      'o.status',
      'oa.qty as booked_qty',
      'c.name as customer_name'
    );

  for (const row of rows) {
    const key = String(row.accessory_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(mapUpcomingRow(row));
  }
  return map;
}

/**
 * @param {string} shopId
 * @param {string} productId
 * @param {{ fromDate?: string }} [options]
 */
export async function listUpcomingBookingsForProduct(shopId, productId, options = {}) {
  const map = await groupUpcomingBookingsByProductId(shopId, [productId], options);
  return map.get(productId) || [];
}
