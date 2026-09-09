import knex from '../../db/knex.js';
import {
  groupUpcomingBookingsByAccessoryId,
  groupUpcomingBookingsByProductId,
} from '../products/upcomingBookings.js';

function mapQueueRow(r, upcomingByKey) {
  const kind = String(r.item_kind || 'product').toLowerCase();
  const lookupId = kind === 'accessory' ? r.accessory_id : r.product_id;
  const upcoming = lookupId ? upcomingByKey.get(String(lookupId)) || [] : [];
  const next = upcoming[0] || null;
  return {
    id: r.id,
    item_kind: kind,
    product_id: r.product_id,
    accessory_id: r.accessory_id,
    order_id: r.order_id,
    order_item_id: r.order_item_id,
    order_accessory_id: r.order_accessory_id,
    code: r.product_code || r.current_product_code || r.current_accessory_code || '',
    name: r.product_name || r.current_product_name || r.current_accessory_name || '',
    image: r.image_url || r.current_image || r.current_accessory_image || '',
    category_id: r.category_id,
    category_label: r.category_label || 'Uncategorized',
    qty: Number(r.qty || 1),
    queued_at: r.queued_at,
    order_number: r.order_number || null,
    next_pickup_date: next?.pickup_date || null,
    next_booking_no: next?.order_number || null,
    next_customer_name: next?.customer_name || null,
    upcoming_bookings: upcoming,
  };
}

export async function listWashingQueue(shopId) {
  const rows = await knex('washing_queue as wq')
    .leftJoin('products as p', 'p.id', 'wq.product_id')
    .leftJoin('accessories as a', 'a.id', 'wq.accessory_id')
    .leftJoin('categories as c', 'c.id', 'wq.category_id')
    .leftJoin('orders as o', 'o.id', 'wq.order_id')
    .where('wq.shop_id', shopId)
    .andWhere((scope) => {
      scope
        .whereNull('wq.item_kind')
        .orWhereNot('wq.item_kind', 'accessory')
        .orWhere('c.is_washable', true);
    })
    .orderBy('wq.queued_at', 'desc')
    .select(
      'wq.id',
      'wq.item_kind',
      'wq.product_id',
      'wq.accessory_id',
      'wq.order_id',
      'wq.order_item_id',
      'wq.order_accessory_id',
      'wq.product_code',
      'wq.product_name',
      'wq.image_url',
      'wq.category_id',
      'c.label as category_label',
      'wq.qty',
      'wq.queued_at',
      'o.order_number',
      'p.name as current_product_name',
      'p.code as current_product_code',
      'p.main_image as current_image',
      'a.name as current_accessory_name',
      'a.code as current_accessory_code',
      'a.image_url as current_accessory_image'
    );

  const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean))];
  const accessoryIds = [...new Set(rows.map((row) => row.accessory_id).filter(Boolean))];

  const [upcomingByProductId, upcomingByAccessoryId] = await Promise.all([
    groupUpcomingBookingsByProductId(shopId, productIds),
    groupUpcomingBookingsByAccessoryId(shopId, accessoryIds),
  ]);

  const upcomingByKey = new Map([...upcomingByProductId, ...upcomingByAccessoryId]);

  return rows.map((r) => mapQueueRow(r, upcomingByKey));
}

export async function removeFromQueue(shopId, queueId) {
  const deleted = await knex('washing_queue').where({ id: queueId, shop_id: shopId }).del();
  return deleted > 0;
}

export async function removeMultipleFromQueue(shopId, queueIds) {
  if (!Array.isArray(queueIds) || queueIds.length === 0) return 0;
  return knex('washing_queue').where('shop_id', shopId).whereIn('id', queueIds).del();
}
