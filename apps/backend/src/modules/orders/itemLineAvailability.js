import {
  ITEM_LINE_STATUS,
  ITEM_LINE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  normalizeProductStageFlagsFromParsed,
  parseStageFlagsJson,
  rentalDateRangeOverlaps,
  resolveItemLineWashingStatus,
  toLocalISODate,
  todayIndiaISODate,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { PRE_DELIVERY_ORDER_STATUSES } from '../../lib/rentalOverlap.js';

const DELIVERED_STATUSES = new Set(['delivered', 'partially_returned']);
const TERMINAL_ORDER_STATUSES = new Set(['cancelled', 'draft', 'returned', 'closed']);
const BLOCKING_ORDER_STATUSES = new Set([
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
  'delivered',
  'partially_returned',
]);
const PRE_DELIVERY_SET = new Set(PRE_DELIVERY_ORDER_STATUSES);

function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const s = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toLocalISODate(value);
  }
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function windowKey(productId, from, to) {
  return `${String(productId)}|${from}|${to}`;
}

function parseStageFlags(raw) {
  return normalizeProductStageFlagsFromParsed(parseStageFlagsJson(raw));
}

function lineStageKind(flags, orderStatus, row = null) {
  if (row?.damaged) return 'repair';
  if (row?.missing) return 'missing';
  if (flags.delivered || DELIVERED_STATUSES.has(String(orderStatus || ''))) return 'delivered';
  if (flags.prepared) return 'prepared';
  if (flags.item_to_collect) return 'collected';
  if (flags.received) return 'received';
  return 'pending';
}

function formatSiblingReason(kind, sibling) {
  const parts = [];
  if (kind === 'collected') parts.push('Item collected');
  else if (kind === 'prepared') parts.push('Prepared');
  else if (kind === 'delivered') parts.push('With customer');
  else if (kind === 'received') parts.push('Received — may be in washing');
  else if (kind === 'repair') parts.push('Repair hold');
  else if (kind === 'missing') parts.push('Missing');
  else parts.push('Booked');

  if (sibling.order_number) parts.push(String(sibling.order_number));
  if (sibling.customer_name) parts.push(String(sibling.customer_name));
  const statusLabel = ORDER_STATUS_LABELS[sibling.order_status] || sibling.order_status;
  if (statusLabel) parts.push(statusLabel);
  const pickup = toIsoDate(sibling.pickup_date);
  if (pickup) parts.push(`pickup ${pickup}`);
  const qty = Number(sibling.qty || 0);
  if (qty > 0) parts.push(`qty ${qty}`);
  return parts.join(' · ');
}

function todayIso() {
  return todayIndiaISODate();
}

function passesStalePreDeliveryRelease(status, returnDate, pickupDate) {
  const st = String(status || '');
  if (!PRE_DELIVERY_SET.has(st)) return true;
  const anchor = toIsoDate(returnDate) || toIsoDate(pickupDate);
  return !!anchor && anchor >= todayIso();
}

function rentalOverlaps(from, to, pickupDate, returnDate, nextGapDays, prevGapDays = 0) {
  return rentalDateRangeOverlaps(from, to, pickupDate, returnDate, nextGapDays, prevGapDays);
}

