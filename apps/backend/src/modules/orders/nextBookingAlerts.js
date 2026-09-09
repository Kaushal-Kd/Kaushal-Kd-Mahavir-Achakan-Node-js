import { applyNextBookingAlertsToItems, buildNextBookingAlert, normalizeNextPickupDateToIso } from '@wrs/shared';

const APP_GAP_KEY = 'CHECK_AVAILABILITY_GAP_DAYS_BETWEEN_TWO_ORDERS';
const APP_CHECKLIST_ALERT_KEY = 'CHECKLIST_NEXT_BOOKING_ALERT_DAYS';
const LEGACY_GAP_KEY = 'config.order_defaults.next_booking_gap_days';
const LEGACY_CHECKLIST_ALERT_KEY = 'config.order_defaults.checklist_next_booking_alert_days';

const FUTURE_BOOKING_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
];

function parseJSONSafe(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readDays(byKey, key) {
  const n = Number(byKey[key] ?? 0);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

async function loadChecklistNextBookingAlertDays(db, shopId) {
  const rows = await db('settings')
    .where({ shop_id: shopId })
    .whereIn('key', [
      APP_CHECKLIST_ALERT_KEY,
      APP_GAP_KEY,
      LEGACY_CHECKLIST_ALERT_KEY,
      LEGACY_GAP_KEY,
    ]);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const alertSafe = readDays(byKey, APP_CHECKLIST_ALERT_KEY);
  if (alertSafe > 0) return alertSafe;
  const legacyAlert = readDays(byKey, LEGACY_CHECKLIST_ALERT_KEY);
  if (legacyAlert > 0) return legacyAlert;
  const gapSafe = readDays(byKey, APP_GAP_KEY);
  if (gapSafe > 0) return gapSafe;
  return readDays(byKey, LEGACY_GAP_KEY);
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {string} currentOrderId
 * @param {string | null | undefined} anchorDate
 * @param {string[]} productIds
 */
async function fetchEarliestNextBookingsByProduct(db, shopId, currentOrderId, anchorDate, productIds) {
  const nextByProductId = new Map();
  if (!anchorDate || productIds.length === 0) return nextByProductId;

  const rows = await db('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .whereIn('oi.product_id', productIds)
    .where('oi.type', 'rent')
    .where('o.id', '!=', currentOrderId)
    .where('o.is_deleted', false)
    .whereIn('o.status', FUTURE_BOOKING_STATUSES)
    .andWhere('o.pickup_date', '>=', anchorDate)
    .select(
      'oi.product_id',
      'o.id as next_order_id',
      'o.order_number as next_order_number',
      db.raw('DATE_FORMAT(o.pickup_date, "%Y-%m-%d") as next_pickup_date'),
      db.raw('DATEDIFF(o.pickup_date, ?) as gap_days', [anchorDate])
    )
    .orderBy('oi.product_id')
    .orderBy('o.pickup_date')
    .orderBy('o.order_number');

  for (const row of rows) {
    const productId = String(row.product_id);
    if (nextByProductId.has(productId)) continue;
    nextByProductId.set(productId, {
      next_order_id: String(row.next_order_id),
      next_order_number: String(row.next_order_number),
      next_pickup_date: normalizeNextPickupDateToIso(row.next_pickup_date) || String(row.next_pickup_date || ''),
      gap_days: Math.max(0, Math.floor(Number(row.gap_days) || 0)),
    });
  }

  return nextByProductId;
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {{ id: string, return_date?: string | null, pickup_date?: string | null, items?: Array<unknown> }} order
 */
export async function attachNextBookingAlerts(db, shopId, order) {
  const items = order.items || [];
  for (const item of items) {
    item.next_booking_alert = null;
  }

  const thresholdDays = await loadChecklistNextBookingAlertDays(db, shopId);
  if (thresholdDays <= 0) return;

  const anchorDate = order.return_date || order.pickup_date;
  if (!anchorDate) return;

  const productIds = [
    ...new Set(
      items
        .filter(
          (item) =>
            String(item.type || '').toLowerCase() === 'rent' &&
            item.product_id &&
            !item.stage_flags?.received
        )
        .map((item) => String(item.product_id))
    ),
  ];
  if (productIds.length === 0) return;

  const nextByProductId = await fetchEarliestNextBookingsByProduct(
    db,
    shopId,
    order.id,
    anchorDate,
    productIds
  );
  applyNextBookingAlertsToItems(items, nextByProductId, thresholdDays);
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {Map<string, { anchorDate: string, products: Map<string, string> }>} orderBuckets
 */
async function fetchEarliestNextBookingsBatch(db, shopId, orderBuckets) {
  const result = new Map();
  if (!orderBuckets.size) return result;

  const allProductIds = new Set();
  let minAnchor = null;
  const excludeOrderIds = new Set();

  for (const [orderId, bucket] of orderBuckets) {
    excludeOrderIds.add(orderId);
    if (!bucket.anchorDate) continue;
    const anchor = normalizeNextPickupDateToIso(bucket.anchorDate);
    if (!anchor) continue;
    if (!minAnchor || anchor < minAnchor) minAnchor = anchor;
    for (const productId of bucket.products.keys()) {
      allProductIds.add(productId);
    }
  }

  if (!minAnchor || allProductIds.size === 0) return result;

  const rows = await db('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .whereIn('oi.product_id', [...allProductIds])
    .where('oi.type', 'rent')
    .whereNotIn('o.id', [...excludeOrderIds])
    .where('o.is_deleted', false)
    .whereIn('o.status', FUTURE_BOOKING_STATUSES)
    .andWhere('o.pickup_date', '>=', minAnchor)
    .select(
      'oi.product_id',
      'o.id as next_order_id',
      'o.order_number as next_order_number',
      db.raw('DATE_FORMAT(o.pickup_date, "%Y-%m-%d") as next_pickup_date')
    )
    .orderBy('oi.product_id')
    .orderBy('o.pickup_date')
    .orderBy('o.order_number');

  const candidatesByProduct = new Map();
  for (const row of rows) {
    const productId = String(row.product_id);
    if (!candidatesByProduct.has(productId)) {
      candidatesByProduct.set(productId, []);
    }
    candidatesByProduct.get(productId).push(row);
  }

  for (const [orderId, bucket] of orderBuckets) {
    const anchorDate = normalizeNextPickupDateToIso(bucket.anchorDate);
    if (!anchorDate) continue;

    for (const [productId] of bucket.products.entries()) {
      const candidates = candidatesByProduct.get(productId) || [];
      for (const row of candidates) {
        const pickupIso =
          normalizeNextPickupDateToIso(row.next_pickup_date) || String(row.next_pickup_date || '');
        if (!pickupIso || pickupIso < anchorDate) continue;

        const gapDays = Math.max(
          0,
          Math.floor(
            (new Date(pickupIso).getTime() - new Date(anchorDate).getTime()) / 86400000
          )
        );

        const key = `${orderId}|${productId}`;
        if (!result.has(key)) {
          result.set(key, {
            next: {
              next_order_id: String(row.next_order_id),
              next_order_number: String(row.next_order_number),
              next_pickup_date: pickupIso,
              gap_days: gapDays,
            },
          });
        }
        break;
      }
    }
  }

  return result;
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {Array<{ id: string, has_next_booking_alert?: boolean, next_booking_alert_count?: number }>} orders
 */
export async function attachNextBookingAlertSummaryToOrders(db, shopId, orders) {
  for (const order of orders) {
    order.has_next_booking_alert = false;
    order.next_booking_alert_count = 0;
    order.next_booking_alerts = [];
  }
  if (!orders.length) return;

  const thresholdDays = await loadChecklistNextBookingAlertDays(db, shopId);
  if (thresholdDays <= 0) return;

  const orderIds = orders.map((order) => String(order.id));
  const itemRows = await db('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .whereIn('oi.order_id', orderIds)
    .where('oi.type', 'rent')
    .whereNotNull('oi.product_id')
    .select(
      'oi.order_id',
      'oi.product_id',
      'oi.stage_flags',
      'oi.name_snapshot',
      'o.return_date',
      'o.pickup_date'
    );

  const ordersById = new Map(orders.map((order) => [String(order.id), order]));
  const orderBuckets = new Map();

  for (const row of itemRows) {
    const flags = parseJSONSafe(row.stage_flags) || {};
    if (flags.received) continue;
    const orderId = String(row.order_id);
    if (!orderBuckets.has(orderId)) {
      orderBuckets.set(orderId, {
        anchorDate: row.return_date || row.pickup_date,
        products: new Map(),
      });
    }
    const bucket = orderBuckets.get(orderId);
    const productId = String(row.product_id);
    if (!bucket.products.has(productId)) {
      bucket.products.set(productId, String(row.name_snapshot || '').trim() || 'Product');
    }
  }

  const batchHits = await fetchEarliestNextBookingsBatch(db, shopId, orderBuckets);

  for (const [orderId, bucket] of orderBuckets) {
    const order = ordersById.get(orderId);
    if (!order || !bucket.anchorDate || bucket.products.size === 0) continue;

    const alerts = [];
    for (const [productId, nameSnapshot] of bucket.products.entries()) {
      const hit = batchHits.get(`${orderId}|${productId}`);
      const alert = buildNextBookingAlert(hit?.next, thresholdDays);
      if (!alert) continue;
      alerts.push({
        ...alert,
        name_snapshot: nameSnapshot,
      });
    }

    if (alerts.length > 0) {
      order.has_next_booking_alert = true;
      order.next_booking_alert_count = alerts.length;
      order.next_booking_alerts = alerts;
    }
  }
}