/** Batch-load availability snapshots for many product/date windows (list enrichment). */
async function loadAvailabilitySnapshotsBatch(shopId, uniqueWindows, db) {
  const map = new Map();
  if (!uniqueWindows?.size) return map;

  const productIds = [
    ...new Set([...uniqueWindows.values()].map((win) => String(win.product_id)).filter(Boolean)),
  ];
  if (!productIds.length) return map;

  let globalFrom = null;
  let globalTo = null;
  for (const win of uniqueWindows.values()) {
    if (!globalFrom || win.from < globalFrom) globalFrom = win.from;
    if (!globalTo || win.to > globalTo) globalTo = win.to;
  }
  if (!globalFrom || !globalTo) return map;

  const [products, conflictRows, washingQueueRows, laundryWashingRows] = await Promise.all([
    db('products as p')
      .where({ 'p.shop_id': shopId, 'p.is_active': true })
      .whereIn('p.id', productIds)
      .select('p.id', 'p.qty'),
    db('order_items as oi')
      .join('orders as o', 'o.id', 'oi.order_id')
      .leftJoin('customers as c', 'c.id', 'o.customer_id')
      .where('oi.shop_id', shopId)
      .whereIn('oi.product_id', productIds)
      .andWhere('o.is_deleted', false)
      .andWhere('oi.type', 'rent')
      .whereIn('o.status', [...BLOCKING_ORDER_STATUSES])
      .andWhereRaw(
        'DATE_SUB(o.pickup_date, INTERVAL COALESCE(o.previous_booking_gap_days, 0) DAY) <= ?',
        [globalTo]
      )
      .andWhereRaw(
        'DATE_ADD(COALESCE(o.return_date, o.pickup_date), INTERVAL COALESCE(o.next_booking_gap_days, 0) DAY) >= ?',
        [globalFrom]
      )
      .andWhere(function stalePreDeliveryFilter() {
        this.whereNotIn('o.status', PRE_DELIVERY_ORDER_STATUSES).orWhereRaw(
          'COALESCE(o.return_date, o.pickup_date) >= CURDATE()'
        );
      })
      .orderBy('o.pickup_date')
      .select(
        'oi.product_id',
        'o.id as order_id',
        'o.order_number',
        'o.status',
        'o.pickup_date',
        'o.return_date',
        'o.next_booking_gap_days',
        'o.previous_booking_gap_days',
        'oi.id as order_item_id',
        'oi.qty as booked_qty',
        'c.name as customer_name'
      ),
    db('washing_queue as wq')
      .leftJoin('orders as o', 'o.id', 'wq.order_id')
      .where({ 'wq.shop_id': shopId })
      .whereIn('wq.product_id', productIds)
      .orderBy('wq.queued_at', 'desc')
      .select(
        'wq.product_id',
        'wq.id',
        'wq.qty',
        'wq.order_id',
        'wq.order_item_id',
        'o.order_number'
      ),
    db('laundry_job_products as ljp')
      .join('laundry_jobs as lj', 'lj.id', 'ljp.laundry_job_id')
      .where({ 'ljp.shop_id': shopId, 'ljp.status': 'in_washing' })
      .whereIn('ljp.product_id', productIds)
      .orderBy('lj.laundry_date', 'desc')
      .select(
        'ljp.product_id',
        'ljp.id as line_id',
        'ljp.qty',
        'lj.id as laundry_job_id',
        'lj.job_no',
        'lj.laundry_date'
      ),
  ]);

  const qtyByProduct = new Map(
    products.map((p) => [String(p.id), Math.max(0, Number(p.qty || 0))])
  );
  const conflictsByProduct = new Map();
  for (const row of conflictRows) {
    const pid = String(row.product_id);
    if (!conflictsByProduct.has(pid)) conflictsByProduct.set(pid, []);
    conflictsByProduct.get(pid).push(row);
  }

  const washingQueueByProduct = new Map();
  for (const row of washingQueueRows) {
    const pid = String(row.product_id);
    if (!washingQueueByProduct.has(pid)) washingQueueByProduct.set(pid, []);
    washingQueueByProduct.get(pid).push({
      id: row.id,
      qty: Number(row.qty || 0),
      order_id: row.order_id || null,
      order_item_id: row.order_item_id || null,
      order_number: row.order_number || null,
    });
  }

  const laundryByProduct = new Map();
  for (const row of laundryWashingRows) {
    const pid = String(row.product_id);
    if (!laundryByProduct.has(pid)) laundryByProduct.set(pid, []);
    laundryByProduct.get(pid).push({
      line_id: row.line_id,
      qty: Number(row.qty || 0),
      laundry_job_id: row.laundry_job_id,
      job_no: row.job_no,
      laundry_date: row.laundry_date,
    });
  }

  for (const [key, win] of uniqueWindows.entries()) {
    const pid = String(win.product_id);
    const washing_queue = washingQueueByProduct.get(pid) || [];
    const laundry_washing = laundryByProduct.get(pid) || [];
    const washing_queue_qty = washing_queue.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const laundry_washing_qty = laundry_washing.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    const washing_qty = washing_queue_qty + laundry_washing_qty;
    const allConflicts = conflictsByProduct.get(pid) || [];
    const conflicts = allConflicts.filter(
      (row) =>
        passesStalePreDeliveryRelease(row.status, row.return_date, row.pickup_date) &&
        rentalOverlaps(
          win.from,
          win.to,
          row.pickup_date,
          row.return_date,
          row.next_booking_gap_days,
          row.previous_booking_gap_days
        )
    );

    map.set(key, {
      total_qty: qtyByProduct.get(pid) ?? 0,
      washing_qty,
      washing_queue_qty,
      laundry_washing_qty,
      conflicts,
      washing_queue,
      laundry_washing,
    });
  }

  return map;
}

/** All active rent lines for these products (for stage-based physical commitment). */
async function loadSiblingLinesByProduct(shopId, productIds, db) {
  const ids = [...new Set(productIds.map((id) => String(id)).filter(Boolean))];
  if (!ids.length) return new Map();

  const rows = await db('order_items as oi')
    .innerJoin('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oi.shop_id', shopId)
    .whereIn('oi.product_id', ids)
    .whereNotNull('oi.product_id')
    .andWhere('o.is_deleted', false)
    .whereNotIn('o.status', [...TERMINAL_ORDER_STATUSES])
    .andWhere('oi.type', 'rent')
    .select(
      'oi.id as order_item_id',
      'oi.order_id',
      'oi.product_id',
      'oi.qty',
      'oi.stage_flags',
      'oi.damaged',
      'oi.missing',
      'o.order_number',
      'o.status as order_status',
      'o.pickup_date',
      'o.return_date',
      'c.name as customer_name'
    );

  const byProduct = new Map();
  for (const row of rows) {
    const pid = String(row.product_id);
    if (!byProduct.has(pid)) byProduct.set(pid, []);
    byProduct.get(pid).push({
      ...row,
      qty: Math.max(1, Number(row.qty) || 1),
      flags: parseStageFlags(row.stage_flags),
      stage_kind: lineStageKind(parseStageFlags(row.stage_flags), row.order_status, row),
    });
  }
  return byProduct;
}

function buildWashingReasons(snap) {
  const reasons = [];
  for (const row of snap.washing_queue || []) {
    const qty = Number(row.qty || 0);
    const bits = [ITEM_LINE_STATUS_LABELS.washing_queue];
    if (qty > 0) bits.push(`qty ${qty}`);
    if (row.order_number) bits.push(String(row.order_number));
    reasons.push(bits.join(' · '));
  }
  for (const row of snap.laundry_washing || []) {
    const qty = Number(row.qty || 0);
    const bits = [ITEM_LINE_STATUS_LABELS.in_washing];
    if (row.job_no) bits.push(`laundry ${row.job_no}`);
    else if (row.laundry_job_id) bits.push('laundry job');
    if (qty > 0) bits.push(`qty ${qty}`);
    reasons.push(bits.join(' · '));
  }
  return reasons;
}

function resolveWashingItemStatus(snap) {
  return resolveItemLineWashingStatus({
    washingQueueQty: snap.washing_queue_qty,
    laundryWashingQty: snap.laundry_washing_qty,
  });
}

/**
 * Among pending (not collected) lines, earliest pickup_date gets available slots.
 * @returns {{ blockedQty: number, earlierSibling: object|null }}
 */
function pendingQueueBlockedQty(row, siblings, totalQty, washingQty, committedQty) {
  const lineId = String(row.id || '');
  const myPickup = toIsoDate(row.pickup_date) || '9999-12-31';
  const lineQty = Math.max(1, Number(row.qty) || 1);

  const pendingLines = [
    { id: lineId, pickup: myPickup, qty: lineQty, sibling: null },
    ...(siblings || [])
      .filter((s) => s.stage_kind === 'pending')
      .map((s) => ({
        id: String(s.order_item_id),
        pickup: toIsoDate(s.pickup_date) || '9999-12-31',
        qty: s.qty,
        sibling: s,
      })),
  ].sort((a, b) => {
    if (a.pickup !== b.pickup) return a.pickup.localeCompare(b.pickup);
    return a.id.localeCompare(b.id);
  });

  let slots = Math.max(0, totalQty - washingQty - committedQty);
  let earlierSibling = null;
  for (const p of pendingLines) {
    if (p.id === lineId) {
      if (slots >= lineQty) return { blockedQty: 0, earlierSibling: null };
      return { blockedQty: lineQty, earlierSibling };
    }
    if (!earlierSibling && p.sibling) earlierSibling = p.sibling;
    slots = Math.max(0, slots - p.qty);
  }
  return { blockedQty: 0, earlierSibling: null };
}

function isLaterPendingPeerConflict(conflict, rowPickup, siblingByItemId) {
  const itemKey = String(conflict.order_item_id || '');
  if (!itemKey || !rowPickup) return false;
  const peer = siblingByItemId.get(itemKey);
  if (!peer || peer.stage_kind !== 'pending') return false;
  const conflictPickup = toIsoDate(conflict.pickup_date);
  return !!conflictPickup && conflictPickup > rowPickup;
}

function resolveLineAvailability(row, snap, siblings) {
  const lineId = String(row.id || '');
  const orderId = String(row.order_id || '');
  const lineQty = Math.max(1, Number(row.qty) || 1);
  const totalQty = Number(snap.total_qty || 0);
  const washingQty = Number(snap.washing_qty || 0);

  const otherSiblings = (siblings || []).filter((s) => String(s.order_item_id) !== lineId);
  const siblingByItemId = new Map((siblings || []).map((s) => [String(s.order_item_id), s]));
  const myPickup = toIsoDate(row.pickup_date) || '';

  let committedQty = 0;
  let hasCollectedElsewhere = false;
  let hasPreparedElsewhere = false;
  let hasDeliveredElsewhere = false;
  const committedItemIds = new Set();
  const item_status_reasons = [...buildWashingReasons(snap)];

  for (const s of otherSiblings) {
    const kind = s.stage_kind;
    if (kind === 'pending') continue;

    committedQty += s.qty;
    committedItemIds.add(String(s.order_item_id));
    item_status_reasons.push(formatSiblingReason(kind, s));

    if (kind === 'collected') hasCollectedElsewhere = true;
    if (kind === 'prepared') hasPreparedElsewhere = true;
    if (kind === 'delivered') hasDeliveredElsewhere = true;
  }

  const others = (snap.conflicts || []).filter((c) => String(c.order_id) !== orderId);
  let overlapPendingQty = 0;
  for (const c of others) {
    const itemKey = String(c.order_item_id || '');
    if (itemKey && committedItemIds.has(itemKey)) continue;
    if (isLaterPendingPeerConflict(c, myPickup, siblingByItemId)) continue;

    overlapPendingQty += Number(c.booked_qty || 0);
    if (DELIVERED_STATUSES.has(String(c.status || ''))) {
      item_status_reasons.push(
        formatSiblingReason('delivered', {
          order_number: c.order_number,
          customer_name: c.customer_name,
          order_status: c.status,
          pickup_date: c.pickup_date,
          qty: c.booked_qty,
        })
      );
    } else {
      const parts = ['Booked'];
      if (c.order_number) parts.push(String(c.order_number));
      if (c.customer_name) parts.push(String(c.customer_name));
      const statusLabel = ORDER_STATUS_LABELS[c.status] || c.status;
      if (statusLabel) parts.push(statusLabel);
      const d = toIsoDate(c.pickup_date);
      if (d) parts.push(`pickup ${d}`);
      const qty = Number(c.booked_qty || 0);
      if (qty > 0) parts.push(`qty ${qty}`);
      item_status_reasons.push(parts.join(' · '));
    }
  }

  const { blockedQty: queueBlockedQty, earlierSibling } = pendingQueueBlockedQty(
    row,
    siblings,
    totalQty,
    washingQty,
    committedQty
  );
  if (queueBlockedQty > 0 && earlierSibling) {
    item_status_reasons.push(formatSiblingReason('pending', earlierSibling));
  }

  const blockedQty = washingQty + committedQty + overlapPendingQty + queueBlockedQty;
  const canServeLine = totalQty - blockedQty >= lineQty;

  const hasOverlapBooking = overlapPendingQty > 0 || queueBlockedQty > 0;
  const washingStatus = washingQty > 0 ? resolveWashingItemStatus(snap) : null;

  let item_status = ITEM_LINE_STATUS.AVAILABLE;
  let item_status_label = ITEM_LINE_STATUS_LABELS.available;
  if (!canServeLine) {
    if (washingStatus && blockedQty >= totalQty) {
      item_status = washingStatus.item_status;
      item_status_label = washingStatus.item_status_label;
    } else if (
      hasDeliveredElsewhere ||
      others.some((c) => DELIVERED_STATUSES.has(String(c.status || '')))
    ) {
      item_status = ITEM_LINE_STATUS.WITH_CUSTOMER;
      item_status_label = ITEM_LINE_STATUS_LABELS.with_customer;
    } else if (hasCollectedElsewhere) {
      item_status = ITEM_LINE_STATUS.COLLECTED_ELSEWHERE;
      item_status_label = ITEM_LINE_STATUS_LABELS.collected_elsewhere;
    } else if (hasPreparedElsewhere) {
      item_status = ITEM_LINE_STATUS.PREPARED_ELSEWHERE;
      item_status_label = ITEM_LINE_STATUS_LABELS.prepared_elsewhere;
    } else if (hasOverlapBooking) {
      item_status = ITEM_LINE_STATUS.BOOKED_ELSEWHERE;
      item_status_label = ITEM_LINE_STATUS_LABELS.booked_elsewhere;
    } else if (washingStatus) {
      item_status = washingStatus.item_status;
      item_status_label = washingStatus.item_status_label;
    } else {
      item_status = ITEM_LINE_STATUS.NOT_AVAILABLE;
      item_status_label = ITEM_LINE_STATUS_LABELS.not_available;
    }
  } else if (washingStatus) {
    item_status = washingStatus.item_status;
    item_status_label = washingStatus.item_status_label;
  }

  const uniqueReasons = [...new Set(item_status_reasons.filter(Boolean))];
  if (item_status === ITEM_LINE_STATUS.AVAILABLE && uniqueReasons.length === 0) {
    uniqueReasons.push('Available for this booking');
  }

  return {
    item_status,
    item_available: canServeLine,
    item_status_label,
    item_status_reasons: uniqueReasons,
  };
}

/**
 * Attach per-line product availability for item stage list rows.
 * @param {string} shopId
 * @param {object[]} rows
 */
export async function attachItemLineAvailability(shopId, rows, db = knex) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];

  const [siblingsByProduct, snapByKey] = await Promise.all([
    loadSiblingLinesByProduct(shopId, productIds, db),
    (async () => {
      const uniqueWindows = new Map();
      for (const row of rows) {
        const productId = row.product_id;
        if (!productId) continue;
        const from = toIsoDate(row.pickup_date);
        const to = toIsoDate(row.return_date) || from;
        if (!from || !to) continue;
        const key = windowKey(productId, from, to);
        if (!uniqueWindows.has(key)) {
          uniqueWindows.set(key, { product_id: productId, from, to });
        }
      }
      return loadAvailabilitySnapshotsBatch(shopId, uniqueWindows, db);
    })(),
  ]);

  for (const row of rows) {
    const productId = row.product_id;
    if (!productId) {
      row.item_status = ITEM_LINE_STATUS.NOT_AVAILABLE;
      row.item_available = false;
      row.item_status_label = ITEM_LINE_STATUS_LABELS.not_available;
      row.item_status_reasons = ['Product not linked'];
      continue;
    }

    const from = toIsoDate(row.pickup_date);
    const to = toIsoDate(row.return_date) || from;
    if (!from || !to) {
      row.item_status = ITEM_LINE_STATUS.NOT_AVAILABLE;
      row.item_available = false;
      row.item_status_label = ITEM_LINE_STATUS_LABELS.not_available;
      row.item_status_reasons = ['Missing delivery dates'];
      continue;
    }

    const key = windowKey(productId, from, to);
    const snap = snapByKey.get(key);
    if (!snap) {
      row.item_status = ITEM_LINE_STATUS.NOT_AVAILABLE;
      row.item_available = false;
      row.item_status_label = ITEM_LINE_STATUS_LABELS.not_available;
      row.item_status_reasons = ['Could not check availability'];
      continue;
    }

    const siblings = siblingsByProduct.get(String(productId)) || [];
    Object.assign(row, resolveLineAvailability(row, snap, siblings));
  }
}

/** @internal Exported for unit tests. */
export { resolveLineAvailability };
