import { assertNoIssuedGstInvoice } from '../../lib/gstInvoiceLock.js';
import {
  BOOKED_PRODUCT_STATUS_BUCKETS,
  ITEM_LINE_STATUS,
  ORDER_STATUS,
  buildOrderNumber,
  collectIndianPhones,
  DEFAULT_ACCESSORY_STAGE_FLAGS,
  DEFAULT_PRODUCT_STAGE_FLAGS,
  formatAccessoryQtyExceededMessage,
  accessoryRentableQty,
  normalizeAccessoryStageFlagsFromParsed,
  normalizeBookingTime,
  normalizeOrderNumberFormat,
  normalizeOrderNumberPrefix,
  normalizeProductStageFlagsFromParsed,
  normalizeTime12,
  parseStageFlagsJson,
  round2,
  syncAccessoryStageFlagsForGivenStatusChange,
  getIndiaDateTimeParts,
  toLocalISODate,
  today as todayDate,
  orderChecklistCommandSchema,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { verifyShopAdminPassword } from '../../utils/shopAdmin.js';
import { paginate } from '../../utils/pagination.js';
import {
  applyCreditsFromPhones,
  getAdvanceNetPaid,
  getOpenCreditBalanceByPhones,
  getSecurityHeld,
  issueCreditNoteOnCancel,
} from '../credit-notes/helpers.js';
import { recomputeOrderPayment } from '../payments/recomputeOrderPayment.js';
import { insertOrderPayment } from '../payments/orderStatusAtPayment.js';
import { applyBookingEditPaymentsWithTrx, getOrdinarySecurityNet } from '../payments/bookingEditSettlement.js';
import { assertLedgerRefs } from '../payments/ledgerRefs.js';
import { syncChecklistSecurityCharge, syncCombinedChecklistSecurityCharge } from '../security-charges/service.js';
import { createOrUpdateConditionAssessmentWithTrx, fundConditionChargeWithTrx, assertNoHeldConditionFundsForDeletion } from '../security-charges/ledgerService.js';
import { assertSettlementReplay } from './settlementCommand.js';
import { lockOrderInventory } from './orderInventoryLock.js';
import { assertDeliveryLineVersion } from './stageLineVersion.js';
import { readChecklistStateToken, attachChecklistStateTokens } from './checklistState.js';
import { recordDamagedProductReplacements, syncReplacementRequirementsForOrder, assertOrderItemReplacementAllowed, listOrderReplacementRequirements } from '../order-replacements/service.js';
import { shouldQueueAccessoryForWashing } from '../washing-queue/rules.js';
import {
  assertRentAccessoryLinesAvailable,
  assertSellAccessoryLinesAvailable,
  checkAccessoryAvailability,
} from '../accessories/service.js';
import {
  assertReconcileProductsNotSold,
  assertRentProductLinesAvailable,
  assertSellProductLinesAvailable,
} from '../products/service.js';
import { attachLineAccessoriesDetail } from './attachLineAccessoriesDetail.js';
import { attachLineAccessoryRemarks } from './attachLineAccessoryRemarks.js';
import { attachOrderExtraAccessories } from './attachOrderExtraAccessories.js';
import { applyDamagedAccessoryHoldDelta } from './damagedAccessoryHold.js';
import { attachItemLineAvailability } from './itemLineAvailability.js';
import {
  requestedAccessoryConditionQuantity,
  accessoryWashableReturnQuantity,
  hasBlockingProductCondition,
  lineBlocksReceivedByMissingQuantity,
} from './returnConditionRules.js';
import {
  attachNextBookingAlerts,
  attachNextBookingAlertSummaryToOrders,
} from './nextBookingAlerts.js';
import { normalizeOrderAvailabilityWindow } from './orderAvailabilityWindow.js';

function orderTransaction(callback) {
  return knex.transaction(callback, { isolationLevel: 'read committed' });
}

/** Attach custom orders that were converted/linked to each booking row. */
async function attachLinkedCustomOrders(shopId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const orderIds = [...new Set(rows.map((r) => r.id).filter(Boolean))];
  if (!orderIds.length) return;

  const links = await knex('custom_orders')
    .where({ shop_id: shopId })
    .whereIn('linked_order_id', orderIds)
    .select('id', 'order_number', 'linked_order_id')
    .orderBy('order_number');

  const byOrder = new Map();
  for (const link of links) {
    const oid = String(link.linked_order_id);
    if (!byOrder.has(oid)) byOrder.set(oid, []);
    byOrder.get(oid).push({ id: link.id, order_number: link.order_number });
  }

  for (const row of rows) {
    const linked = byOrder.get(String(row.id)) || [];
    row.linked_custom_orders = linked;
    row.linked_custom_order_id = linked[0]?.id ?? null;
    row.linked_custom_order_number = linked[0]?.order_number ?? null;
  }
}

/** Attach the edit-count badge for a page of bookings with one grouped query. */
async function attachAuditSummaryToOrders(shopId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const orderIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];
  if (!orderIds.length) return;

  const summaries = await knex('system_logs')
    .where({ shop_id: shopId, module: 'booking' })
    .whereIn('entity_id', orderIds)
    .groupBy('entity_id')
    .select('entity_id')
    .max({ change_count: 'change_count' });

  const countByOrder = new Map(
    summaries.map((row) => [String(row.entity_id), Math.max(0, Number(row.change_count || 0) - 1)])
  );

  for (const row of rows) {
    row.audit_edit_count = countByOrder.get(String(row.id)) || 0;
  }
}

const DEFAULT_STAGE_FLAGS = DEFAULT_PRODUCT_STAGE_FLAGS;

const ACCESSORY_STAGE_FIELDS = new Set(['prepared', 'delivered', 'received']);

/** Matches normalizeStageFlags item_to_collect (incl. legacy pre_check). */
function sqlItemLineCollected(prefix = 'oi') {
  return `(
    ${prefix}.sf_item_to_collect = 1
    OR ${prefix}.sf_pre_check = 1
  )`;
}

function sqlItemLineNotCollected(prefix = 'oi') {
  return `(
    ${prefix}.sf_item_to_collect = 0
    AND ${prefix}.sf_pre_check = 0
  )`;
}

function sqlItemLinePendingPrepare(prefix = 'oi') {
  return `(
    ${prefix}.sf_prepared = 0
    AND ${prefix}.sf_delivered = 0
    AND ${prefix}.sf_received = 0
  )`;
}

function sqlAccessoryLinePendingPrepare(prefix = 'oa') {
  return `(
    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${prefix}.stage_flags, '$.prepared')), 'false') NOT IN ('true', '1')
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${prefix}.stage_flags, '$.delivered')), 'false') NOT IN ('true', '1')
    AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${prefix}.stage_flags, '$.received')), 'false') NOT IN ('true', '1')
  )`;
}

/** Prepare Item list: booked (partial collect) or fully collected (item_to_collect). */
const ITEM_TO_PREPARE_ORDER_STATUSES = [ORDER_STATUS.BOOKED, ORDER_STATUS.ITEM_TO_COLLECT];

/** Prepare accepts partially collected product bookings and accessory-only bookings. */
function applyItemToPrepareEligibleOrderGate(qb, shopId, orderIdColumn = 'o.id') {
  return qb.andWhere(function eligiblePrepareOrder() {
    this.whereExists(function hasCollectedProduct() {
      this.select(knex.raw('1'))
        .from('order_items as oi_eligible')
        .where('oi_eligible.shop_id', shopId)
        .whereRaw(`oi_eligible.order_id = ${orderIdColumn}`)
        .whereRaw(sqlItemLineCollected('oi_eligible'));
    }).orWhereNotExists(function hasNoProductLines() {
      this.select(knex.raw('1'))
        .from('order_items as oi_any')
        .where('oi_any.shop_id', shopId)
        .whereRaw(`oi_any.order_id = ${orderIdColumn}`);
    });
  });
}

function applyOrderSalesPersonFilter(qb, query, column = 'o.sales_person_id') {
  const ids = query.sales_person_ids;
  if (!Array.isArray(ids) || !ids.length) return;

  const wantUnassigned = ids.includes('none');
  const personIds = ids.filter((id) => id !== 'none');
  if (wantUnassigned && !personIds.length) {
    qb.whereNull(column);
  } else if (!wantUnassigned && personIds.length) {
    qb.whereIn(column, personIds);
  } else {
    qb.andWhere(function selectedOrderSalesPeople() {
      this.whereNull(column).orWhereIn(column, personIds);
    });
  }
}

function buildAccessoriesToPrepareListQb(shopId, query, opts = {}) {
  const activeStatuses = opts.statuses ?? ITEM_TO_PREPARE_ORDER_STATUSES;
  const qb = knex('order_accessories as oa')
    .innerJoin('orders as o', 'o.id', 'oa.order_id')
    .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
    .leftJoin('categories as acc_cat', 'acc_cat.id', 'a.category_id')
    .where({ 'oa.shop_id': shopId, 'o.is_deleted': false })
    .whereIn('o.status', activeStatuses);

  if (!opts.skipPendingPrepareFilter) qb.whereRaw(sqlAccessoryLinePendingPrepare());

  // Item-to-collect does not apply to accessories. The product-category filter
  // also intentionally excludes accessory-only rows because the UI supplies
  // product categories in this report.
  if (String(query.collect_status || '').toLowerCase() === 'pending' || query.category_id) {
    qb.whereRaw('1 = 0');
  }

  const pickupFrom = String(query.pickup_from || query.from || '')
    .trim()
    .slice(0, 10);
  const pickupTo = String(query.pickup_to || query.to || '')
    .trim()
    .slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(pickupFrom)) qb.andWhere('o.pickup_date', '>=', pickupFrom);
  if (/^\d{4}-\d{2}-\d{2}$/.test(pickupTo)) qb.andWhere('o.pickup_date', '<=', pickupTo);
  applyOrderSalesPersonFilter(qb, query);
  return qb;
}

/** Pending-prepare lines grouped by booking (shared by list + count). */
function buildItemsToPrepareBookingAggSub(shopId, query) {
  const productLineSub = buildItemsToPrepareListQb(shopId, query, {
    statuses: ITEM_TO_PREPARE_ORDER_STATUSES,
  }).select(knex.raw("CONCAT('item:', oi.id) as line_id"), 'oi.order_id', 'oi.qty');

  const accessoryLineSub = buildAccessoriesToPrepareListQb(shopId, query, {
    statuses: ITEM_TO_PREPARE_ORDER_STATUSES,
  }).select(knex.raw("CONCAT('accessory:', oa.id) as line_id"), 'oa.order_id', 'oa.qty');

  const lineSub = knex.unionAll([productLineSub, accessoryLineSub], true);

  return knex
    .from(lineSub.as('pending_lines'))
    .groupBy('pending_lines.order_id')
    .select(
      'pending_lines.order_id',
      knex.raw('COUNT(pending_lines.line_id) as pending_prepare_lines'),
      knex.raw('COALESCE(SUM(pending_lines.qty), 0) as pending_prepare_qty'),
      knex.raw(
        'GROUP_CONCAT(pending_lines.line_id ORDER BY pending_lines.line_id) as pending_item_ids'
      )
    );
}

function applyItemStageListSalesPersonJoins(qb) {
  return qb
    .leftJoin('users as sp_line', 'sp_line.id', 'oi.sales_person_id')
    .leftJoin('users as sp_order', 'sp_order.id', 'o.sales_person_id');
}

function applyItemStageListSalesPersonFilter(qb, query) {
  const ids = query.sales_person_ids;
  if (!Array.isArray(ids) || !ids.length) return;

  const wantUnassigned = ids.includes('none');
  const personIds = ids.filter((id) => id !== 'none');
  const coalesceExpr = 'COALESCE(oi.sales_person_id, o.sales_person_id)';

  if (wantUnassigned && !personIds.length) {
    qb.whereNull(knex.raw(coalesceExpr));
    return;
  }
  if (!wantUnassigned && personIds.length) {
    qb.whereIn(knex.raw(coalesceExpr), personIds);
    return;
  }

  qb.andWhere(function applySalesPersonOrUnassigned() {
    this.whereNull(knex.raw(coalesceExpr));
    if (personIds.length) {
      this.orWhereIn(knex.raw(coalesceExpr), personIds);
    }
  });
}

const ITEM_STAGE_LIST_SEARCH_FIELDS = [
  'o.order_number',
  'o.reference_name',
  'o.pickup_name',
  'o.pickup_number',
  'o.contact_phone1',
  'c.name',
  'c.phone1',
  'c.phone2',
  'c.whatsapp',
  'c.address',
  'oi.name_snapshot',
  'oi.code_snapshot',
  'p.code',
  'sp_line.name',
  'sp_order.name',
];

const ITEM_TO_COLLECT_BOOKING_SEARCH_FIELDS = [
  'o.order_number',
  'o.reference_name',
  'o.pickup_name',
  'o.pickup_number',
  'o.contact_phone1',
  'c.name',
  'c.phone1',
  'c.phone2',
  'c.whatsapp',
  'c.address',
  'sp_order.name',
];

function applyItemStageBookingSearch(qb, search) {
  const term = String(search || '').trim();
  if (!term) return;
  const like = `%${term}%`;
  qb.andWhere((scope) => {
    for (const field of ITEM_TO_COLLECT_BOOKING_SEARCH_FIELDS) {
      scope.orWhere(field, 'like', like);
    }
    scope.orWhereExists(function orderWideProductSearch() {
      this.select(knex.raw('1'))
        .from('order_items as oi_search')
        .leftJoin('products as p_search', 'p_search.id', 'oi_search.product_id')
        .whereRaw('oi_search.order_id = o.id')
        .where((productScope) => {
          productScope
            .where('oi_search.name_snapshot', 'like', like)
            .orWhere('oi_search.code_snapshot', 'like', like)
            .orWhere('p_search.name', 'like', like)
            .orWhere('p_search.code', 'like', like);
        });
    });
    scope.orWhereExists(function orderWideAccessorySearch() {
      this.select(knex.raw('1'))
        .from('order_accessories as oa_search')
        .leftJoin('accessories as a_search', 'a_search.id', 'oa_search.accessory_id')
        .leftJoin('categories as ac_search', 'ac_search.id', 'a_search.category_id')
        .whereRaw('oa_search.order_id = o.id')
        .where((accessoryScope) => {
          accessoryScope
            .where('oa_search.name_snapshot', 'like', like)
            .orWhere('a_search.name', 'like', like)
            .orWhere('a_search.code', 'like', like)
            .orWhere('ac_search.label', 'like', like);
        });
    });
  });
}

function resolveBookingTime(value) {
  const normalized = nullIfEmpty(normalizeBookingTime(value));
  if (normalized) return normalized;
  const parts = getIndiaDateTimeParts(new Date());
  if (!parts) return null;
  return normalizeBookingTime(`${parts.hour}:${parts.minute}`) || null;
}

async function syncWashingQueue(trx, shopId, orderId, itemId, received) {
  if (received) {
    const item = await trx('order_items')
      .where({ id: itemId, order_id: orderId, shop_id: shopId })
      .first('product_id', 'name_snapshot', 'code_snapshot', 'qty', 'type', 'damaged', 'missing');
    if (item?.damaged || item?.missing) {
      await trx('washing_queue').where({ shop_id: shopId, order_item_id: itemId }).del();
      return;
    }
    if (!item || item.type !== 'rent' || !item.product_id) return;
    const exists = await trx('washing_queue')
      .where({ shop_id: shopId, order_item_id: itemId })
      .first('id');
    if (exists) return;
    const product = await trx('products')
      .where({ id: item.product_id })
      .first('main_image', 'category_id');
    await trx('washing_queue').insert({
      id: uuid(),
      shop_id: shopId,
      item_kind: 'product',
      product_id: item.product_id,
      accessory_id: null,
      order_id: orderId,
      order_item_id: itemId,
      order_accessory_id: null,
      product_code: item.code_snapshot || null,
      product_name: item.name_snapshot || null,
      image_url: product?.main_image || null,
      category_id: product?.category_id || null,
      qty: Number(item.qty || 1),
      queued_at: trx.fn.now(),
    });
  } else {
    await trx('washing_queue').where({ shop_id: shopId, order_item_id: itemId }).del();
  }
}

async function syncAccessoryWashingQueue(trx, shopId, orderId, orderAccessoryId, received) {
  if (received) {
    const item = await trx('order_accessories')
      .where({ id: orderAccessoryId, order_id: orderId, shop_id: shopId })
      .first(
        'accessory_id',
        'name_snapshot',
        'qty',
        'type',
        'damaged',
        'missing',
        'damaged_qty',
        'missing_qty'
      );
    const washableQty = accessoryWashableReturnQuantity(item);
    if (washableQty <= 0) {
      await trx('washing_queue')
        .where({ shop_id: shopId, order_accessory_id: orderAccessoryId })
        .del();
      return;
    }
    if (!item || item.type !== 'rent' || !item.accessory_id) return;
    const accessory = await trx('accessories as a')
      .leftJoin('categories as c', 'c.id', 'a.category_id')
      .where({ 'a.id': item.accessory_id, 'a.shop_id': shopId })
      .first('a.id', 'a.image_url', 'a.category_id', 'c.is_washable');
    if (!shouldQueueAccessoryForWashing(accessory)) {
      await trx('washing_queue')
        .where({ shop_id: shopId, order_accessory_id: orderAccessoryId })
        .del();
      return;
    }
    const exists = await trx('washing_queue')
      .where({ shop_id: shopId, order_accessory_id: orderAccessoryId })
      .first('id');
    const queueRow = {
      id: uuid(),
      shop_id: shopId,
      item_kind: 'accessory',
      product_id: null,
      accessory_id: item.accessory_id,
      order_id: orderId,
      order_item_id: null,
      order_accessory_id: orderAccessoryId,
      product_code: null,
      product_name: item.name_snapshot || null,
      image_url: accessory?.image_url || null,
      category_id: accessory?.category_id || null,
      qty: washableQty,
      queued_at: trx.fn.now(),
    };
    if (exists) {
      delete queueRow.id;
      delete queueRow.queued_at;
      await trx('washing_queue').where({ id: exists.id, shop_id: shopId }).update(queueRow);
    } else {
      await trx('washing_queue').insert(queueRow);
    }
  } else {
    await trx('washing_queue')
      .where({ shop_id: shopId, order_accessory_id: orderAccessoryId })
      .del();
  }
}

async function assertProductLineCanEnableStage(trx, shopId, orderId, row, currentFlags, field) {
  if (field === 'delivered') await assertOrderItemReplacementAllowed(trx, shopId, orderId, row);
  if (currentFlags?.[field]) return;
  if (String(row?.type || 'rent') === 'sell') return;
  if (!row?.product_id) return;

  const order = await trx('orders')
    .where({ id: orderId, shop_id: shopId })
    .first('pickup_date', 'return_date');
  if (!order) throw notFound('Order not found');

  const line = {
    id: row.id,
    order_id: orderId,
    product_id: row.product_id,
    pickup_date: order.pickup_date,
    return_date: order.return_date,
    qty: row.qty,
  };
  await attachItemLineAvailability(shopId, [line], trx);
  if (line.item_status !== ITEM_LINE_STATUS.AVAILABLE || line.item_available === false) {
    const label = String(line.item_status_label || 'NOT AVAILABLE').trim();
    const stageLabel =
      field === 'item_to_collect'
        ? 'Item to collect'
        : field === 'prepared'
          ? 'Prepared'
          : 'Delivered';
    throw badRequest(`Cannot mark ${stageLabel} — product is ${label}`);
  }
}

async function assertAccessoryLineCanEnableStage(trx, shopId, orderId, row, currentFlags, field) {
  if (currentFlags?.[field]) return;
  if (String(row?.type || 'rent') === 'sell') return;
  if (!row?.accessory_id) return;

  const order = await trx('orders')
    .where({ id: orderId, shop_id: shopId })
    .first('pickup_date', 'return_date');
  if (!order) throw notFound('Order not found');

  const availabilityWindow = normalizeOrderAvailabilityWindow(order);
  if (!availabilityWindow) {
    throw badRequest('Order pickup and return dates must be valid before updating stages');
  }

  const availability = await checkAccessoryAvailability(shopId, {
    accessory_id: row.accessory_id,
    from: availabilityWindow.from,
    to: availabilityWindow.to,
    qty: Math.max(1, Number(row.qty) || 1),
    exclude_order_id: orderId,
  });
  if (!availability.available) {
    const stageLabel = field === 'prepared' ? 'Prepared' : 'Delivered';
    throw badRequest(`Cannot mark ${stageLabel} — accessory is NOT AVAILABLE`);
  }
}

const ORDER_EDIT_LOCKED_STATUSES = new Set([
  'cancelled',
  'delivered',
  'partially_returned',
  'returned',
  'closed',
]);

/** Delivered orders may be edited after Shop Admin password verification. */
const ORDER_EDIT_ADMIN_UNLOCK_STATUSES = new Set(['delivered']);

const ALLOWED_ORDER_TYPES = new Set(['rent', 'sell', 'mixed', 'trial', 'accessory_only']);

/** Order list: sum of all product line qty. */
const LIST_ORDER_PRODUCT_QTY_SQL =
  '(COALESCE((SELECT SUM(qty) FROM order_items WHERE order_items.order_id = o.id), 0)) AS product_qty';

/** Order list: all accessory line qty (linked + standalone; matches checklist). */
const LIST_ORDER_ACCESSORY_QTY_SQL =
  '(COALESCE((SELECT SUM(qty) FROM order_accessories WHERE order_accessories.order_id = o.id), 0)) AS accessory_qty';

const ORDER_LIST_SEARCH_FIELDS = [
  'o.order_number',
  'o.reference_name',
  'o.pickup_name',
  'o.pickup_number',
  'o.contact_phone1',
  'c.name',
  'c.phone1',
  'c.phone2',
  'c.whatsapp',
  'c.address',
];

/** @param {import('knex').Knex.QueryBuilder} qb @param {string} search */
function applyOrderListSearch(qb, search) {
  const term = String(search || '').trim();
  if (!term) return;
  const like = `%${term}%`;
  qb.where((b) => {
    for (const f of ORDER_LIST_SEARCH_FIELDS) {
      b.orWhere(f, 'like', like);
    }
    b.orWhereExists(function existsProductSearch() {
      this.select(knex.raw('1'))
        .from('order_items as oi_search')
        .leftJoin('products as p_search', 'p_search.id', 'oi_search.product_id')
        .whereRaw('oi_search.order_id = o.id')
        .where((w) => {
          w.where('oi_search.name_snapshot', 'like', like)
            .orWhere('oi_search.code_snapshot', 'like', like)
            .orWhere('p_search.name', 'like', like)
            .orWhere('p_search.code', 'like', like);
        });
    });
  });
}

export async function listOrders(shopId, query) {
  const qb = knex('orders as o')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false });
  if (query.status) qb.andWhere({ 'o.status': query.status });
  if (query.statuses) {
    const statuses = Array.isArray(query.statuses)
      ? query.statuses
      : String(query.statuses).split(',');
    qb.whereIn('o.status', statuses.filter(Boolean));
  }
  if (query.customer_id) qb.andWhere({ 'o.customer_id': query.customer_id });

  const orderTypesRaw = query.order_types != null ? String(query.order_types) : '';
  const orderTypes = orderTypesRaw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => ALLOWED_ORDER_TYPES.has(t));
  if (orderTypes.length) {
    qb.whereIn('o.order_type', orderTypes);
  } else if (query.order_type) {
    qb.andWhere({ 'o.order_type': query.order_type });
  }

  if (query.pending_bills === '1' || query.pending_bills === 1 || query.pending_bills === true) {
    qb.andWhere('o.balance', '>', 0).whereNot({ 'o.status': 'cancelled' });
  }

  let dateCol = 'o.pickup_date';
  if (query.date_field === 'return_date') dateCol = 'o.return_date';
  else if (query.date_field === 'booking_date') dateCol = 'o.booking_date';
  else if (query.date_field === 'created_at') dateCol = 'o.created_at';

  if (query.from) qb.andWhere(dateCol, '>=', query.from);
  if (query.to) qb.andWhere(dateCol, '<=', query.to);
  if (query.pickup_from) qb.andWhere('o.pickup_date', '>=', query.pickup_from);
  if (query.pickup_to) qb.andWhere('o.pickup_date', '<=', query.pickup_to);
  if (query.return_from) qb.andWhere('o.return_date', '>=', query.return_from);
  if (query.return_to) qb.andWhere('o.return_date', '<=', query.return_to);

  // Bucket helpers for Delivery / Return screens (local calendar day, matches dashboard KPIs).
  const todayStart = todayDate();
  const todayIso = toLocalISODate(todayStart);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekEndStart = new Date(todayStart);
  weekEndStart.setDate(weekEndStart.getDate() + 7);
  const tomorrowIso = toLocalISODate(tomorrowStart);
  const weekEndIso = toLocalISODate(weekEndStart);

  if (query.bucket === 'today') qb.whereBetween(dateCol, [todayIso, todayIso]);
  else if (query.bucket === 'upcoming') qb.whereBetween(dateCol, [tomorrowIso, weekEndIso]);
  else if (query.bucket === 'overdue') qb.andWhere(dateCol, '<', todayIso);

  const lean =
    query.lean === '1' || query.lean === 1 || query.lean === true || query.lean === 'true';

  qb.select(
    'o.*',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.whatsapp as customer_whatsapp',
    'c.address as customer_address'
  );

  if (lean) {
    qb.select(
      knex.raw(
        'GREATEST(0, COALESCE(o.subtotal, 0) - COALESCE(o.discount_total, 0)) AS rent_total'
      ),
      knex.raw(LIST_ORDER_PRODUCT_QTY_SQL),
      knex.raw(LIST_ORDER_ACCESSORY_QTY_SQL),
      knex.raw(
        `(SELECT MAX(oi.received_at) FROM order_items oi WHERE oi.order_id = o.id) AS items_received_at`
      )
    );
  } else {
    qb.select(
      knex.raw(
        `(SELECT p.notes
        FROM payments p
        WHERE p.order_id = o.id
          AND p.is_deleted = 0
          AND p.notes IS NOT NULL
          AND TRIM(p.notes) <> ''
          AND p.category IN ('deposit','partial','final')
        ORDER BY p.payment_date DESC, p.created_at DESC
        LIMIT 1) AS delivery_remark`
      ),
      knex.raw(
        `(SELECT p.notes
        FROM payments p
        WHERE p.order_id = o.id
          AND p.is_deleted = 0
          AND p.notes IS NOT NULL
          AND TRIM(p.notes) <> ''
          AND p.category IN ('deposit_refund','partial','final')
        ORDER BY p.payment_date DESC, p.created_at DESC
        LIMIT 1) AS return_remark`
      ),
      knex.raw(
        `(COALESCE((SELECT SUM(line_total) FROM order_items WHERE order_items.order_id = o.id AND order_items.type = 'rent'), 0) +
        COALESCE((SELECT SUM(line_total) FROM order_accessories WHERE order_accessories.order_id = o.id AND order_accessories.type = 'rent'), 0)) AS rent_total`
      ),
      knex.raw(LIST_ORDER_PRODUCT_QTY_SQL),
      knex.raw(LIST_ORDER_ACCESSORY_QTY_SQL),
      knex.raw(
        `(SELECT MAX(oi.received_at) FROM order_items oi WHERE oi.order_id = o.id) AS items_received_at`
      )
    );
  }

  applyOrderListSearch(qb, query.search);

  const sortCompletedLast = String(query.sort_completed_last || '').trim();
  if (sortCompletedLast === 'delivery') {
    qb.orderByRaw("CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END ASC");
  } else if (sortCompletedLast === 'return') {
    qb.orderByRaw("CASE WHEN o.status IN ('returned', 'closed') THEN 1 ELSE 0 END ASC");
  }

  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    sort: query.sort || dateCol,
  });
  const withNextBookingAlerts =
    query.with_next_booking_alerts !== '0' &&
    query.with_next_booking_alerts !== 0 &&
    query.with_next_booking_alerts !== false &&
    query.with_next_booking_alerts !== 'false';

  if (result.data?.length) {
    const enrichments = [attachLinkedCustomOrders(shopId, result.data)];
    if (withNextBookingAlerts) {
      enrichments.push(attachNextBookingAlertSummaryToOrders(knex, shopId, result.data));
    }
    if (query.with_audit_summary === true) {
      enrichments.push(attachAuditSummaryToOrders(shopId, result.data));
    }
    await Promise.all(enrichments);
    if (query.with_items === true || query.with_items === '1' || query.with_items === 1) {
      const orderIds = result.data.map((r) => r.id).filter(Boolean);
      if (orderIds.length) {
        const items = await knex('order_items as oi')
          .leftJoin('products as p', 'p.id', 'oi.product_id')
          .whereIn('oi.order_id', orderIds)
          .select(
            'oi.id',
            'oi.order_id',
            'oi.product_id',
            'oi.qty',
            'oi.price',
            'oi.discount',
            'oi.line_total',
            'oi.type',
            'oi.name_snapshot',
            'oi.stage_flags',
            'oi.delivered_at',
            'oi.received_at',
            knex.raw('COALESCE(oi.code_snapshot, p.code) as code_snapshot'),
            'p.main_image as main_image',
            'p.notes as product_catalog_notes'
          )
          .orderBy(['oi.display_order', 'oi.created_at']);
        const accessories = await knex('order_accessories as oa')
          .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
          .leftJoin('categories as cat', 'cat.id', 'a.category_id')
          .leftJoin('order_items as oi_link', 'oi_link.id', 'oa.order_item_id')
          .leftJoin('products as p_link', 'p_link.id', 'oi_link.product_id')
          .leftJoin('product_category_accessory_categories as pca', function joinPca() {
            this.on('pca.accessory_category_id', '=', 'a.category_id').andOn(
              'pca.product_category_id',
              '=',
              'p_link.category_id'
            );
          })
          .whereIn('oa.order_id', orderIds)
          .select(
            'oa.id',
            'oa.order_id',
            'oa.order_item_id',
            'oa.accessory_id',
            'oa.qty',
            'oa.price',
            'oa.type',
            'oa.name_snapshot',
            'oa.remarks',
            'oa.given_status',
            'oa.display_order',
            'cat.label as category_name',
            knex.raw('pca.display_order as category_display_order')
          )
          .orderBy(['oa.display_order', 'oa.created_at']);
        const itemsByOrder = new Map();
        for (const it of items) {
          if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
          itemsByOrder.get(it.order_id).push(it);
        }
        const accessoriesByOrder = new Map();
        for (const acc of accessories) {
          if (!accessoriesByOrder.has(acc.order_id)) accessoriesByOrder.set(acc.order_id, []);
          accessoriesByOrder.get(acc.order_id).push(acc);
        }
        for (const row of result.data) {
          row.items = itemsByOrder.get(row.id) || [];
          row.accessories = accessoriesByOrder.get(row.id) || [];
        }
      }
    }
  }
  return result;
}

export async function listBookedProducts(shopId, query) {
  const qb = knex('order_items as oi')
    .innerJoin('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .leftJoin('products as p', 'p.id', 'oi.product_id')
    .leftJoin('categories as cat', 'cat.id', 'p.category_id')
    .where({ 'oi.shop_id': shopId, 'o.is_deleted': false });

  const bucketKey = String(query.status || '')
    .trim()
    .toLowerCase();
  if (bucketKey && Object.prototype.hasOwnProperty.call(BOOKED_PRODUCT_STATUS_BUCKETS, bucketKey)) {
    qb.whereIn('o.status', [...BOOKED_PRODUCT_STATUS_BUCKETS[bucketKey]]);
  }

  if (query.category_id) {
    qb.andWhere('p.category_id', query.category_id);
  }

  if (query.from) qb.andWhere('o.pickup_date', '>=', query.from);
  if (query.to) qb.andWhere('o.pickup_date', '<=', query.to);

  qb.select(
    'oi.id as id',
    'oi.order_id',
    'o.order_number',
    'o.bill_no',
    'o.status as order_status',
    'o.pickup_date',
    'o.return_date',
    'o.pickup_name',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.address as customer_address',
    knex.raw('COALESCE(oi.code_snapshot, p.code) as product_code'),
    'oi.name_snapshot as product_name',
    'oi.qty',
    'oi.line_total as rent',
    'p.category_id',
    'cat.label as category_name'
  );

  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || 'o.pickup_date,o.bill_no',
    search_fields: [
      'o.order_number',
      'o.pickup_name',
      'c.name',
      'c.phone1',
      'c.address',
      'oi.name_snapshot',
      'oi.code_snapshot',
    ],
  });
}

const ITEM_STAGE_COLLECT_PENDING_WHERE = `(
        oi.sf_item_to_collect = 0
        AND oi.sf_pre_check = 0
        AND oi.sf_prepared = 0
        AND oi.sf_delivered = 0
        AND oi.sf_received = 0
      )`;

function applyItemStageListDateCategoryFilters(qb, query) {
  if (query.category_id) {
    qb.andWhere('p.category_id', query.category_id);
  }
  const pickupFrom = String(query.pickup_from || query.from || '')
    .trim()
    .slice(0, 10);
  const pickupTo = String(query.pickup_to || query.to || '')
    .trim()
    .slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(pickupFrom)) {
    qb.andWhere('o.pickup_date', '>=', pickupFrom);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(pickupTo)) {
    qb.andWhere('o.pickup_date', '<=', pickupTo);
  }
  applyItemStageListSalesPersonFilter(qb, query);
  return qb;
}

/** @returns {import('knex').Knex.QueryBuilder} */
function buildItemsToCollectListQb(shopId, query, opts = {}) {
  const activeStatuses = opts.statuses ?? [...BOOKED_PRODUCT_STATUS_BUCKETS.booked];
  const qb = applyItemStageListSalesPersonJoins(
    knex('order_items as oi')
      .innerJoin('orders as o', 'o.id', 'oi.order_id')
      .leftJoin('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('products as p', 'p.id', 'oi.product_id')
      .leftJoin('categories as cat', 'cat.id', 'p.category_id')
  )
    .where({ 'oi.shop_id': shopId, 'o.is_deleted': false })
    .whereIn('o.status', activeStatuses)
    .whereRaw(ITEM_STAGE_COLLECT_PENDING_WHERE);
  return applyItemStageListDateCategoryFilters(qb, query);
}

/** @returns {import('knex').Knex.QueryBuilder} */
function buildItemsToPrepareListQb(shopId, query, opts = {}) {
  const activeStatuses = opts.statuses ?? [...BOOKED_PRODUCT_STATUS_BUCKETS.booked];
  const qb = applyItemStageListSalesPersonJoins(
    knex('order_items as oi')
      .innerJoin('orders as o', 'o.id', 'oi.order_id')
      .leftJoin('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('products as p', 'p.id', 'oi.product_id')
      .leftJoin('categories as cat', 'cat.id', 'p.category_id')
  )
    .where({ 'oi.shop_id': shopId, 'o.is_deleted': false })
    .whereIn('o.status', activeStatuses);

  if (!opts.skipPendingPrepareFilter) {
    qb.whereRaw(sqlItemLinePendingPrepare());
  }

  const collectStatus = String(query.collect_status || '')
    .trim()
    .toLowerCase();
  if (collectStatus === 'collected') {
    qb.whereRaw(sqlItemLineCollected());
  } else if (collectStatus === 'pending') {
    qb.whereRaw(sqlItemLineNotCollected());
  }

  return applyItemStageListDateCategoryFilters(qb, query);
}

async function enrichItemStageListRows(shopId, rows) {
  if (!rows?.length) return;
  const productRows = rows.filter((row) => !row.is_accessory_only);
  const seen = new Set();
  const orderSnapshots = [];
  for (const row of rows) {
    const oid = String(row.order_id);
    if (seen.has(oid)) continue;
    seen.add(oid);
    orderSnapshots.push({
      id: oid,
      pickup_date: row.pickup_date,
      return_date: row.return_date,
    });
  }

  await Promise.all([
    attachNextBookingAlertSummaryToOrders(knex, shopId, orderSnapshots).then(() => {
      const alertByOrderId = new Map(orderSnapshots.map((o) => [String(o.id), o]));
      for (const row of rows) {
        const snap = alertByOrderId.get(String(row.order_id));
        if (!snap) continue;
        row.has_next_booking_alert = snap.has_next_booking_alert;
        row.next_booking_alert_count = snap.next_booking_alert_count;
        row.next_booking_alerts = snap.next_booking_alerts;
      }
    }),
    attachItemLineAvailability(shopId, productRows),
    attachLineAccessoriesDetail(shopId, productRows),
    attachLineAccessoryRemarks(shopId, productRows),
    attachOrderExtraAccessories(shopId, rows),
  ]);
}

async function enrichItemsToCollectBookingRows(shopId, rows) {
  if (!rows?.length) return;
  const orderSnapshots = rows.map((row) => ({
    id: String(row.id),
    pickup_date: row.pickup_date,
    return_date: row.return_date,
  }));
  await attachNextBookingAlertSummaryToOrders(knex, shopId, orderSnapshots);
  const alertByOrderId = new Map(orderSnapshots.map((o) => [String(o.id), o]));
  for (const row of rows) {
    const snap = alertByOrderId.get(String(row.id));
    if (!snap) continue;
    row.has_next_booking_alert = snap.has_next_booking_alert;
    row.next_booking_alert_count = snap.next_booking_alert_count;
    row.next_booking_alerts = snap.next_booking_alerts;
  }
}

function applyItemsToPrepareLineSelect(qb) {
  applyItemsToCollectLineSelect(qb);
  qb.select(knex.raw('0 as is_accessory_only'));
}

function applyItemsToCollectLineSelect(qb) {
  qb.select(
    'oi.id',
    'oi.order_id',
    'oi.product_id',
    'oi.replacement_version',
    'oi.qty',
    'oi.line_total as rent',
    'oi.type as line_type',
    'oi.name_snapshot as product_name',
    'oi.stage_flags',
    'o.order_number',
    'o.bill_no',
    'o.status as order_status',
    'o.pickup_date',
    'o.return_date',
    'o.delivery_time',
    'o.return_time',
    'o.booking_date',
    'o.booking_time',
    'o.reference_name',
    'o.customer_notes',
    'o.pickup_name',
    'o.pickup_number',
    'o.paid_amount',
    'o.deposit_amount',
    'o.deposit_received',
    'o.deposit_returned',
    'o.paid_security_amt',
    'o.balance',
    'o.subtotal',
    'o.discount_total',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.phone2 as customer_phone2',
    'c.whatsapp as customer_whatsapp',
    'c.address as customer_address',
    knex.raw('COALESCE(oi.code_snapshot, p.code) as product_code'),
    'p.color as product_color',
    'p.notes as product_catalog_notes',
    'oi.tailor_notes',
    'oi.tailor_note_image',
    'oi.delivery_notes',
    'p.main_image',
    'p.category_id',
    'cat.label as category_name',
    knex.raw('COALESCE(oi.sales_person_id, o.sales_person_id) as sales_person_id'),
    knex.raw('COALESCE(sp_line.name, sp_order.name) as sales_person_name'),
    'oi.display_order',
    'oi.created_at'
  );
}

function buildAccessoryOnlyPrepareLinesQb(shopId, query, opts = {}) {
  const eligibleOrderIds = buildAccessoriesToPrepareListQb(shopId, query, {
    statuses: ITEM_TO_PREPARE_ORDER_STATUSES,
    skipPendingPrepareFilter: opts.allLines,
  })
    .whereNull('oa.order_item_id')
    .whereNotExists(function noProductLines() {
      this.select(knex.raw('1'))
        .from('order_items as oi_any')
        .whereRaw('oi_any.order_id = oa.order_id')
        .where('oi_any.shop_id', shopId);
    })
    .distinct('oa.order_id');

  if (Array.isArray(query.order_ids) && query.order_ids.length) {
    eligibleOrderIds.whereIn('oa.order_id', query.order_ids);
  }

  const qb = knex
    .from(eligibleOrderIds.as('accessory_only'))
    .innerJoin('orders as o', 'o.id', 'accessory_only.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .leftJoin('users as sp_order', 'sp_order.id', 'o.sales_person_id');

  qb.select(
    knex.raw("CONCAT('accessory-only:', o.id) as id"),
    'o.id as order_id',
    knex.raw('NULL as product_id'),
    knex.raw('0 as replacement_version'),
    knex.raw('0 as qty'),
    knex.raw('0 as rent'),
    knex.raw("'rent' as line_type"),
    knex.raw('NULL as product_name'),
    knex.raw('NULL as stage_flags'),
    'o.order_number',
    'o.bill_no',
    'o.status as order_status',
    'o.pickup_date',
    'o.return_date',
    'o.delivery_time',
    'o.return_time',
    'o.booking_date',
    'o.booking_time',
    'o.reference_name',
    'o.customer_notes',
    'o.pickup_name',
    'o.pickup_number',
    'o.paid_amount',
    'o.deposit_amount',
    'o.deposit_received',
    'o.deposit_returned',
    'o.paid_security_amt',
    'o.balance',
    'o.subtotal',
    'o.discount_total',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.phone2 as customer_phone2',
    'c.whatsapp as customer_whatsapp',
    'c.address as customer_address',
    knex.raw('NULL as product_code'),
    knex.raw('NULL as product_color'),
    knex.raw('NULL as product_catalog_notes'),
    knex.raw('NULL as tailor_notes'),
    knex.raw('NULL as tailor_note_image'),
    knex.raw('NULL as delivery_notes'),
    knex.raw('NULL as main_image'),
    knex.raw('NULL as category_id'),
    knex.raw('NULL as category_name'),
    'o.sales_person_id',
    'sp_order.name as sales_person_name',
    knex.raw('0 as display_order'),
    'o.created_at',
    knex.raw('1 as is_accessory_only')
  );

  return qb;
}

/** Bookings (status booked) with at least one product line pending item-to-collect. */
export async function listItemsToCollect(shopId, query) {
  const lineSub = buildItemsToCollectListQb(shopId, query, {
    statuses: [ORDER_STATUS.BOOKED],
  }).select('oi.id as line_id', 'oi.order_id', 'oi.qty');

  const aggSub = knex
    .from(lineSub.as('pending_lines'))
    .groupBy('pending_lines.order_id')
    .select(
      'pending_lines.order_id',
      knex.raw('COUNT(pending_lines.line_id) as pending_collect_lines'),
      knex.raw('COALESCE(SUM(pending_lines.qty), 0) as pending_collect_qty'),
      knex.raw(
        'GROUP_CONCAT(pending_lines.line_id ORDER BY pending_lines.line_id) as pending_item_ids'
      )
    );

  const qb = knex
    .from(aggSub.as('agg'))
    .innerJoin('orders as o', 'o.id', 'agg.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .leftJoin('users as sp_order', 'sp_order.id', 'o.sales_person_id')
    .where({ 'o.shop_id': shopId, 'o.is_deleted': false });

  qb.select(
    'o.id',
    'o.id as order_id',
    'agg.pending_collect_lines',
    'agg.pending_collect_qty',
    'agg.pending_item_ids',
    'o.order_number',
    'o.bill_no',
    'o.status as order_status',
    'o.pickup_date',
    'o.return_date',
    'o.delivery_time',
    'o.return_time',
    'o.booking_date',
    'o.booking_time',
    'o.reference_name',
    'o.customer_notes',
    'o.pickup_name',
    'o.pickup_number',
    'o.paid_amount',
    'o.deposit_amount',
    'o.deposit_received',
    'o.deposit_returned',
    'o.paid_security_amt',
    'o.balance',
    'o.subtotal',
    'o.discount_total',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.phone2 as customer_phone2',
    'c.whatsapp as customer_whatsapp',
    'c.address as customer_address',
    'o.sales_person_id',
    'sp_order.name as sales_person_name'
  );

  applyItemStageBookingSearch(qb, query.search);
  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    sort: query.sort || 'o.pickup_date,o.bill_no',
  });

  if (result.data?.length && !query.skip_enrich) {
    await enrichItemsToCollectBookingRows(shopId, result.data);
  }

  return result;
}

/** Product lines pending item-to-collect (for PDF/slips; optional order_ids filter). */
export async function listItemsToCollectLines(shopId, query) {
  const qb = buildItemsToCollectListQb(shopId, query, { statuses: [ORDER_STATUS.BOOKED] });

  if (Array.isArray(query.order_ids) && query.order_ids.length) {
    qb.whereIn('oi.order_id', query.order_ids);
  }

  applyItemsToCollectLineSelect(qb);

  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || 'o.pickup_date,o.bill_no',
    search_fields: ITEM_STAGE_LIST_SEARCH_FIELDS,
  });

  if (result.data?.length) {
    if (!query.skip_enrich) {
      await enrichItemStageListRows(shopId, result.data);
    } else {
      await attachLineAccessoriesDetail(shopId, result.data);
      await attachLineAccessoryRemarks(shopId, result.data);
      await attachOrderExtraAccessories(shopId, result.data);
    }
  }

  await attachChecklistStateTokens(knex, shopId, result.data || []);
  return result;
}

/** Count product lines pending item-to-collect (same filters as list). */
export async function countItemsToCollect(shopId, query) {
  const row = await buildItemsToCollectListQb(shopId, query).count({ c: 'oi.id' }).first();
  return Number(row?.c || 0);
}

/** Bookings with pending product/accessory preparation, including accessory-only bills. */
export async function listItemsToPrepare(shopId, query) {
  const aggSub = buildItemsToPrepareBookingAggSub(shopId, query);

  const qb = applyItemToPrepareEligibleOrderGate(
    knex
      .from(aggSub.as('agg'))
      .innerJoin('orders as o', 'o.id', 'agg.order_id')
      .leftJoin('customers as c', 'c.id', 'o.customer_id')
      .leftJoin('users as sp_order', 'sp_order.id', 'o.sales_person_id')
      .where({ 'o.shop_id': shopId, 'o.is_deleted': false }),
    shopId,
    'o.id'
  );

  qb.select(
    'o.id',
    'o.id as order_id',
    'agg.pending_prepare_lines',
    'agg.pending_prepare_qty',
    'agg.pending_item_ids',
    'o.order_number',
    'o.bill_no',
    'o.status as order_status',
    'o.pickup_date',
    'o.return_date',
    'o.delivery_time',
    'o.return_time',
    'o.booking_date',
    'o.booking_time',
    'o.reference_name',
    'o.customer_notes',
    'o.pickup_name',
    'o.pickup_number',
    'o.paid_amount',
    'o.deposit_amount',
    'o.deposit_received',
    'o.deposit_returned',
    'o.paid_security_amt',
    'o.balance',
    'o.subtotal',
    'o.discount_total',
    'c.name as customer_name',
    'c.phone1 as customer_phone',
    'c.phone2 as customer_phone2',
    'c.whatsapp as customer_whatsapp',
    'c.address as customer_address',
    'o.sales_person_id',
    'sp_order.name as sales_person_name'
  );

  applyItemStageBookingSearch(qb, query.search);
  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    sort: query.sort || 'o.pickup_date,o.bill_no',
  });

  if (result.data?.length && !query.skip_enrich) {
    await enrichItemsToCollectBookingRows(shopId, result.data);
  }

  return result;
}

/** Product lines pending prepare (for PDF/slips; optional order_ids filter). */
export async function listItemsToPrepareLines(shopId, query) {
  const allLines = query.all_lines === true || query.all_lines === 1 || query.all_lines === '1';
  const qb = applyItemToPrepareEligibleOrderGate(
    buildItemsToPrepareListQb(shopId, query, {
      statuses: ITEM_TO_PREPARE_ORDER_STATUSES,
      skipPendingPrepareFilter: allLines,
    }),
    shopId,
    'o.id'
  );

  if (Array.isArray(query.order_ids) && query.order_ids.length) {
    qb.whereIn('oi.order_id', query.order_ids);
  }

  applyItemsToPrepareLineSelect(qb);

  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || 'o.pickup_date,o.bill_no',
    search_fields: ITEM_STAGE_LIST_SEARCH_FIELDS,
  });

  if (Number(query.page || 1) === 1) {
    const accessoryOnlyRows = await buildAccessoryOnlyPrepareLinesQb(shopId, query, {
      allLines,
    }).orderBy(['o.pickup_date', 'o.bill_no']);
    if (accessoryOnlyRows.length) {
      result.data.push(...accessoryOnlyRows);
      result.meta.total += accessoryOnlyRows.length;
      result.meta.total_pages = Math.ceil(result.meta.total / result.meta.per_page) || 0;
    }
  }

  if (result.data?.length) {
    if (!query.skip_enrich) {
      await enrichItemStageListRows(shopId, result.data);
    } else {
      await attachLineAccessoriesDetail(shopId, result.data);
      await attachLineAccessoryRemarks(shopId, result.data);
      await attachOrderExtraAccessories(shopId, result.data);
    }
  }

  return result;
}

/** Count bookings with pending prepare lines (same filters as listItemsToPrepare). */
export async function countItemsToPrepare(shopId, query) {
  const aggSub = buildItemsToPrepareBookingAggSub(shopId, query);

  const row = await applyItemToPrepareEligibleOrderGate(
    knex.from(aggSub.as('agg')),
    shopId,
    'agg.order_id'
  )
    .count({ c: 'agg.order_id' })
    .first();
  return Number(row?.c || 0);
}

export async function reassignOrderItemSalesman(shopId, orderId, body) {
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId);
    const order = await trx('orders')
      .where({ id: orderId, shop_id: shopId, is_deleted: false })
      .forUpdate()
      .first('id');
    if (!order) throw notFound('Order not found');

    const target = await trx('users as u')
      .join('users_shops as us', 'us.user_id', 'u.id')
      .where({
        'u.id': body.sales_person_id,
        'us.shop_id': shopId,
        'u.is_active': true,
        'u.role': 'salesman',
      })
      .first('u.id', 'u.name', 'u.email');
    if (!target) throw badRequest('Select an active salesman assigned to this shop');

    const itemIds = [...new Set(body.order_item_ids.map((id) => String(id)))];
    const rows = await trx('order_items')
      .where({ order_id: orderId, shop_id: shopId })
      .whereIn('id', itemIds)
      .forUpdate()
      .select('id', 'sales_person_id');
    if (rows.length !== itemIds.length) {
      throw badRequest('One or more selected product lines do not belong to this booking');
    }

    const changedRows = rows.filter(
      (row) => String(row.sales_person_id || '') !== String(target.id)
    );
    if (changedRows.length) {
      await trx('order_items')
        .where({ order_id: orderId, shop_id: shopId })
        .whereIn(
          'id',
          changedRows.map((row) => row.id)
        )
        .update({ sales_person_id: target.id, updated_at: trx.fn.now() });
    }

    return {
      order_id: orderId,
      order_item_ids: itemIds,
      changed_order_item_ids: changedRows.map((row) => row.id),
      changed: changedRows.length > 0,
      sales_person_id: target.id,
      sales_person_name: String(target.name || target.email || 'Salesman').trim(),
      previous: changedRows.map((row) => ({
        id: row.id,
        sales_person_id: row.sales_person_id || null,
      })),
    };
  });
}

/**
 * Same Current status fields as Item to Collect / Prepare lists (item_status*).
 * Mutates order item rows in place.
 */
async function attachOrderItemsLineAvailability(shopId, order, items, db = knex) {
  if (!Array.isArray(items) || items.length === 0) return;
  for (const i of items) {
    i.order_id = order.id;
    i.pickup_date = order.pickup_date;
    i.return_date = order.return_date;
  }
  await attachItemLineAvailability(shopId, items, db);
}

export async function getOrder(shopId, id) {
  const order = await knex('orders as o')
    .leftJoin('users as sp', 'sp.id', 'o.sales_person_id')
    .where({ 'o.id': id, 'o.shop_id': shopId })
    .select('o.*', knex.raw('sp.name as sales_person_name'))
    .first();
  if (!order) throw notFound('Order not found');
  const [items, accessories, payments, customer] = await Promise.all([
    knex('order_items as oi')
      .leftJoin('products as p', 'p.id', 'oi.product_id')
      .leftJoin('users as sp_line', 'sp_line.id', 'oi.sales_person_id')
      .where('oi.order_id', id)
      .select(
        'oi.*',
        'p.main_image as main_image',
        'p.code as product_code',
        'p.notes as product_catalog_notes',
        'p.price_sell as catalog_price_sell',
        knex.raw('sp_line.name as sales_person_name')
      )
      .orderBy(['oi.display_order', 'oi.created_at']),
    knex('order_accessories as oa')
      .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
      .leftJoin('categories as cat', 'cat.id', 'a.category_id')
      .leftJoin('order_items as oi_link', 'oi_link.id', 'oa.order_item_id')
      .leftJoin('products as p_link', 'p_link.id', 'oi_link.product_id')
      .leftJoin('product_category_accessory_categories as pca', function joinPca() {
        this.on('pca.accessory_category_id', '=', 'a.category_id').andOn(
          'pca.product_category_id',
          '=',
          'p_link.category_id'
        );
      })
      .where('oa.order_id', id)
      .select(
        'oa.*',
        'a.image_url as image_url',
        'a.category_id as category_id',
        'cat.label as category_name',
        knex.raw('a.price_rent as catalog_price_rent'),
        knex.raw('a.price_sell as catalog_price_sell'),
        knex.raw('a.qty as catalog_qty'),
        knex.raw('pca.display_order as category_display_order')
      )
      .orderBy(['oa.display_order', 'oa.created_at']),
    knex('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('security_accounts as sa', function joinSa() {
        this.on('sa.shop_id', '=', 'p.shop_id').andOn('sa.id', '=', 'p.security_account_id');
      })
      .where('p.order_id', id)
      .andWhere('p.is_deleted', false)
      .select(
        'p.*',
        knex.raw('pa.name as payment_account_name'),
        knex.raw('sa.name as security_account_name')
      )
      .orderBy('p.payment_date', 'desc'),
    order.customer_id
      ? knex('customers').where({ id: order.customer_id, shop_id: shopId }).first()
      : Promise.resolve(null),
  ]);
  for (const i of items) {
    i.stage_flags = normalizeStageFlags(i.stage_flags);
    if (!i.code_snapshot && i.product_code) i.code_snapshot = i.product_code;
    delete i.product_code;
  }
  for (const a of accessories) {
    a.stage_flags = normalizeAccessoryStageFlags(a.stage_flags);
    delete a.code_snapshot;
  }
  await attachOrderItemsLineAvailability(shopId, order, items);
  const orderPayload = { ...order, items, accessories, payments, customer: customer || null };
  orderPayload.checklist_state_token = await readChecklistStateToken(knex, shopId, id, orderPayload);
  orderPayload.security_held_amount = await getSecurityHeld(knex, id);
  orderPayload.ordinary_security_net = await getOrdinarySecurityNet(knex, shopId, id);
  orderPayload.replacement_requirements = await listOrderReplacementRequirements(knex, shopId, id);
  if (customer) {
    orderPayload.customer_phone = customer.phone1;
    orderPayload.customer_whatsapp = customer.whatsapp;
  }
  await attachNextBookingAlerts(knex, shopId, orderPayload);
  await attachLinkedCustomOrders(shopId, [orderPayload]);
  return orderPayload;
}

export async function createOrder(shopId, data, userId) {
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, null, data.items || []);
    const billType = data.bill_type || (data.gst_enabled !== false ? 'gst' : 'kaccha');
    if (billType === 'gst') {
      const gstShop = await trx('shops').where({ id: shopId }).select('gstin').first();
      if (!String(gstShop?.gstin || '').trim()) {
        throw badRequest('Configure the shop GSTIN before creating a GST Booking');
      }
    }
    const billNo = await nextBillNumber(trx, shopId);
    const shopRow = await trx('shops')
      .where({ id: shopId })
      .select('order_number_prefix', 'order_number_format')
      .first();
    const prefix = normalizeOrderNumberPrefix(shopRow?.order_number_prefix) ?? 'O';
    const orderNumber = buildOrderNumber({
      format: normalizeOrderNumberFormat(shopRow?.order_number_format),
      prefix,
      sequence: billNo,
      bookingDate: data.booking_date,
    });
    const id = uuid();

    const totals = computeTotals(data);

    const availTo = data.return_date || data.pickup_date;
    const availFrom = String(data.pickup_date || '').slice(0, 10);
    const availToDate = String(availTo || data.pickup_date || '').slice(0, 10);
    await assertRentProductLinesAvailable(shopId, {
      from: availFrom,
      to: availToDate,
      items: data.items || [],
    });
    await assertRentAccessoryLinesAvailable(shopId, {
      from: availFrom,
      to: availToDate,
      items: data.items || [],
    });

    const advAcc = data.advance_account_id
      ? String(data.advance_account_id).trim().slice(0, 80)
      : null;
    const secAcc = data.security_account_id
      ? String(data.security_account_id).trim().slice(0, 80)
      : null;
    if (advAcc) {
      const pa = await trx('payment_accounts')
        .where({ shop_id: shopId, id: advAcc, is_active: true })
        .first();
      if (!pa) throw badRequest('Invalid advance payment account');
    }
    if (secAcc) {
      const sa = await trx('security_accounts')
        .where({ shop_id: shopId, id: secAcc, is_active: true })
        .first();
      if (!sa) throw badRequest('Invalid security account');
    }

    await trx('orders').insert({
      id,
      shop_id: shopId,
      customer_id: data.customer_id,
      order_number: orderNumber,
      bill_no: billNo,
      order_type: data.order_type || 'rent',
      bill_type: billType,
      booking_date: data.booking_date,
      booking_time: resolveBookingTime(data.booking_time),
      pickup_date: data.pickup_date,
      return_date: nullIfEmpty(data.return_date),
      delivery_time: nullIfEmpty(normalizeTime12(data.delivery_time)),
      return_time: nullIfEmpty(normalizeTime12(data.return_time)),
      sales_person_id: data.sales_person_id || userId || null,
      reference_name: data.reference_name || null,
      pickup_name: data.pickup_name || null,
      pickup_number: data.pickup_number || null,
      contact_phone1: data.contact_phone1 || null,
      contact_address: data.contact_address || null,
      customer_notes: data.customer_notes || null,
      next_booking_gap_days: Math.max(0, Math.floor(Number(data.next_booking_gap_days ?? 0))),
      previous_booking_gap_days: Math.max(
        0,
        Math.floor(Number(data.previous_booking_gap_days ?? 0))
      ),
      gst_enabled: billType === 'gst',
      igst_bill: !!data.igst_bill,
      advance_account_id: data.advance_account_id || null,
      security_account_id: data.security_account_id || null,
      paid_security_amt: !!data.paid_security_amt,
      booking_discount_type: data.booking_discount_type || 'flat',
      booking_discount_value: Number(data.booking_discount_value || 0),
      booking_discount_amount: Number(totals.booking_discount_amount || 0),
      subtotal: totals.subtotal,
      discount_total: totals.discount_total,
      tax_total: totals.tax_total,
      extra_charges: totals.extra_charges,
      total_amount: totals.total_amount,
      deposit_amount: data.deposit_amount || 0,
      paid_amount: 0,
      balance: totals.total_amount,
      payment_status: 'pending',
      status: data.status || 'booked',
    });

    const lineIdToOrderItemId = new Map();
    for (const item of data.items || []) {
      if (item.item_type === 'accessory') {
        const parentKey = item.parent_line_id ? String(item.parent_line_id).trim() : '';
        const orderItemId = parentKey ? lineIdToOrderItemId.get(parentKey) || null : null;
        await trx('order_accessories').insert(buildAccessoryRow(item, id, shopId, orderItemId));
        continue;
      }
      const salesPersonId = await resolveItemSalesPersonId(trx, shopId, item, userId);
      const row = buildItemRow({ ...item, sales_person_id: salesPersonId }, id, shopId);
      await trx('order_items').insert(row);
      const lineKey = item.line_id ? String(item.line_id).trim() : '';
      if (lineKey) {
        lineIdToOrderItemId.set(lineKey, row.id);
      }
    }

    const advanceAmt = round2(Number(data.advance_amount || 0));
    if (advanceAmt > 0) {
      await insertOrderPayment(trx, shopId, {
        id: uuid(),
        shop_id: shopId,
        order_id: id,
        customer_id: data.customer_id || null,
        received_by: userId || null,
        payment_type: 'cash',
        category: 'advance',
        amount: advanceAmt,
        payment_date: data.booking_date,
        transaction_id: null,
        notes: null,
        payment_account_id: advAcc,
        security_account_id: null,
      }, 'booking');
    }

    const depositAmt = round2(Number(data.deposit_amount || 0));
    if (data.paid_security_amt && depositAmt > 0) {
      await insertOrderPayment(trx, shopId, {
        id: uuid(),
        shop_id: shopId,
        order_id: id,
        customer_id: data.customer_id || null,
        received_by: userId || null,
        payment_type: 'cash',
        category: 'deposit',
        amount: depositAmt,
        payment_date: data.booking_date,
        transaction_id: null,
        notes: null,
        payment_account_id: null,
        security_account_id: secAcc,
      }, 'booking');
    }

    const applyCreditAmt = round2(Number(data.apply_credit_amount || 0));
    if (applyCreditAmt > 0) {
      const creditLookupPhones = collectIndianPhones(
        data.credit_lookup_phone1,
        data.credit_lookup_phone2,
        data.pickup_number
      );
      const { open_balance: openBalance } = await getOpenCreditBalanceByPhones(
        trx,
        shopId,
        creditLookupPhones
      );
      if (creditLookupPhones.length === 0) {
        throw badRequest('Enter a valid contact number to apply customer credit');
      }
      if (applyCreditAmt > openBalance) {
        throw badRequest(`Credit apply amount cannot exceed open balance (${openBalance})`);
      }
      if (applyCreditAmt > totals.total_amount) {
        throw badRequest('Credit apply amount cannot exceed order total');
      }
      await applyCreditsFromPhones(
        trx,
        shopId,
        creditLookupPhones,
        data.customer_id,
        id,
        applyCreditAmt,
        userId,
        data.booking_date
      );
    }

    if (advanceAmt > 0 || applyCreditAmt > 0) {
      await recomputeOrderPayment(trx, shopId, id);
    }

    if (userId) {
      await trx('order_edit_logs').insert({
        id: uuid(),
        order_id: id,
        shop_id: shopId,
        user_id: userId,
        order_number: orderNumber,
        change_summary: 'Order created',
      });
    }

    await assertSellProductLinesAvailable(shopId, { items: data.items });
    await assertSellAccessoryLinesAvailable(shopId, { items: data.items });
    const sellInventoryDelta = summarizeSellAccessoryQtyFromItems(data.items);
    await applySellAccessoryInventoryDelta(trx, shopId, sellInventoryDelta);
    const sellProductDelta = summarizeSellProductQtyFromItems(data.items);
    await applySellProductInventoryDelta(trx, shopId, sellProductDelta);

    await syncReplacementRequirementsForOrder(trx, shopId, id, userId);
    return getOrderWithTrx(trx, shopId, id);
  });
}

export async function updateOrder(shopId, orderId, data, userId) {
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId, data.items || []);
    const { admin_password: _secret, ...command } = data;
    if (data.idempotency_key) {
      const previous = await trx('sync_queue').where({ id: data.idempotency_key }).forUpdate().first();
      if (previous) {
        assertSettlementReplay(previous, { shopId, orderId, userId, entity: 'order_edit', payload: command });
        return { ...await getOrderWithTrx(trx, shopId, orderId), command_replayed: true };
      }
      await trx('sync_queue').insert({ id: data.idempotency_key, shop_id: shopId, user_id: userId || null,
        entity: 'order_edit', entity_id: orderId, op: 'update', status: 'processing',
        payload: JSON.stringify({ request: command }), retry_count: 0 });
    }
    const existingOrder = await trx('orders').where({ id: orderId, shop_id: shopId }).first();
    if (!existingOrder) throw notFound('Order not found');
    await assertNoIssuedGstInvoice(trx, shopId, orderId);
    const billType =
      data.bill_type || existingOrder.bill_type || (data.gst_enabled !== false ? 'gst' : 'kaccha');
    if (billType === 'gst') {
      const gstShop = await trx('shops').where({ id: shopId }).select('gstin').first();
      if (!String(gstShop?.gstin || '').trim()) {
        throw badRequest('Configure the shop GSTIN before saving a GST Booking');
      }
    }

    const isReconcile = data.reconcile === true;
    const isDeliveredAdminEdit = ORDER_EDIT_ADMIN_UNLOCK_STATUSES.has(existingOrder.status);

    if (isReconcile && existingOrder.status !== 'cancelled') {
      throw badRequest('Only cancelled orders can be reconciled');
    }

    if (existingOrder.status === 'cancelled') {
      if (!isReconcile) {
        throw badRequest('Cancelled orders must be reconciled');
      }
      if (!data.admin_password) {
        throw badRequest('Shop Admin password is required to reconcile a cancelled order');
      }
      await verifyShopAdminPassword(shopId, data.admin_password);
      if (!data.pickup_date || !String(data.return_date || '').trim()) {
        throw badRequest('Delivery and return dates are required to reconcile');
      }
    } else if (ORDER_EDIT_LOCKED_STATUSES.has(existingOrder.status)) {
      if (!isDeliveredAdminEdit) {
        throw badRequest(`Order cannot be edited in status "${existingOrder.status}"`);
      }
      if (!data.admin_password) {
        throw badRequest('Shop Admin password is required to edit a delivered order');
      }
      await verifyShopAdminPassword(shopId, data.admin_password);
    }

    const totals = computeTotals(data);
    const advAcc = data.advance_account_id
      ? String(data.advance_account_id).trim().slice(0, 80)
      : null;
    const secAcc = data.security_account_id
      ? String(data.security_account_id).trim().slice(0, 80)
      : null;
    if (advAcc) {
      const pa = await trx('payment_accounts')
        .where({ shop_id: shopId, id: advAcc, is_active: true })
        .first();
      if (!pa) throw badRequest('Invalid advance payment account');
    }
    if (secAcc) {
      const sa = await trx('security_accounts')
        .where({ shop_id: shopId, id: secAcc, is_active: true })
        .first();
      if (!sa) throw badRequest('Invalid security account');
    }

    const incoming = Array.isArray(data.items) ? data.items : [];
    const productItems = incoming.filter((i) => i.item_type !== 'accessory');
    const accessoryItems = incoming.filter((i) => i.item_type === 'accessory');
    const incomingItemIds = new Set(productItems.map((i) => i.id).filter(Boolean));
    const incomingAccessoryIds = new Set(accessoryItems.map((i) => i.id).filter(Boolean));

    const dbItems = await trx('order_items')
      .where({ order_id: orderId, shop_id: shopId })
      .select('id', 'product_id', 'qty', 'type', 'stage_flags', 'replacement_version');
    const dbAccessories = await trx('order_accessories')
      .where({ order_id: orderId, shop_id: shopId })
      .select(
        'id',
        'order_item_id',
        'stage_flags',
        'given_status',
        'type',
        'accessory_id',
        'qty',
        'damaged',
        'missing',
        'damaged_qty',
        'missing_qty'
      );
    const dbItemById = new Map(dbItems.map((row) => [row.id, row]));
    const expectedProductLines = new Map((data.expected_product_lines || []).map((row) => [row.item_id, row]));
    for (const before of dbItems.filter((row) => !incomingItemIds.has(row.id))) {
      if (Number(before.replacement_version || 0) === 0 && !expectedProductLines.has(before.id)) continue;
      const expected = expectedProductLines.get(before.id);
      if (!expected || expected.expected_product_id !== before.product_id || expected.expected_line_version !== Number(before.replacement_version || 0)) {
        throw conflict('A product selected for removal changed. Refresh and review before removing it.');
      }
    }
    for (const item of productItems) {
      const before = dbItemById.get(item.id);
      if (!before) continue;
      if (Number(before.replacement_version || 0) > 0 || item.expected_line_version !== undefined) {
        if (item.expected_product_id !== before.product_id || item.expected_line_version !== Number(before.replacement_version || 0)) {
          throw conflict('A booking product changed. Refresh before editing this booking.');
        }
      }
    }
    const dbAccessoryById = new Map(dbAccessories.map((row) => [row.id, row]));
    const itemStageById = new Map(dbItems.map((row) => [row.id, row.stage_flags]));
    const accessoryStageById = new Map(dbAccessories.map((row) => [row.id, row.stage_flags]));

    const unknownItemId = [...incomingItemIds].find((id) => !itemStageById.has(id));
    if (unknownItemId) throw badRequest(`Unknown order item id: ${unknownItemId}`);
    const unknownAccessoryId = [...incomingAccessoryIds].find((id) => !accessoryStageById.has(id));
    if (unknownAccessoryId) throw badRequest(`Unknown order accessory id: ${unknownAccessoryId}`);

    const lineHasPhysicalProgress = (row, itemType) => {
      const flags =
        itemType === 'accessory'
          ? normalizeAccessoryStageFlags(row?.stage_flags)
          : normalizeStageFlags(row?.stage_flags);
      return flags.delivered || flags.received;
    };
    const sameInventoryLine = (before, after, itemType) => {
      const inventoryKey = itemType === 'accessory' ? 'accessory_id' : 'product_id';
      return (
        String(before?.[inventoryKey] || '') === String(after?.[inventoryKey] || '') &&
        String(before?.type || 'rent') === String(after?.type || 'rent') &&
        Number(before?.qty || 0) === Number(after?.qty || 0)
      );
    };

    if (!isReconcile) {
      for (const before of dbItems) {
        if (!lineHasPhysicalProgress(before, 'item')) continue;
        const after = productItems.find((item) => item.id === before.id);
        if (!after) throw badRequest('Delivered or returned product lines cannot be removed');
        if (!sameInventoryLine(before, after, 'item')) {
          throw badRequest(
            'Product, type, or quantity cannot be changed after delivery; add a new line instead'
          );
        }
      }
      for (const before of dbAccessories) {
        if (!lineHasPhysicalProgress(before, 'accessory')) continue;
        const after = accessoryItems.find((item) => item.id === before.id);
        if (!after) throw badRequest('Delivered or returned accessory lines cannot be removed');
        if (!sameInventoryLine(before, after, 'accessory')) {
          throw badRequest(
            'Accessory, type, or quantity cannot be changed after delivery; add a new line instead'
          );
        }
      }
    }

    if (isReconcile) {
      await assertReconcileProductsNotSold(shopId, productItems);
    }

    const availTo = data.return_date || data.pickup_date;
    const availFrom = String(data.pickup_date || '').slice(0, 10);
    const availToDate = String(availTo || data.pickup_date || '').slice(0, 10);
    const productRentAvailabilityItems = productItems.filter((item) => {
      const before = item.id ? dbItemById.get(item.id) : null;
      if (!before || !sameInventoryLine(before, item, 'item')) return true;
      return !normalizeStageFlags(before.stage_flags).received;
    });
    const accessoryRentAvailabilityItems = accessoryItems.filter((item) => {
      const before = item.id ? dbAccessoryById.get(item.id) : null;
      if (!before || !sameInventoryLine(before, item, 'accessory')) return true;
      return !normalizeAccessoryStageFlags(before.stage_flags).received;
    });
    await assertRentProductLinesAvailable(shopId, {
      from: availFrom,
      to: availToDate,
      items: productRentAvailabilityItems,
      excludeOrderId: orderId,
    });
    await assertRentAccessoryLinesAvailable(shopId, {
      from: availFrom,
      to: availToDate,
      items: accessoryRentAvailabilityItems,
      excludeOrderId: orderId,
    });
    await assertSellProductLinesAvailable(shopId, {
      items: productItems,
      excludeOrderId: orderId,
    });
    await assertSellAccessoryLinesAvailable(shopId, { items: incoming, excludeOrderId: orderId });
    const prevSellAccessoryQty = await summarizeSellAccessoryQtyForOrder(trx, shopId, orderId);
    const prevSellProductQty = await summarizeSellProductQtyForOrder(trx, shopId, orderId);

    // Net change to catalogue damaged stock caused by this edit. Collected as
    // before/after pairs and applied once, after every line write below.
    const damagedHoldPairs = [];

    const deletedAccessories = dbAccessories.filter((row) => !incomingAccessoryIds.has(row.id));
    const deleteAccessoryIds = deletedAccessories.map((row) => row.id);
    if (deleteAccessoryIds.length > 0) {
      for (const before of deletedAccessories) damagedHoldPairs.push({ before, after: null });
      await trx('order_accessories').whereIn('id', deleteAccessoryIds).delete();
    }

    const deleteItemIds = dbItems
      .filter((row) => !incomingItemIds.has(row.id))
      .map((row) => row.id);
    if (deleteItemIds.length > 0) {
      await trx('order_items').whereIn('id', deleteItemIds).delete();
    }

    const lineIdToOrderItemId = new Map();
    const stageOptionsForLine = (persistedStage, isNewLine, lineKind = 'item') => {
      if (isReconcile) {
        return {
          stage_flags:
            lineKind === 'accessory' ? DEFAULT_ACCESSORY_STAGE_FLAGS : DEFAULT_STAGE_FLAGS,
        };
      }
      if (isDeliveredAdminEdit && isNewLine) {
        return {
          stage_flags:
            lineKind === 'accessory' ? DEFAULT_ACCESSORY_STAGE_FLAGS : DEFAULT_STAGE_FLAGS,
        };
      }
      return { stage_flags: persistedStage };
    };

    const resolveAccessoryGivenStatus = (accessoryItem) => {
      if (accessoryItem.given_with_rent) return 'given_with_rent';
      if (accessoryItem.pack_with_rent) return 'pack_with_rent';
      return 'regular';
    };

    const stageOptionsForAccessory = (accessoryItem, dbAcc, persistedStage, isNewLine) => {
      if (isReconcile) {
        return { stage_flags: DEFAULT_ACCESSORY_STAGE_FLAGS };
      }
      if (isDeliveredAdminEdit && isNewLine) {
        return { stage_flags: DEFAULT_ACCESSORY_STAGE_FLAGS };
      }
      const newGivenStatus = resolveAccessoryGivenStatus(accessoryItem);
      const syncedStage = syncAccessoryStageFlagsForGivenStatusChange(
        dbAcc?.given_status,
        newGivenStatus,
        persistedStage,
        { isSell: String(accessoryItem.type || 'rent') === 'sell' }
      );
      return { stage_flags: syncedStage };
    };

    for (const item of productItems) {
      const isNewItem = !item.id;
      const persistedStage = item.id ? itemStageById.get(item.id) : null;
      if (item.id) {
        const row = buildItemRow(
          item,
          orderId,
          shopId,
          stageOptionsForLine(persistedStage, false, 'item')
        );
        const itemUpdate = {
          product_id: row.product_id,
          name_snapshot: row.name_snapshot,
          code_snapshot: row.code_snapshot,
          qty: row.qty,
          price: row.price,
          discount: row.discount,
          tax: row.tax,
          line_total: row.line_total,
          type: row.type,
          condition: row.condition,
          tailor_notes: row.tailor_notes,
          tailor_note_image: row.tailor_note_image,
          display_order: row.display_order,
          updated_at: trx.fn.now(),
        };
        if (isReconcile || !isDeliveredAdminEdit) {
          itemUpdate.stage_flags = row.stage_flags;
        }
        if (!sameInventoryLine(dbItemById.get(item.id), item, 'item')) {
          itemUpdate.stage_flags = JSON.stringify(DEFAULT_STAGE_FLAGS);
          itemUpdate.prepared_at = null;
          itemUpdate.delivered_at = null;
          itemUpdate.received_at = null;
          itemUpdate.replacement_version = Number(dbItemById.get(item.id)?.replacement_version || 0) + 1;
        }
        if (isReconcile) {
          itemUpdate.prepared_at = null;
          itemUpdate.delivered_at = null;
          itemUpdate.received_at = null;
        }
        if (Object.prototype.hasOwnProperty.call(item, 'sales_person_id')) {
          itemUpdate.sales_person_id = item.sales_person_id
            ? await resolveItemSalesPersonId(trx, shopId, item, null)
            : null;
        }
        await trx('order_items')
          .where({ id: item.id, order_id: orderId, shop_id: shopId })
          .update(itemUpdate);
        const lineKey = item.line_id ? String(item.line_id).trim() : '';
        if (lineKey) lineIdToOrderItemId.set(lineKey, item.id);
        continue;
      }
      const salesPersonId = await resolveItemSalesPersonId(trx, shopId, item, userId);
      const row = buildItemRow(
        { ...item, sales_person_id: salesPersonId },
        orderId,
        shopId,
        stageOptionsForLine(persistedStage, isNewItem, 'item')
      );
      await trx('order_items').insert(row);
      const lineKey = item.line_id ? String(item.line_id).trim() : '';
      if (lineKey) lineIdToOrderItemId.set(lineKey, row.id);
    }

    for (const item of accessoryItems) {
      const parentKey = item.parent_line_id ? String(item.parent_line_id).trim() : '';
      const orderItemId = parentKey ? lineIdToOrderItemId.get(parentKey) || null : null;
      const isNewAccessory = !item.id;
      const persistedStage = item.id ? accessoryStageById.get(item.id) : null;
      const dbAcc = item.id ? dbAccessoryById.get(item.id) : null;
      const row = buildAccessoryRow(
        item,
        orderId,
        shopId,
        orderItemId,
        stageOptionsForAccessory(item, dbAcc, persistedStage, isNewAccessory)
      );
      if (item.id) {
        const accessoryUpdate = {
          order_item_id: row.order_item_id,
          accessory_id: row.accessory_id,
          name_snapshot: row.name_snapshot,
          qty: row.qty,
          price: row.price,
          discount: row.discount,
          line_total: row.line_total,
          type: row.type,
          given_status: row.given_status,
          remarks: row.remarks,
          display_order: row.display_order,
          updated_at: trx.fn.now(),
        };
        const givenStatusChanged =
          dbAcc &&
          String(dbAcc.given_status || 'regular').trim() !==
            String(row.given_status || 'regular').trim();
        if (isReconcile || !isDeliveredAdminEdit || givenStatusChanged) {
          accessoryUpdate.stage_flags = row.stage_flags;
        }
        await trx('order_accessories')
          .where({ id: item.id, order_id: orderId, shop_id: shopId })
          .update(accessoryUpdate);
        // `damaged` is not part of accessoryUpdate, so it survives the edit —
        // but qty / accessory_id / type can all move under it.
        damagedHoldPairs.push({
          before: dbAcc,
          after: {
            ...row,
            damaged: dbAcc?.damaged,
            missing: dbAcc?.missing,
            damaged_qty: dbAcc?.damaged_qty,
            missing_qty: dbAcc?.missing_qty,
          },
        });
      } else {
        await trx('order_accessories').insert(row);
      }
    }

    await applyDamagedAccessoryHoldDelta(trx, shopId, damagedHoldPairs);

    await trx('orders')
      .where({ id: orderId, shop_id: shopId })
      .update({
        customer_id: data.customer_id,
        bill_type: billType,
        order_type: data.order_type || existingOrder.order_type || 'rent',
        booking_date: data.booking_date,
        booking_time: resolveBookingTime(data.booking_time),
        pickup_date: data.pickup_date,
        return_date: nullIfEmpty(data.return_date),
        delivery_time: nullIfEmpty(normalizeTime12(data.delivery_time)),
        return_time: nullIfEmpty(normalizeTime12(data.return_time)),
        sales_person_id: data.sales_person_id || null,
        reference_name: data.reference_name || null,
        pickup_name: data.pickup_name || null,
        pickup_number: data.pickup_number || null,
        contact_phone1: data.contact_phone1 || null,
        contact_address: data.contact_address || null,
        customer_notes: data.customer_notes || null,
        next_booking_gap_days: Math.max(0, Math.floor(Number(data.next_booking_gap_days ?? 0))),
        previous_booking_gap_days: Math.max(
          0,
          Math.floor(Number(data.previous_booking_gap_days ?? 0))
        ),
        gst_enabled: billType === 'gst',
        igst_bill: !!data.igst_bill,
        advance_account_id: advAcc,
        security_account_id: secAcc,
        booking_discount_type: data.booking_discount_type || 'flat',
        booking_discount_value: Number(data.booking_discount_value || 0),
        booking_discount_amount: Number(totals.booking_discount_amount || 0),
        subtotal: totals.subtotal,
        discount_total: totals.discount_total,
        tax_total: totals.tax_total,
        extra_charges: totals.extra_charges,
        total_amount: totals.total_amount,
        ...(isReconcile
          ? {
              status: 'booked',
              canceled_at: null,
              delivered_at: null,
              returned_at: null,
              packed_at: null,
            }
          : {}),
        updated_at: trx.fn.now(),
      });

    await syncReplacementRequirementsForOrder(trx, shopId, orderId, userId);
    await propagateOrderStatus(trx, shopId, orderId);

    if (data.edit_settlement) {
      const depositAmount = data.edit_settlement.deposit_amount;
      if (depositAmount !== undefined && Math.abs(Number(existingOrder.deposit_amount || 0) - data.edit_settlement.expected_deposit_amount) > 0.009) {
        throw conflict('Security Amount changed; refresh the booking');
      }
      if (depositAmount !== undefined) {
        await trx('orders').where({ id: orderId, shop_id: shopId }).update({ deposit_amount: depositAmount });
      }
      await applyBookingEditPaymentsWithTrx(trx, shopId, orderId, data.edit_settlement, userId);
      if (data.edit_settlement.security_net !== undefined || depositAmount !== undefined) {
        const currentDeposit = depositAmount ?? Number(existingOrder.deposit_amount || 0);
        const net = await getOrdinarySecurityNet(trx, shopId, orderId);
        await updateOrderSecurityStatusWithTrx(trx, shopId, orderId, {
          status: net > 0 ? 'paid' : 'unpaid', deposit_amount: currentDeposit,
        }, userId, { hydrate: false });
      }
    }

    await recomputeOrderPayment(trx, shopId, orderId);
    const nextSellAccessoryQty = summarizeSellAccessoryQtyFromItems(accessoryItems);
    if (isReconcile) {
      await applySellAccessoryInventoryDelta(trx, shopId, nextSellAccessoryQty);
    } else {
      const sellInventoryDelta = diffSellAccessoryQtyMaps(
        nextSellAccessoryQty,
        prevSellAccessoryQty
      );
      await applySellAccessoryInventoryDelta(trx, shopId, sellInventoryDelta);
    }
    const nextSellProductQty = summarizeSellProductQtyFromItems(productItems);
    if (isReconcile) {
      await applySellProductInventoryDelta(trx, shopId, nextSellProductQty);
    } else {
      const sellProductDelta = diffSellAccessoryQtyMaps(nextSellProductQty, prevSellProductQty);
      await applySellProductInventoryDelta(trx, shopId, sellProductDelta);
    }
    await trx('order_edit_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      order_number: existingOrder.order_number,
      change_summary: isReconcile
        ? 'Order reconciled'
        : isDeliveredAdminEdit
          ? 'Delivered order edited (admin); new lines only reset for checklist'
          : 'Order lines updated',
    });
    if (data.idempotency_key) {
      await trx('sync_queue').where({ id: data.idempotency_key, shop_id: shopId }).update({
        status: 'synced', synced_at: trx.fn.now(), error: null,
      });
    }
    return getOrderWithTrx(trx, shopId, orderId);
  });
}

const ORDER_HEADER_FOR_CHECKLIST_STAGE = [
  'id',
  'status',
  'delivered_at',
  'packed_at',
  'updated_at',
];

const ORDER_HEADER_FOR_CHECKLIST_CONDITION = [
  ...ORDER_HEADER_FOR_CHECKLIST_STAGE,
  'balance',
  'paid_amount',
  'payment_status',
  'total_amount',
];

async function selectOrderHeaderSlice(trx, shopId, orderId, columns) {
  return trx('orders').where({ id: orderId, shop_id: shopId }).select(columns).first();
}

async function listPaymentsRows(trx, orderId) {
  return trx('payments')
    .where({ order_id: orderId, is_deleted: false })
    .orderBy('payment_date', 'desc');
}

function stageLineFromComputedState(itemType, rowId, flags, itemTimestamps = null) {
  const t = itemType === 'accessory' ? 'accessory' : 'item';
  const stage_flags =
    t === 'accessory' ? normalizeAccessoryStageFlags(flags) : normalizeStageFlags(flags);
  const entry = { item_type: t, id: rowId, stage_flags };
  if (t === 'item' && itemTimestamps) {
    entry.prepared_at = itemTimestamps.prepared_at ?? null;
    entry.delivered_at = itemTimestamps.delivered_at ?? null;
    entry.received_at = itemTimestamps.received_at ?? null;
  }
  return entry;
}

const RECEIVED_BLOCKED_MSG = 'Cannot mark Received while this line is Missing.';
const GIVEN_WITH_RENT_UNSET_MSG = 'Given with rent accessories cannot unset Prepared/Delivered';

/** Mirrors desktop lineBlocksReceived — missing on this line only, not damaged. */
function lineBlocksReceivedForDb(row) {
  return lineBlocksReceivedByMissingQuantity(row);
}

function isGivenWithRentAccessoryRow(row) {
  return String(row?.given_status || '').trim() === 'given_with_rent';
}

function assertGivenWithRentStageChangeAllowed(row, itemType, field, value) {
  if (itemType !== 'accessory' || !isGivenWithRentAccessoryRow(row)) return;
  if ((field === 'prepared' || field === 'delivered') && !value) {
    throw badRequest(GIVEN_WITH_RENT_UNSET_MSG);
  }
}

function skipGivenWithRentUnset(row, itemType, field, value) {
  if (itemType !== 'accessory' || !isGivenWithRentAccessoryRow(row)) return false;
  return (field === 'prepared' || field === 'delivered') && !value;
}

function stageUpdateReversesDeliveredOrReceived(row, itemType, field, nextVal) {
  if (nextVal || (field !== 'delivered' && field !== 'received')) return false;
  const flags =
    itemType === 'accessory'
      ? normalizeAccessoryStageFlags(row.stage_flags)
      : normalizeStageFlags(row.stage_flags);
  if (!flags[field]) return false;
  if (skipGivenWithRentUnset(row, itemType, field, nextVal)) return false;
  return true;
}

async function clearReceivedFlagsOnRow(trx, shopId, orderId, row, table) {
  const itemType = table === 'order_accessories' ? 'accessory' : 'item';
  const flags =
    itemType === 'accessory'
      ? normalizeAccessoryStageFlags(row.stage_flags)
      : normalizeStageFlags(row.stage_flags);
  if (!flags.received) return null;
  flags.received = false;
  const patch = {
    stage_flags:
      itemType === 'accessory'
        ? JSON.stringify(normalizeAccessoryStageFlags(flags))
        : JSON.stringify(normalizeStageFlags(flags)),
    updated_at: trx.fn.now(),
  };
  let ts = null;
  if (table === 'order_items') {
    patch.received_at = null;
    ts = {
      prepared_at: row.prepared_at ?? null,
      delivered_at: row.delivered_at ?? null,
      received_at: null,
    };
    await syncWashingQueue(trx, shopId, orderId, row.id, false);
  } else {
    await syncAccessoryWashingQueue(trx, shopId, orderId, row.id, false);
  }
  await trx(table).where({ id: row.id, order_id: orderId, shop_id: shopId }).update(patch);
  return stageLineFromComputedState(itemType, row.id, flags, ts);
}

/** When a product is marked missing, clear Received on the product line only. */
async function cascadeClearReceivedForProductMissing(trx, shopId, orderId, itemId) {
  const lines = [];
  const product = await trx('order_items')
    .where({ id: itemId, order_id: orderId, shop_id: shopId })
    .first();
  if (product) {
    const line = await clearReceivedFlagsOnRow(trx, shopId, orderId, product, 'order_items');
    if (line) lines.push(line);
  }
  return lines;
}

async function buildChecklistStageLines(trx, shopId, orderId, descriptors) {
  const uniq = new Map();
  for (const d of descriptors) {
    const t = d.item_type === 'accessory' ? 'accessory' : 'item';
    uniq.set(`${t}:${d.id}`, { item_type: t, id: d.id });
  }
  const fetches = [...uniq.values()].map(async ({ item_type: itemType, id }) => {
    const table = itemType === 'accessory' ? 'order_accessories' : 'order_items';
    const r = await trx(table).where({ id, order_id: orderId, shop_id: shopId }).first();
    if (!r) return null;
    const flags =
      itemType === 'accessory'
        ? normalizeAccessoryStageFlags(r.stage_flags)
        : normalizeStageFlags(r.stage_flags);
    const ts =
      table === 'order_items'
        ? { prepared_at: r.prepared_at, delivered_at: r.delivered_at, received_at: r.received_at }
        : null;
    return stageLineFromComputedState(itemType, id, flags, ts);
  });
  return (await Promise.all(fetches)).filter(Boolean);
}

async function buildConditionLineSlice(trx, shopId, orderId, itemType, itemId) {
  const t = itemType === 'accessory' ? 'accessory' : 'item';
  const table = t === 'accessory' ? 'order_accessories' : 'order_items';
  const r = await trx(table).where({ id: itemId, order_id: orderId, shop_id: shopId }).first();
  if (!r) return null;
  return {
    item_type: t,
    id: r.id,
    damaged: !!r.damaged,
    missing: !!r.missing,
    damaged_qty: Number(r.damaged_qty || 0),
    missing_qty: Number(r.missing_qty || 0),
    damage_charge: r.damage_charge,
    damage_account_id: r.damage_account_id,
  };
}

export async function updateOrderStatusFlag(
  shopId,
  orderId,
  itemId,
  itemType,
  field,
  value,
  userId,
  expected = {}
) {
  const stageField = normalizeStageField(field);
  if (itemType === 'accessory' && stageField === 'item_to_collect') {
    throw badRequest('Item to collect does not apply to accessories');
  }
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId);
    const table = itemType === 'accessory' ? 'order_accessories' : 'order_items';
    const row = await trx(table).where({ id: itemId, order_id: orderId, shop_id: shopId }).first();
    if (!row) throw notFound('Item not found');

    const flags =
      itemType === 'accessory'
        ? normalizeAccessoryStageFlags(row.stage_flags)
        : normalizeStageFlags(row.stage_flags);
    const oldVal = !!flags[stageField];
    assertDeliveryLineVersion(row, { ...expected, item_type: itemType, field: stageField, value });

    if (stageField === 'received' && value && lineBlocksReceivedForDb(row)) {
      throw badRequest(RECEIVED_BLOCKED_MSG);
    }

    assertGivenWithRentStageChangeAllowed(row, itemType, stageField, value);

    if (
      itemType === 'item' &&
      value &&
      ['item_to_collect', 'prepared', 'delivered'].includes(stageField)
    ) {
      await assertProductLineCanEnableStage(trx, shopId, orderId, row, flags, stageField);
    }
    if (itemType === 'accessory' && value && ['prepared', 'delivered'].includes(stageField)) {
      await assertAccessoryLineCanEnableStage(trx, shopId, orderId, row, flags, stageField);
    }

    flags[stageField] = !!value;

    const serialized =
      itemType === 'accessory'
        ? JSON.stringify(normalizeAccessoryStageFlags(flags))
        : JSON.stringify(normalizeStageFlags(flags));
    const patch = { stage_flags: serialized, updated_at: trx.fn.now() };
    const now = trx.fn.now();
    const supportsStageTimestamps = table === 'order_items';
    if (supportsStageTimestamps && stageField === 'prepared' && value) patch.prepared_at = now;
    if (supportsStageTimestamps && stageField === 'delivered' && value) patch.delivered_at = now;
    if (supportsStageTimestamps && stageField === 'received' && value) patch.received_at = now;

    await trx(table).where({ id: itemId }).update(patch);

    await trx('order_status_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      item_id: itemId,
      item_type: itemType === 'accessory' ? 'accessory' : 'item',
      field: stageField,
      action: value ? 'CHECKED' : 'UNCHECKED',
      old_value: String(oldVal),
      new_value: String(!!value),
      message: `${stageField} ${value ? 'checked' : 'unchecked'}`,
    });

    if (stageField === 'received') {
      if (itemType === 'accessory') {
        await syncAccessoryWashingQueue(trx, shopId, orderId, itemId, !!value);
      } else {
        await syncWashingQueue(trx, shopId, orderId, itemId, !!value);
      }
    }

    await propagateOrderStatus(trx, shopId, orderId);
    const orderHeader = await selectOrderHeaderSlice(
      trx,
      shopId,
      orderId,
      ORDER_HEADER_FOR_CHECKLIST_STAGE
    );
    const itemTypeNorm = itemType === 'accessory' ? 'accessory' : 'item';
    const ts =
      table === 'order_items'
        ? {
            prepared_at:
              stageField === 'prepared' && value
                ? new Date().toISOString()
                : (row.prepared_at ?? null),
            delivered_at:
              stageField === 'delivered' && value
                ? new Date().toISOString()
                : (row.delivered_at ?? null),
            received_at:
              stageField === 'received' && value
                ? new Date().toISOString()
                : (row.received_at ?? null),
          }
        : null;
    const lines = [stageLineFromComputedState(itemTypeNorm, itemId, flags, ts)];
    return { order: orderHeader, lines };
  });
}

export async function bulkUpdateOrderStatusFlag(shopId, orderId, field, value, userId, expectedItems = []) {
  const normalizedField = normalizeStageField(String(field || '').trim());
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_STAGE_FLAGS, normalizedField)) {
    throw badRequest('Invalid stage field');
  }
  const nextValue = !!value;
  const expectedById = new Map(expectedItems.map((row) => [row.item_id, row]));

  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId);
    const order = await trx('orders').where({ id: orderId, shop_id: shopId }).first();
    if (!order) throw notFound('Order not found');

    const rows = [];
    const itemRows = await trx('order_items')
      .where({ order_id: orderId, shop_id: shopId })
      .select(
        'id',
        'product_id',
        'replacement_version',
        'type',
        'qty',
        'stage_flags',
        'prepared_at',
        'delivered_at',
        'received_at',
        'missing',
        'damaged'
      );
    const accessoryRows = await trx('order_accessories')
      .where({ order_id: orderId, shop_id: shopId })
      .select(
        'id',
        'order_item_id',
        'accessory_id',
        'type',
        'qty',
        'stage_flags',
        'given_status',
        'missing',
        'damaged',
        'missing_qty',
        'damaged_qty'
      );

    itemRows.forEach((r) => rows.push({ ...r, table: 'order_items' }));
    accessoryRows.forEach((r) => rows.push({ ...r, table: 'order_accessories' }));

    let updated = 0;
    let skipped = 0;
    const rowUpdates = [];
    for (const row of rows) {
      const itemTypeNorm = row.table === 'order_accessories' ? 'accessory' : 'item';
      if (itemTypeNorm === 'accessory' && normalizedField === 'item_to_collect') {
        skipped += 1;
        continue;
      }
      const flags =
        itemTypeNorm === 'accessory'
          ? normalizeAccessoryStageFlags(row.stage_flags)
          : normalizeStageFlags(row.stage_flags);
      if (nextValue !== Boolean(flags[normalizedField])) {
        assertDeliveryLineVersion(row, { ...expectedById.get(row.id), item_type: itemTypeNorm, field: normalizedField, value: nextValue });
      }
      const isAllowed = canBulkStageTransition(normalizedField, nextValue, flags, itemTypeNorm);
      if (!isAllowed) {
        skipped += 1;
        continue;
      }
      // Do not auto-mark Received on lines that are Missing.
      if (normalizedField === 'received' && nextValue && lineBlocksReceivedForDb(row)) {
        skipped += 1;
        continue;
      }
      if (skipGivenWithRentUnset(row, itemTypeNorm, normalizedField, nextValue)) {
        skipped += 1;
        continue;
      }
      if (
        itemTypeNorm === 'item' &&
        nextValue &&
        ['item_to_collect', 'prepared', 'delivered'].includes(normalizedField) &&
        !flags[normalizedField]
      ) {
        await assertProductLineCanEnableStage(trx, shopId, orderId, row, flags, normalizedField);
      }
      if (
        itemTypeNorm === 'accessory' &&
        nextValue &&
        ['prepared', 'delivered'].includes(normalizedField) &&
        !flags[normalizedField]
      ) {
        await assertAccessoryLineCanEnableStage(trx, shopId, orderId, row, flags, normalizedField);
      }
      if (!!flags[normalizedField] === nextValue) continue;

      flags[normalizedField] = nextValue;
      const patch = {
        stage_flags:
          itemTypeNorm === 'accessory'
            ? JSON.stringify(normalizeAccessoryStageFlags(flags))
            : JSON.stringify(normalizeStageFlags(flags)),
        updated_at: trx.fn.now(),
      };
      const supportsStageTimestamps = row.table === 'order_items';
      if (supportsStageTimestamps && normalizedField === 'prepared' && nextValue)
        patch.prepared_at = trx.fn.now();
      if (supportsStageTimestamps && normalizedField === 'delivered' && nextValue)
        patch.delivered_at = trx.fn.now();
      if (supportsStageTimestamps && normalizedField === 'received' && nextValue)
        patch.received_at = trx.fn.now();

      const nextTs =
        row.table === 'order_items'
          ? {
              prepared_at:
                normalizedField === 'prepared' && nextValue
                  ? new Date().toISOString()
                  : (row.prepared_at ?? null),
              delivered_at:
                normalizedField === 'delivered' && nextValue
                  ? new Date().toISOString()
                  : (row.delivered_at ?? null),
              received_at:
                normalizedField === 'received' && nextValue
                  ? new Date().toISOString()
                  : (row.received_at ?? null),
            }
          : null;

      rowUpdates.push({
        table: row.table,
        id: row.id,
        patch,
        itemTypeNorm,
        flags,
        itemTimestamps: nextTs,
      });
      updated += 1;
    }

    await Promise.all(rowUpdates.map((u) => trx(u.table).where({ id: u.id }).update(u.patch)));

    if (normalizedField === 'received') {
      for (const u of rowUpdates) {
        if (u.table === 'order_items') {
          await syncWashingQueue(trx, shopId, orderId, u.id, nextValue);
        } else if (u.table === 'order_accessories') {
          await syncAccessoryWashingQueue(trx, shopId, orderId, u.id, nextValue);
        }
      }
    }

    await propagateOrderStatus(trx, shopId, orderId);
    await trx('order_edit_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      order_number: order.order_number,
      change_summary: `Bulk stage update: ${normalizedField}=${nextValue} (updated=${updated}, skipped=${skipped})`,
    });

    const orderHeader = await selectOrderHeaderSlice(
      trx,
      shopId,
      orderId,
      ORDER_HEADER_FOR_CHECKLIST_STAGE
    );
    const lines = rowUpdates.map((u) =>
      stageLineFromComputedState(u.itemTypeNorm, u.id, u.flags, u.itemTimestamps)
    );
    return {
      bulk: { updated, skipped, field: normalizedField, value: nextValue },
      order: orderHeader,
      lines,
    };
  });
}

/**
 * Apply many stage toggles in one transaction (e.g. client-batched rapid checks).
 */
async function batchUpdateOrderStatusFlagsWithTrx(
  trx,
  shopId,
  orderId,
  updates,
  userId,
  opts = {}
) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw badRequest('No updates');
  }
  const maxUpdates = Number(opts.max_updates || 100);
  await lockOrderInventory(trx, shopId, orderId);
  if (updates.length > maxUpdates) {
    throw badRequest(`Too many stage updates (max ${maxUpdates})`);
  }

  const orderLock = await trx('orders')
    .where({ id: orderId, shop_id: shopId })
    .forUpdate()
    .first('id');
  if (!orderLock) throw notFound('Order not found');

  const itemIds = [
    ...new Set(
      updates.filter((u) => (u.item_type || 'item') !== 'accessory').map((u) => u.item_id)
    ),
  ];
  const accessoryIds = [
    ...new Set(
      updates.filter((u) => (u.item_type || 'item') === 'accessory').map((u) => u.item_id)
    ),
  ];

  const itemRows =
    itemIds.length > 0
      ? await trx('order_items')
          .whereIn('id', itemIds)
          .where({ order_id: orderId, shop_id: shopId })
          .select(
            'id',
            'product_id',
            'replacement_version',
            'type',
            'qty',
            'stage_flags',
            'prepared_at',
            'delivered_at',
            'received_at',
            'missing',
            'damaged'
          )
      : [];
  const accessoryRows =
    accessoryIds.length > 0
      ? await trx('order_accessories')
          .whereIn('id', accessoryIds)
          .where({ order_id: orderId, shop_id: shopId })
          .select(
            'id',
            'order_item_id',
            'accessory_id',
            'type',
            'qty',
            'stage_flags',
            'given_status',
            'missing',
            'damaged',
            'missing_qty',
            'damaged_qty'
          )
      : [];

  const itemsById = new Map(itemRows.map((r) => [r.id, { ...r }]));
  const accById = new Map(accessoryRows.map((r) => [r.id, { ...r }]));

  const productIds = [...new Set(itemRows.map((row) => row.product_id).filter(Boolean))];
  const inventoryAccessoryIds = [
    ...new Set(accessoryRows.map((row) => row.accessory_id).filter(Boolean)),
  ];
  if (productIds.length) {
    await trx('products')
      .where({ shop_id: shopId })
      .whereIn('id', productIds)
      .forUpdate()
      .select('id');
  }
  if (inventoryAccessoryIds.length) {
    await trx('accessories')
      .where({ shop_id: shopId })
      .whereIn('id', inventoryAccessoryIds)
      .forUpdate()
      .select('id');
  }

  let needsAdminPassword = false;
  for (const u of updates) {
    const itemId = u.item_id;
    const itemType = u.item_type === 'accessory' ? 'accessory' : 'item';
    const field = normalizeStageField(u.field);
    const nextVal = !!u.value;
    const row = itemType === 'accessory' ? accById.get(itemId) : itemsById.get(itemId);
    if (!row) throw notFound('Item not found');
    if (stageUpdateReversesDeliveredOrReceived(row, itemType, field, nextVal)) {
      needsAdminPassword = true;
      break;
    }
  }
  if (needsAdminPassword) {
    if (!opts.admin_password?.trim()) {
      throw badRequest('Shop Admin password is required to undo Delivered or Received');
    }
    await verifyShopAdminPassword(shopId, opts.admin_password);
  }

  const logRows = [];
  const lineDescriptors = [];
  const dirtyItemIds = new Set();
  const dirtyAccIds = new Set();

  for (const u of updates) {
    const itemId = u.item_id;
    const itemType = u.item_type === 'accessory' ? 'accessory' : 'item';
    const field = normalizeStageField(u.field);
    const nextVal = !!u.value;

    if (itemType === 'accessory' && field === 'item_to_collect') {
      throw badRequest('Item to collect does not apply to accessories');
    }

    const validFields =
      itemType === 'accessory' ? ACCESSORY_STAGE_FIELDS : new Set(Object.keys(DEFAULT_STAGE_FLAGS));
    if (!validFields.has(field)) {
      throw badRequest('Invalid stage field');
    }

    const row = itemType === 'accessory' ? accById.get(itemId) : itemsById.get(itemId);
    if (!row) throw notFound('Item not found');

    const flags =
      itemType === 'accessory'
        ? normalizeAccessoryStageFlags(row.stage_flags)
        : normalizeStageFlags(row.stage_flags);
    const oldVal = !!flags[field];
    assertDeliveryLineVersion(row, { ...u, item_type: itemType, field, value: nextVal });
    lineDescriptors.push({ item_type: itemType, id: itemId });

    if (field === 'received' && nextVal && lineBlocksReceivedForDb(row)) {
      if (opts.reject_skipped) {
        throw badRequest(
          `Cannot mark Received — ${itemType === 'accessory' ? 'accessory' : 'product'} is marked Missing`
        );
      }
      continue;
    }

    if (skipGivenWithRentUnset(row, itemType, field, nextVal)) {
      continue;
    }

    if (
      itemType === 'item' &&
      nextVal &&
      ['item_to_collect', 'prepared', 'delivered'].includes(field) &&
      !oldVal
    ) {
      await assertProductLineCanEnableStage(trx, shopId, orderId, row, flags, field);
    }
    if (
      itemType === 'accessory' &&
      ['prepared', 'delivered'].includes(field) &&
      nextVal &&
      !oldVal
    ) {
      await assertAccessoryLineCanEnableStage(trx, shopId, orderId, row, flags, field);
    }

    if (oldVal === nextVal) continue;

    flags[field] = nextVal;
    row.stage_flags =
      itemType === 'accessory'
        ? JSON.stringify(normalizeAccessoryStageFlags(flags))
        : JSON.stringify(normalizeStageFlags(flags));
    if (itemType === 'item') {
      if (field === 'prepared' && nextVal) row.prepared_at = new Date();
      if (field === 'delivered' && nextVal) row.delivered_at = new Date();
      if (field === 'received' && nextVal) row.received_at = new Date();
      if (field === 'received' && !nextVal) row.received_at = null;
      dirtyItemIds.add(itemId);
    } else {
      dirtyAccIds.add(itemId);
    }

    logRows.push({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      item_id: itemId,
      item_type: itemType === 'accessory' ? 'accessory' : 'item',
      field,
      action: nextVal ? 'CHECKED' : 'UNCHECKED',
      old_value: String(oldVal),
      new_value: String(nextVal),
      message: `${field} ${nextVal ? 'checked' : 'unchecked'}`,
    });
  }

  const itemWrites = [...dirtyItemIds].map((rid) => {
    const r = itemsById.get(rid);
    return trx('order_items')
      .where({ id: rid, order_id: orderId, shop_id: shopId })
      .update({
        stage_flags: r.stage_flags,
        prepared_at: r.prepared_at ?? null,
        delivered_at: r.delivered_at ?? null,
        received_at: r.received_at ?? null,
        updated_at: trx.fn.now(),
      });
  });
  const accWrites = [...dirtyAccIds].map((rid) => {
    const r = accById.get(rid);
    return trx('order_accessories').where({ id: rid, order_id: orderId, shop_id: shopId }).update({
      stage_flags: r.stage_flags,
      updated_at: trx.fn.now(),
    });
  });
  await Promise.all([...itemWrites, ...accWrites]);

  if (logRows.length) {
    await trx('order_status_logs').insert(logRows);
  }

  const receivedUpdates = logRows.filter((l) => l.field === 'received');
  for (const log of receivedUpdates) {
    if (log.item_type === 'accessory') {
      await syncAccessoryWashingQueue(trx, shopId, orderId, log.item_id, log.new_value === 'true');
    } else {
      await syncWashingQueue(trx, shopId, orderId, log.item_id, log.new_value === 'true');
    }
  }

  await propagateOrderStatus(trx, shopId, orderId);

  const orderHeader = await selectOrderHeaderSlice(
    trx,
    shopId,
    orderId,
    ORDER_HEADER_FOR_CHECKLIST_STAGE
  );
  const uniqDesc = new Map();
  for (const d of lineDescriptors) {
    uniqDesc.set(`${d.item_type}:${d.id}`, d);
  }
  const lines = [...uniqDesc.values()].map((d) => {
    const row = d.item_type === 'accessory' ? accById.get(d.id) : itemsById.get(d.id);
    const flags =
      d.item_type === 'accessory'
        ? normalizeAccessoryStageFlags(row.stage_flags)
        : normalizeStageFlags(row.stage_flags);
    const ts =
      d.item_type === 'item'
        ? {
            prepared_at: row.prepared_at ?? null,
            delivered_at: row.delivered_at ?? null,
            received_at: row.received_at ?? null,
          }
        : null;
    return stageLineFromComputedState(d.item_type, d.id, flags, ts);
  });
  return { order: orderHeader, lines, batch: { applied: logRows.length } };
}

export async function batchUpdateOrderStatusFlags(shopId, orderId, updates, userId, opts = {}) {
  return orderTransaction((trx) =>
    batchUpdateOrderStatusFlagsWithTrx(trx, shopId, orderId, updates, userId, opts)
  );
}

/**
 * Update damage / missing / damage_charge on an order item or accessory.
 * Used by the Return screen when inspecting returned items.
 */
export async function updateItemCondition(
  shopId,
  orderId,
  itemId,
  itemType,
  patch,
  userId,
  opts = {}
) {
  return orderTransaction((trx) => updateItemConditionWithTrx(trx, shopId, orderId, itemId, itemType, patch, userId, opts));
}

async function updateItemConditionWithTrx(trx, shopId, orderId, itemId, itemType, patch, userId, opts = {}) {
  const skipLineSecuritySync = !!opts.skipLineSecuritySync;
    await lockOrderInventory(trx, shopId, orderId);
    const table = itemType === 'accessory' ? 'order_accessories' : 'order_items';
    const row = await trx(table).where({ id: itemId, order_id: orderId, shop_id: shopId }).first();
    if (!row) throw notFound('Item not found');
    assertDeliveryLineVersion(row, { ...patch, item_type: itemType });
    const orderRow = await trx('orders')
      .where({ id: orderId, shop_id: shopId })
      .select('order_number', 'customer_id', 'advance_account_id')
      .first();
    if (!orderRow) throw notFound('Order not found');

    const allowed = {};
    if (patch.damaged !== undefined) allowed.damaged = !!patch.damaged;
    if (patch.missing !== undefined) allowed.missing = !!patch.missing;
    if (allowed.damaged === true && allowed.missing === true) {
      throw badRequest('Damage and Missing cannot be selected together');
    }
    if (allowed.damaged === true) allowed.missing = false;
    if (allowed.missing === true) allowed.damaged = false;
    if (patch.damage_charge !== undefined) allowed.damage_charge = Number(patch.damage_charge) || 0;
    if (itemType === 'accessory' && (patch.condition_qty !== undefined || allowed.damaged !== undefined || allowed.missing !== undefined)) {
      const condition =
        (allowed.missing ?? row.missing)
          ? 'missing'
          : (allowed.damaged ?? row.damaged)
            ? 'damage'
            : 'normal';
      const conditionQty = requestedAccessoryConditionQuantity(row, condition, patch.condition_qty);
      allowed.damaged_qty = condition === 'damage' ? conditionQty : 0;
      allowed.missing_qty = condition === 'missing' ? conditionQty : 0;
    }
    if (patch.damage_account_id !== undefined) {
      const acc = patch.damage_account_id
        ? String(patch.damage_account_id).trim().slice(0, 80)
        : null;
      if (acc) {
        const pa = await trx('payment_accounts')
          .where({ shop_id: shopId, id: acc, is_active: true })
          .first();
        if (!pa) throw badRequest('Invalid damage charge account');
      }
      allowed.damage_account_id = acc;
    }
    if (
      allowed.damage_charge !== undefined &&
      Number(allowed.damage_charge) <= 0 &&
      allowed.damage_account_id === undefined
    ) {
      allowed.damage_account_id = null;
    }
    if (Object.keys(allowed).length === 0) {
      const orderHeader = await selectOrderHeaderSlice(
        trx,
        shopId,
        orderId,
        ORDER_HEADER_FOR_CHECKLIST_CONDITION
      );
      return { order: orderHeader, lines: [] };
    }

    const prevCharge = Number(row.damage_charge || 0);
    const nextCharge =
      allowed.damage_charge !== undefined ? Number(allowed.damage_charge || 0) : prevCharge;

    const writePatch = { ...allowed, updated_at: trx.fn.now() };
    await trx(table).where({ id: itemId }).update(writePatch);

    if (itemType === 'accessory') {
      await applyDamagedAccessoryHoldDelta(trx, shopId, [
        { before: row, after: { ...row, ...allowed } },
      ]);
    }

    if (allowed.damaged !== undefined || allowed.missing !== undefined || allowed.damaged_qty !== undefined || allowed.missing_qty !== undefined) {
      const flags =
        itemType === 'accessory'
          ? normalizeAccessoryStageFlags(row.stage_flags)
          : normalizeStageFlags(row.stage_flags);
      if (flags.received) {
        if (itemType === 'accessory') {
          await syncAccessoryWashingQueue(trx, shopId, orderId, itemId, true);
        } else {
          await syncWashingQueue(trx, shopId, orderId, itemId, true);
        }
      }
    }

    let stageLines = [];
    if ((allowed.missing ?? row.missing) && lineBlocksReceivedForDb({ ...row, ...allowed })) {
      if (itemType === 'item') {
        stageLines = await cascadeClearReceivedForProductMissing(trx, shopId, orderId, itemId);
      } else {
        const line = await clearReceivedFlagsOnRow(
          trx,
          shopId,
          orderId,
          { ...row, ...allowed },
          'order_accessories'
        );
        if (line) stageLines = [line];
      }
      if (stageLines.length) await propagateOrderStatus(trx, shopId, orderId);
    }

    if (
      !skipLineSecuritySync &&
      (allowed.damage_charge !== undefined ||
        allowed.damaged !== undefined ||
        allowed.missing !== undefined ||
        allowed.damaged_qty !== undefined ||
        allowed.missing_qty !== undefined)
    ) {
      const accountForCharge =
        allowed.damage_account_id !== undefined ? allowed.damage_account_id : row.damage_account_id;
      const conditionKind =
        (allowed.missing ?? row.missing)
          ? 'missing'
          : (allowed.damaged ?? row.damaged)
            ? 'damage'
            : null;
      await syncChecklistSecurityCharge(trx, {
        shopId,
        orderId,
        customerId: orderRow.customer_id || null,
        itemType,
        itemId,
        amount: conditionKind ? nextCharge : 0,
        paymentAccountId: accountForCharge,
        conditionKind,
        userId,
      });
    }

    if (allowed.damaged !== undefined || allowed.missing !== undefined) {
      if (itemType !== 'accessory' && allowed.damaged === true) {
        await recordDamagedProductReplacements(trx, shopId, orderId, [itemId], userId);
      }
      await propagateOrderStatus(trx, shopId, orderId);
    }

    await trx('order_edit_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      order_number: orderRow?.order_number || null,
      change_summary: `Condition update on ${itemType} ${itemId}: ${JSON.stringify(allowed)}`,
    });

    if (opts.hydrate === false) return null;

    const orderHeader = await selectOrderHeaderSlice(
      trx,
      shopId,
      orderId,
      ORDER_HEADER_FOR_CHECKLIST_CONDITION
    );
    const lineSlice = await buildConditionLineSlice(trx, shopId, orderId, itemType, itemId);
    const lines = [...stageLines];
    if (lineSlice) lines.push(lineSlice);
    return {
      order: orderHeader,
      lines,
    };
}

export async function applyChecklistCommand(shopId, orderId, input, userId) {
  const body = validate(orderChecklistCommandSchema, input);
  const { admin_password: adminPassword, ...command } = body;
  try {
    return await orderTransaction(async (trx) => {
      await lockOrderInventory(trx, shopId, orderId);
      const order = await trx('orders').where({ id: orderId, shop_id: shopId, is_deleted: false }).first();
      if (!order) throw notFound('Order not found');
      const previous = await trx('sync_queue').where({ id: body.idempotency_key }).forUpdate().first();
      if (previous) {
        assertSettlementReplay(previous, { shopId, orderId, userId, entity: 'checklist_command', payload: command });
        return { order: await getOrderWithTrx(trx, shopId, orderId), replayed: true };
      }
      if (order.status === 'cancelled') throw badRequest('Cancelled bookings cannot change checklist');
      if (await readChecklistStateToken(trx, shopId, orderId) !== body.expected_state_token) {
        throw conflict('Checklist or assessments changed. Refresh the booking and review this saved action.');
      }
      await trx('sync_queue').insert({ id: body.idempotency_key, shop_id: shopId, user_id: userId || null,
        entity: 'checklist_command', entity_id: orderId, op: 'update', status: 'processing',
        payload: JSON.stringify({ request: command }), retry_count: 0 });
      const existingCombined = await trx('security_charges').where({ shop_id: shopId, order_id: orderId, source: 'checklist' })
        .whereNot('status', 'void').whereNull('item_id').first('id');
      if (existingCombined && !body.combined_assessment && body.condition_updates.some((row) => row.damage_charge !== undefined)) {
        throw badRequest('This booking has a combined assessment. Review its total explicitly before changing line charges.');
      }
      for (const update of body.condition_updates) {
        await updateItemConditionWithTrx(trx, shopId, orderId, update.item_id, update.item_type, update, userId,
          { skipLineSecuritySync: Boolean(body.combined_assessment || existingCombined), hydrate: false });
      }
      if (body.combined_assessment) {
        if (body.combined_assessment.payment_account_id) {
          await assertLedgerRefs(trx, shopId, { payment_account_id: body.combined_assessment.payment_account_id });
        }
        await syncCombinedChecklistSecurityCharge(trx, { shopId, orderId, userId, customerId: order.customer_id,
          amount: body.combined_assessment.amount, remarks: body.combined_assessment.remarks,
          paymentAccountId: body.combined_assessment.payment_account_id });
      }
      if (body.stage_updates.length) {
        await batchUpdateOrderStatusFlagsWithTrx(trx, shopId, orderId, body.stage_updates, userId,
          { max_updates: 500, admin_password: adminPassword, reject_skipped: true });
      }
      const saved = await getOrderWithTrx(trx, shopId, orderId);
      await trx('sync_queue').where({ id: body.idempotency_key, shop_id: shopId }).update({
        status: 'synced', synced_at: trx.fn.now(), error: null,
      });
      return { order: saved, replayed: false };
    });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw conflict('Request key already used. Review the original saved action.');
    throw error;
  }
}

export async function cancelOrder(shopId, orderId, userId, body = {}) {
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId);
    const order = await trx('orders').where({ id: orderId, shop_id: shopId }).first();
    if (!order) throw notFound('Order not found');
    await assertNoIssuedGstInvoice(trx, shopId, orderId);

    const refundAmt = round2(Number(body.refund_amount || 0));
    const creditAmt = round2(Number(body.credit_note_amount || 0));
    const securityRefundAmt = round2(Number(body.security_refund_amount || 0));
    const paymentDate = toLocalISODate(new Date());

    const advanceNet = await getAdvanceNetPaid(trx, orderId);
    const securityHeld = await getSecurityHeld(trx, orderId);

    if (refundAmt + creditAmt > advanceNet) {
      throw badRequest(
        `Refund and credit note total cannot exceed advance net paid (${advanceNet})`
      );
    }
    if (securityRefundAmt > securityHeld) {
      throw badRequest(`Security refund cannot exceed held security (${securityHeld})`);
    }

    if (refundAmt > 0) {
      const accId = body.refund_payment_account_id
        ? String(body.refund_payment_account_id).trim().slice(0, 80)
        : null;
      if (!accId) throw badRequest('Refund payment account is required');
      const pa = await trx('payment_accounts')
        .where({ shop_id: shopId, id: accId, is_active: true })
        .first();
      if (!pa) throw badRequest('Invalid refund payment account');
      await insertOrderPayment(trx, shopId, {
        id: uuid(),
        shop_id: shopId,
        order_id: orderId,
        customer_id: order.customer_id,
        received_by: userId || null,
        payment_type: 'cash',
        category: 'refund',
        amount: refundAmt,
        payment_date: paymentDate,
        transaction_id: null,
        notes: null,
        payment_account_id: accId,
        security_account_id: null,
      });
    }

    if (creditAmt > 0) {
      const remarks = String(body.credit_note_remarks || '').trim() || 'Bill cancelled';
      await issueCreditNoteOnCancel(trx, shopId, order, creditAmt, remarks, userId, paymentDate);
    }

    if (securityRefundAmt > 0) {
      const secId = body.security_account_id
        ? String(body.security_account_id).trim().slice(0, 80)
        : null;
      if (!secId) throw badRequest('Security account is required');
      const sa = await trx('security_accounts')
        .where({ shop_id: shopId, id: secId, is_active: true })
        .first();
      if (!sa) throw badRequest('Invalid security account');
      await insertOrderPayment(trx, shopId, {
        id: uuid(),
        shop_id: shopId,
        order_id: orderId,
        customer_id: order.customer_id,
        received_by: userId || null,
        payment_type: 'cash',
        category: 'deposit_refund',
        amount: securityRefundAmt,
        payment_date: paymentDate,
        transaction_id: null,
        notes: null,
        payment_account_id: null,
        security_account_id: secId,
      });
    }

    if (refundAmt > 0 || creditAmt > 0) {
      await recomputeOrderPayment(trx, shopId, orderId);
    }

    if (order.status !== 'cancelled') {
      const soldAccessoryQty = await summarizeSellAccessoryQtyForOrder(trx, shopId, orderId);
      const restoreDelta = new Map(
        [...soldAccessoryQty].map(([accessoryId, qty]) => [accessoryId, -qty])
      );
      await applySellAccessoryInventoryDelta(trx, shopId, restoreDelta);
      const soldProductQty = await summarizeSellProductQtyForOrder(trx, shopId, orderId);
      const restoreProductDelta = new Map(
        [...soldProductQty].map(([productId, qty]) => [productId, -qty])
      );
      await applySellProductInventoryDelta(trx, shopId, restoreProductDelta);
    }
    await trx('orders').where({ id: orderId }).update({
      status: 'cancelled',
      canceled_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    await trx('order_edit_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      order_number: order.order_number,
      change_summary: 'Order cancelled',
    });
    await syncReplacementRequirementsForOrder(trx, shopId, orderId, userId);
    return getOrderWithTrx(trx, shopId, orderId);
  });
}

export { verifyShopAdminPassword } from '../../utils/shopAdmin.js';

export async function deleteOrder(shopId, orderId, userId) {
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId);
    await assertNoHeldConditionFundsForDeletion(trx, shopId, orderId);
    const order = await trx('orders')
      .where({ id: orderId, shop_id: shopId, is_deleted: false })
      .first();
    if (!order) throw notFound('Order not found');
    await assertNoIssuedGstInvoice(trx, shopId, orderId);

    if (order.status !== 'cancelled') {
      const soldAccessoryQty = await summarizeSellAccessoryQtyForOrder(trx, shopId, orderId);
      const restoreDelta = new Map(
        [...soldAccessoryQty].map(([accessoryId, qty]) => [accessoryId, -qty])
      );
      await applySellAccessoryInventoryDelta(trx, shopId, restoreDelta);
      const soldProductQty = await summarizeSellProductQtyForOrder(trx, shopId, orderId);
      const restoreProductDelta = new Map(
        [...soldProductQty].map(([productId, qty]) => [productId, -qty])
      );
      await applySellProductInventoryDelta(trx, shopId, restoreProductDelta);
    }

    // Deliberately not gated on `status !== 'cancelled'` the way the sell restore
    // above is: cancelling an order leaves its damaged holds in place (so a
    // reconcile back to active stays consistent), which makes deletion the only
    // point that releases them. Soft-delete is terminal — there is no restore
    // path — so this can never run twice for the same order.
    await releaseDamagedAccessoryHoldsForOrder(trx, shopId, orderId);

    await trx('orders').where({ id: orderId, shop_id: shopId }).update({
      is_deleted: true,
      deleted_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    await trx('order_edit_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      order_number: order.order_number,
      change_summary: 'Booking deleted',
    });

    await syncReplacementRequirementsForOrder(trx, shopId, orderId, userId);
    return order;
  });
}

async function updateOrderSecurityStatusWithTrx(trx, shopId, orderId, payload, userId, opts = {}) {
  const normalized = String(payload?.status || '')
    .trim()
    .toLowerCase();
  if (!['unpaid', 'paid', 'returned'].includes(normalized)) {
    throw badRequest('Invalid security status');
  }
  const depositAmount = Number(payload?.deposit_amount ?? 0);
  if (Number.isNaN(depositAmount) || depositAmount < 0) {
    throw badRequest('Invalid deposit amount');
  }
  const order = await trx('orders').where({ id: orderId, shop_id: shopId }).first();
  if (!order) throw notFound('Order not found');

  const patch =
    normalized === 'unpaid'
      ? { paid_security_amt: false, deposit_received: false, deposit_returned: false }
      : normalized === 'paid'
        ? { paid_security_amt: true, deposit_received: true, deposit_returned: false }
        : { paid_security_amt: true, deposit_received: true, deposit_returned: true };

  await trx('orders')
    .where({ id: orderId, shop_id: shopId })
    .update({
      ...patch,
      deposit_amount: round2(depositAmount),
      updated_at: trx.fn.now(),
    });

  await trx('order_edit_logs').insert({
    id: uuid(),
    order_id: orderId,
    shop_id: shopId,
    user_id: userId || null,
    order_number: order.order_number,
    change_summary: `Security updated: status=${normalized}, deposit=${round2(depositAmount)}`,
  });

  return opts.hydrate === false ? null : getOrderWithTrx(trx, shopId, orderId);
}

export async function updateOrderSecurityStatus(shopId, orderId, payload, userId) {
  return orderTransaction((trx) =>
    updateOrderSecurityStatusWithTrx(trx, shopId, orderId, payload, userId)
  );
}

async function adjustOrderDiscountTotalWithTrx(
  trx,
  shopId,
  orderId,
  requestedDiscountTotal,
  userId,
  opts = {}
) {
  const T = round2(Number(requestedDiscountTotal));
  if (Number.isNaN(T) || T < 0) throw badRequest('Invalid discount total');
  const existingOrder = await trx('orders').where({ id: orderId, shop_id: shopId }).forUpdate().first();
  if (!existingOrder) throw notFound('Order not found');
  if (T !== Number(existingOrder.discount_total)) await assertNoIssuedGstInvoice(trx, shopId, orderId);
  if (ORDER_EDIT_LOCKED_STATUSES.has(existingOrder.status)) {
    throw badRequest(`Order discount cannot be changed in status "${existingOrder.status}"`);
  }
  const items = await trx('order_items').where({ order_id: orderId, shop_id: shopId });
  const accessories = await trx('order_accessories').where({ order_id: orderId, shop_id: shopId });
  const lineDisc = lineDiscountSumFromDbRows(items, accessories);
  const subtotal = subtotalFromDbRows(items, accessories);
  if (T < lineDisc) {
    throw badRequest(
      `Discount total cannot be less than the sum of line discounts (${lineDisc.toFixed(2)})`
    );
  }
  if (T > subtotal) {
    throw badRequest('Discount total cannot exceed the order subtotal');
  }
  const bookingFlat = round2(T - lineDisc);
  const computePayload = {
    items: linesForComputeTotalsFromDbRows(items, accessories),
    booking_discount_type: 'flat',
    booking_discount_value: bookingFlat,
    extra_charges: Number(existingOrder.extra_charges || 0),
    tax_mode: existingOrder.tax_mode || 'exclusive',
  };
  const totals = computeTotals(computePayload);
  await trx('orders').where({ id: orderId, shop_id: shopId }).update({
    booking_discount_type: 'flat',
    booking_discount_value: bookingFlat,
    booking_discount_amount: totals.booking_discount_amount,
    subtotal: totals.subtotal,
    discount_total: totals.discount_total,
    tax_total: totals.tax_total,
    total_amount: totals.total_amount,
    updated_at: trx.fn.now(),
  });
  if (opts.recompute !== false) {
    await recomputeOrderPayment(trx, shopId, orderId);
  }
  await trx('order_edit_logs').insert({
    id: uuid(),
    order_id: orderId,
    shop_id: shopId,
    user_id: userId || null,
    order_number: existingOrder.order_number,
    change_summary: `Discount total set to ${totals.discount_total} (${opts.reason || 'delivery settlement'})`,
  });
  return opts.hydrate === false ? totals : getOrderWithTrx(trx, shopId, orderId);
}

export async function adjustOrderDiscountTotal(shopId, orderId, requestedDiscountTotal, userId) {
  return orderTransaction((trx) =>
    adjustOrderDiscountTotalWithTrx(trx, shopId, orderId, requestedDiscountTotal, userId)
  );
}

async function replayedDeliverySettlement(trx, shopId, orderId, syncRow, payload, userId) {
  const saved = assertSettlementReplay(syncRow, { shopId, orderId, userId, entity: 'delivery_settlement', payload });
  return {
    order: await getOrderWithTrx(trx, shopId, orderId),
    payments: saved.payments || { security_payment_id: null, rent_payment_id: null },
    replayed: true,
  };
}

async function assertBankOrCashAccount(trx, shopId, accountId, label) {
  if (!accountId) return null;
  const row = await trx('payment_accounts')
    .where({ id: accountId, shop_id: shopId, is_active: true })
    .forUpdate()
    .first('id', 'account_group');
  if (!row) throw badRequest(`Unknown or inactive ${label}`);
  const group = String(row.account_group || '')
    .trim()
    .toLowerCase();
  if (!['bank accounts', 'cash accounts'].includes(group)) {
    throw badRequest(`${label} must be a bank or cash account`);
  }
  return row;
}

async function assertReturnStageUpdatesCanApply(trx, shopId, orderId, updates) {
  const itemIds = [
    ...new Set(updates.filter((row) => row.item_type !== 'accessory').map((row) => row.item_id)),
  ];
  const accessoryIds = [
    ...new Set(updates.filter((row) => row.item_type === 'accessory').map((row) => row.item_id)),
  ];
  const items = itemIds.length
    ? await trx('order_items')
        .where({ order_id: orderId, shop_id: shopId })
        .whereIn('id', itemIds)
        .select('id', 'qty', 'missing')
    : [];
  const accessories = accessoryIds.length
    ? await trx('order_accessories')
        .where({ order_id: orderId, shop_id: shopId })
        .whereIn('id', accessoryIds)
        .select('id', 'qty', 'missing', 'missing_qty')
    : [];
  const itemById = new Map(items.map((row) => [row.id, row]));
  const accessoryById = new Map(accessories.map((row) => [row.id, row]));

  for (const update of updates) {
    const isAccessory = update.item_type === 'accessory';
    const row = isAccessory ? accessoryById.get(update.item_id) : itemById.get(update.item_id);
    if (!row) throw notFound('Item not found');
    if (update.field === 'received' && update.value && lineBlocksReceivedForDb(row)) {
      throw badRequest(
        `Cannot mark Received — ${isAccessory ? 'accessory' : 'product'} is marked Missing`
      );
    }
  }
}

function parsedReceivedFlag(value) {
  return !!normalizeStageFlags(value).received;
}

async function prepareReturnConditionUpdates(trx, shopId, orderId, updates, stageUpdates) {
  const rows = [];
  const seen = new Set();
  const receivedRequests = new Set(
    (stageUpdates || [])
      .filter((row) => row.field === 'received' && row.value === true)
      .map((row) => `${row.item_type === 'accessory' ? 'accessory' : 'item'}:${row.item_id}`)
  );

  for (const update of updates || []) {
    const itemType = update.item_type === 'accessory' ? 'accessory' : 'item';
    const key = `${itemType}:${update.item_id}`;
    if (seen.has(key)) throw badRequest('Each return condition line can be submitted only once');
    seen.add(key);
    const table = itemType === 'accessory' ? 'order_accessories' : 'order_items';
    const catalogTable = itemType === 'accessory' ? 'accessories' : 'products';
    const catalogIdColumn = itemType === 'accessory' ? 'accessory_id' : 'product_id';
    const line = await trx(`${table} as line`)
      .leftJoin(`${catalogTable} as catalog`, `catalog.id`, `line.${catalogIdColumn}`)
      .where({
        'line.id': update.item_id,
        'line.order_id': orderId,
        'line.shop_id': shopId,
      })
      .forUpdate()
      .select(
        'line.*',
        'catalog.price_sell as catalog_selling_price',
        'catalog.name as catalog_name'
      )
      .first();
    if (!line) throw notFound(`${itemType === 'accessory' ? 'Accessory' : 'Product'} not found`);
    assertDeliveryLineVersion(line, { ...update, item_type: itemType });

    const condition = update.condition;
    const qty = Math.max(1, Number(line.qty || 1));
    const conditionQty =
      itemType === 'accessory'
        ? requestedAccessoryConditionQuantity(line, condition, update.condition_qty)
        : condition === 'normal'
          ? 0
          : qty;
    if (condition === 'missing' && receivedRequests.has(key) && conditionQty >= qty) {
      throw badRequest('A fully Missing line cannot be marked Received');
    }
    const existingCharge = round2(Number(line.damage_charge || 0));
    const chargeAmount =
      condition === 'normal'
        ? 0
        : update.charge_amount !== undefined
          ? round2(Number(update.charge_amount || 0))
          : condition === 'damage'
            ? round2(Number(line.catalog_selling_price || 0) * conditionQty)
            : existingCharge;

    rows.push({
      itemType,
      table,
      line,
      condition,
      conditionQty,
      chargeAmount,
      label:
        String(line.name_snapshot || line.catalog_name || '').trim() ||
        (itemType === 'accessory' ? 'Accessory' : 'Product'),
    });
  }
  return rows;
}

async function applyReturnConditions(trx, shopId, orderId, rows, userId) {
  for (const entry of rows) {
    const damaged = entry.condition === 'damage';
    const missing = entry.condition === 'missing';
    const patch = {
      damaged,
      missing,
      damage_charge: entry.chargeAmount,
      updated_at: trx.fn.now(),
    };
    if (entry.itemType === 'accessory') {
      patch.damaged_qty = damaged ? entry.conditionQty : 0;
      patch.missing_qty = missing ? entry.conditionQty : 0;
    }
    await trx(entry.table)
      .where({ id: entry.line.id, order_id: orderId, shop_id: shopId })
      .update(patch);
    if (entry.itemType === 'accessory') {
      await applyDamagedAccessoryHoldDelta(trx, shopId, [
        { before: entry.line, after: { ...entry.line, ...patch } },
      ]);
    }
    const received = parsedReceivedFlag(entry.line.stage_flags);
    if (received) {
      if (entry.itemType === 'accessory') {
        await syncAccessoryWashingQueue(trx, shopId, orderId, entry.line.id, true);
      } else {
        await syncWashingQueue(trx, shopId, orderId, entry.line.id, true);
      }
    }
    await trx('order_edit_logs').insert({
      id: uuid(),
      order_id: orderId,
      shop_id: shopId,
      user_id: userId || null,
      change_summary: `${entry.condition} condition applied to ${entry.itemType} ${entry.line.id}`,
    });
  }
  if (rows.length > 0) {
    const damagedIds = rows.filter((row) => row.itemType === 'item' && row.condition === 'damage').map((row) => row.line.id);
    if (damagedIds.length) await recordDamagedProductReplacements(trx, shopId, orderId, damagedIds, userId);
    await propagateOrderStatus(trx, shopId, orderId);
  }
}

async function postReturnConditionCharges(
  trx,
  { shopId, order, rows, securityHeld, refundAmount, chargeAccountId, userId,
    retainAmount = 0, collectAmount = 0, paymentDate, idempotencyKey }
) {
  const retainedTotal = round2(Number(retainAmount || 0));
  const directTotal = round2(Number(collectAmount || 0));
  if (retainedTotal > securityHeld + 0.009 || refundAmount > securityHeld - retainedTotal + 0.009) {
    throw badRequest('Security refund plus explicitly retained amount cannot exceed available security');
  }
  if (directTotal > 0) await assertBankOrCashAccount(trx, shopId, chargeAccountId, 'condition deposit account');
  const assessments = [];
  for (const entry of rows) {
    if (entry.condition === 'normal') {
      const existing = await trx('security_charges')
        .where({ shop_id: shopId, order_id: order.id, item_type: entry.itemType, item_id: entry.line.id })
        .whereNot('status', 'void').first('id');
      if (!existing) continue;
    }
    const quantityLabel = entry.itemType === 'accessory' && Number(entry.line.qty || 1) > 1
      ? ` · Qty ${entry.conditionQty} of ${Number(entry.line.qty)}` : '';
    const label = entry.condition === 'missing' ? 'Missing' : entry.condition === 'damage' ? 'Damage' : 'Condition cleared';
    const charge = await createOrUpdateConditionAssessmentWithTrx(trx, {
      shopId, userId, orderId: order.id, customerId: order.customer_id || null,
      itemType: entry.itemType, itemId: entry.line.id,
      conditionKind: entry.condition === 'normal' ? null : entry.condition,
      amount: entry.chargeAmount, remarks: `${label} · ${entry.label}${quantityLabel}`,
    });
    assessments.push(charge);
  }
  const fundable = assessments.filter((charge) => charge.ledger_verified);
  const available = round2(fundable.reduce((sum, charge) => sum + charge.balances.uncollected, 0));
  if (retainedTotal + directTotal > available + 0.009) {
    throw badRequest('Condition funding cannot exceed the uncollected assessed amount');
  }
  let retainRemaining = retainedTotal;
  let collectRemaining = directTotal;
  for (const charge of fundable) {
    const retain = round2(Math.min(retainRemaining, charge.balances.uncollected));
    const collect = round2(Math.min(collectRemaining, charge.balances.uncollected - retain));
    if (retain > 0 || collect > 0) {
      await fundConditionChargeWithTrx(trx, {
        shopId, userId, chargeId: charge.id, retainAmount: retain, collectAmount: collect,
        paymentAccountId: chargeAccountId, paymentDate, idempotencyKey,
      });
    }
    retainRemaining = round2(retainRemaining - retain);
    collectRemaining = round2(collectRemaining - collect);
  }
  return {
    total: round2(assessments.reduce((sum, charge) => sum + Number(charge.amount), 0)),
    retained: retainedTotal, direct: directTotal, charge_ids: assessments.map((charge) => charge.id),
    income_entry_ids: [],
    skipped_legacy_ids: assessments.filter((charge) => !charge.ledger_verified).map((charge) => charge.id),
  };
}

export async function settleOrderDelivery(shopId, orderId, payload, userId) {
  try {
    return await orderTransaction(async (trx) => {
      await lockOrderInventory(trx, shopId, orderId);
      const order = await trx('orders')
        .where({ id: orderId, shop_id: shopId, is_deleted: false })
        .forUpdate()
        .first();
      if (!order) throw notFound('Order not found');

      const existingSync = await trx('sync_queue')
        .where({ id: payload.idempotency_key, shop_id: shopId })
        .forUpdate()
        .first();
      if (existingSync) {
        return replayedDeliverySettlement(trx, shopId, orderId, existingSync, payload, userId);
      }

      await trx('sync_queue').insert({
        id: payload.idempotency_key,
        shop_id: shopId,
        user_id: userId || null,
        entity: 'delivery_settlement',
        entity_id: orderId,
        op: 'update',
        payload: JSON.stringify({ request: payload }),
        status: 'processing',
        retry_count: 0,
      });

      const securityAmount = round2(Number(payload.security_amount || 0));
      const receiveAmount = round2(Number(payload.receive_amount || 0));
      const depositAmount = round2(Number(payload.deposit_amount || 0));
      const configuredDeposit = round2(Number(order.deposit_amount || 0));
      const deliversAnyLine = (payload.stage_updates || []).some(
        (update) => update.field === 'delivered' && update.value === true
      );
      if (Math.abs(depositAmount - configuredDeposit) > 0.009) {
        throw badRequest('Change the Security Amount in Booking Edit before delivery');
      }
      if (configuredDeposit <= 0 && securityAmount > 0) {
        throw badRequest('Add a Security Amount in Booking Edit before collecting security');
      }
      if ((securityAmount > 0 || receiveAmount > 0) && !order.customer_id) {
        throw badRequest('Add a customer before recording settlement payments');
      }

      const currentDiscount = round2(Number(order.discount_total || 0));
      if (round2(Number(payload.discount_total || 0)) !== currentDiscount) {
        await adjustOrderDiscountTotalWithTrx(
          trx,
          shopId,
          orderId,
          payload.discount_total,
          userId,
          { recompute: false, hydrate: false }
        );
      }

      const workingOrder = await trx('orders')
        .where({ id: orderId, shop_id: shopId })
        .first('balance', 'paid_amount', 'total_amount');
      const balanceAfterDiscount = round2(
        Number(workingOrder.total_amount || 0) - Number(workingOrder.paid_amount || 0)
      );
      if (receiveAmount > Math.max(0, balanceAfterDiscount)) {
        throw badRequest(
          `Receive amount cannot exceed pending amount (${Math.max(0, balanceAfterDiscount)})`
        );
      }

      await assertLedgerRefs(trx, shopId, {
        payment_account_id: receiveAmount > 0 ? payload.payment_account_id : null,
        security_account_id: securityAmount > 0 ? payload.security_account_id : null,
      });

      const securityHeld = await getSecurityHeld(trx, orderId);
      const securityPending = round2(Math.max(0, depositAmount - securityHeld));
      if (securityAmount > 0 && Math.abs(securityAmount - securityPending) > 0.009) {
        throw badRequest(`Security amount must equal pending security (${securityPending})`);
      }
      if (payload.security_status === 'returned' && securityAmount > 0) {
        throw badRequest('Cannot collect security while marking it returned');
      }
      const heldAfter = round2(securityHeld + securityAmount);
      if (deliversAnyLine && configuredDeposit > 0 && heldAfter < configuredDeposit) {
        throw badRequest(`Collect the full Security Amount (${configuredDeposit}) before delivery`);
      }
      if (payload.security_status === 'paid' && depositAmount > 0 && heldAfter < depositAmount) {
        throw badRequest('Security cannot be marked paid while an amount is pending');
      }
      if (payload.security_status === 'unpaid' && depositAmount > 0 && heldAfter >= depositAmount) {
        throw badRequest('Security is fully collected and must be marked paid');
      }

      await updateOrderSecurityStatusWithTrx(
        trx,
        shopId,
        orderId,
        { status: payload.security_status, deposit_amount: depositAmount },
        userId,
        { hydrate: false }
      );

      const paymentIds = { security_payment_id: null, rent_payment_id: null };
      const paymentBase = {
        shop_id: shopId,
        order_id: orderId,
        customer_id: order.customer_id,
        received_by: userId || null,
        payment_type: 'cash',
        payment_date: payload.payment_date,
        transaction_id: null,
        notes: payload.delivery_remark || null,
      };
      if (securityAmount > 0) {
        paymentIds.security_payment_id = uuid();
        await insertOrderPayment(trx, shopId, {
          ...paymentBase,
          id: paymentIds.security_payment_id,
          category: 'deposit',
          amount: securityAmount,
          payment_account_id: null,
          security_account_id: payload.security_account_id,
        }, 'delivery');
      }
      if (receiveAmount > 0) {
        paymentIds.rent_payment_id = uuid();
        await insertOrderPayment(trx, shopId, {
          ...paymentBase,
          id: paymentIds.rent_payment_id,
          category: receiveAmount >= balanceAfterDiscount ? 'final' : 'partial',
          amount: receiveAmount,
          payment_account_id: payload.payment_account_id,
          security_account_id: null,
        }, 'delivery');
      }

      let stageResult = { order: null, lines: [], batch: { applied: 0 } };
      if (payload.stage_updates.length > 0) {
        stageResult = await batchUpdateOrderStatusFlagsWithTrx(
          trx,
          shopId,
          orderId,
          payload.stage_updates,
          userId,
          { max_updates: 500 }
        );
      }

      if (receiveAmount > 0 || round2(Number(payload.discount_total || 0)) !== currentDiscount) {
        await recomputeOrderPayment(trx, shopId, orderId);
      }

      const finalOrder = await getOrderWithTrx(trx, shopId, orderId);
      await trx('sync_queue')
        .where({ id: payload.idempotency_key, shop_id: shopId })
        .update({
          payload: JSON.stringify({ request: payload, payments: paymentIds }),
          status: 'synced',
          synced_at: trx.fn.now(),
          error: null,
        });

      return {
        order: finalOrder,
        payments: paymentIds,
        stage: stageResult,
        replayed: false,
      };
    });
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
    return orderTransaction(async (trx) => {
      const syncRow = await trx('sync_queue')
        .where({ id: payload.idempotency_key, shop_id: shopId })
        .first();
      if (!syncRow) throw error;
      return replayedDeliverySettlement(trx, shopId, orderId, syncRow, payload, userId);
    });
  }
}

export async function settleOrderReturn(shopId, orderId, payload, userId) {
  return orderTransaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId);
    const order = await trx('orders')
      .where({ id: orderId, shop_id: shopId, is_deleted: false })
      .forUpdate()
      .first();
    if (!order) throw notFound('Order not found');

    const previous = await trx('sync_queue').where({ id: payload.idempotency_key }).forUpdate().first();
    if (previous) {
      const saved = assertSettlementReplay(previous, { shopId, orderId, userId, entity: 'return_settlement', payload });
      return { ...saved.result, order: await getOrderWithTrx(trx, shopId, orderId), replayed: true };
    }
    await trx('sync_queue').insert({
      id: payload.idempotency_key, shop_id: shopId, user_id: userId || null,
      entity: 'return_settlement', entity_id: orderId, op: 'update', status: 'processing',
      payload: JSON.stringify({ request: payload }), retry_count: 0,
    });

    await trx('payments')
      .where({ order_id: orderId, shop_id: shopId, is_deleted: false })
      .forUpdate()
      .select('id');
    const conditionRows = await prepareReturnConditionUpdates(
      trx,
      shopId,
      orderId,
      payload.condition_updates || [],
      payload.stage_updates || []
    );
    await applyReturnConditions(trx, shopId, orderId, conditionRows, userId);
    await assertReturnStageUpdatesCanApply(trx, shopId, orderId, payload.stage_updates || []);

    const receiveAmount = round2(Number(payload.receive_amount || 0));
    const refundAmount = round2(Number(payload.security_refund_amount || 0));
    if (
      (receiveAmount > 0 || refundAmount > 0 || Number(payload.condition_collect_amount || 0) > 0 || Number(payload.condition_retain_amount || 0) > 0) &&
      !order.customer_id
    ) {
      throw badRequest('Add a customer before recording return payments');
    }

    const paymentAccountId = receiveAmount > 0 ? payload.payment_account_id : null;
    const refundPaymentAccountId =
      refundAmount > 0 && payload.refund_via === 'bank_cash'
        ? payload.refund_payment_account_id
        : null;
    const refundSecurityAccountId =
      refundAmount > 0 && payload.refund_via === 'security'
        ? payload.refund_security_account_id
        : null;

    await assertBankOrCashAccount(trx, shopId, paymentAccountId, 'payment account');
    await assertBankOrCashAccount(trx, shopId, refundPaymentAccountId, 'refund account');
    await assertLedgerRefs(trx, shopId, { security_account_id: refundSecurityAccountId });

    const currentDiscount = round2(Number(order.discount_total || 0));
    if (round2(Number(payload.discount_total || 0)) !== currentDiscount) {
      await adjustOrderDiscountTotalWithTrx(trx, shopId, orderId, payload.discount_total, userId, {
        recompute: false,
        hydrate: false,
        reason: 'return settlement',
      });
    }

    const workingOrder = await trx('orders')
      .where({ id: orderId, shop_id: shopId })
      .first('total_amount', 'paid_amount', 'deposit_amount', 'order_number');
    const pendingAmount = round2(
      Math.max(0, Number(workingOrder.total_amount || 0) - Number(workingOrder.paid_amount || 0))
    );
    if (receiveAmount > pendingAmount + 0.009) {
      throw badRequest(`Receive amount cannot exceed pending amount (${pendingAmount})`);
    }

    const securityHeld = await getSecurityHeld(trx, orderId);
    if (refundAmount > securityHeld + 0.009) {
      throw badRequest(`Return amount cannot exceed held security (${securityHeld})`);
    }
    const conditionCharges = await postReturnConditionCharges(trx, {
      shopId,
      order: { ...order, order_number: workingOrder.order_number },
      rows: conditionRows,
      securityHeld,
      refundAmount,
      chargeAccountId: payload.charge_payment_account_id || null,
      retainAmount: payload.condition_retain_amount || 0,
      collectAmount: payload.condition_collect_amount || 0,
      idempotencyKey: payload.idempotency_key,
      paymentDate: payload.payment_date,
      userId,
    });

    const paymentIds = { refund_payment_id: null, rent_payment_id: null };
    const paymentBase = {
      shop_id: shopId,
      order_id: orderId,
      customer_id: order.customer_id,
      received_by: userId || null,
      payment_type: 'cash',
      payment_date: payload.payment_date,
      transaction_id: null,
      notes: payload.return_remark || null,
    };
    if (refundAmount > 0) {
      paymentIds.refund_payment_id = uuid();
      await insertOrderPayment(trx, shopId, {
        ...paymentBase,
        id: paymentIds.refund_payment_id,
        category: 'deposit_refund',
        amount: refundAmount,
        payment_account_id: refundPaymentAccountId,
        security_account_id: refundSecurityAccountId,
      }, 'return');
    }
    if (receiveAmount > 0) {
      paymentIds.rent_payment_id = uuid();
      await insertOrderPayment(trx, shopId, {
        ...paymentBase,
        id: paymentIds.rent_payment_id,
        category: receiveAmount >= pendingAmount ? 'final' : 'partial',
        amount: receiveAmount,
        payment_account_id: paymentAccountId,
        security_account_id: null,
      }, 'return');
    }

    if (Number(workingOrder.deposit_amount || 0) > 0) {
      const remainingSecurity = await getSecurityHeld(trx, orderId);
      await updateOrderSecurityStatusWithTrx(
        trx,
        shopId,
        orderId,
        {
          status: remainingSecurity > 0 ? 'paid' : 'returned',
          deposit_amount: workingOrder.deposit_amount,
        },
        userId,
        { hydrate: false }
      );
    }

    let reminderId = null;
    if (payload.reminder) {
      const reminderTime = normalizeTime12(payload.reminder.reminder_time);
      if (!reminderTime) throw badRequest('Invalid reminder time');
      reminderId = uuid();
      const descriptionBase = `Return · Bill No: ${workingOrder.order_number || orderId}`;
      await trx('reminders').insert({
        id: reminderId,
        shop_id: shopId,
        description: payload.return_remark
          ? `${descriptionBase} · ${payload.return_remark}`
          : descriptionBase,
        assignee: 'SELF',
        reminder_date: payload.reminder.reminder_date,
        reminder_time: reminderTime,
        is_completed: false,
      });
    }

    let stageResult = { order: null, lines: [], batch: { applied: 0 } };
    if (payload.stage_updates.length > 0) {
      stageResult = await batchUpdateOrderStatusFlagsWithTrx(
        trx,
        shopId,
        orderId,
        payload.stage_updates,
        userId,
        { max_updates: 500, reject_skipped: true }
      );
    }

    if (
      receiveAmount > 0 ||
      refundAmount > 0 ||
      round2(Number(payload.discount_total || 0)) !== currentDiscount
    ) {
      await recomputeOrderPayment(trx, shopId, orderId);
    }

    const result = { payments: paymentIds, condition_charges: conditionCharges,
      reminder_id: reminderId, stage: stageResult, replayed: false };
    await trx('sync_queue').where({ id: payload.idempotency_key, shop_id: shopId }).update({
      status: 'synced', synced_at: trx.fn.now(),
      payload: JSON.stringify({ request: payload, result }), error: null,
    });
    return { ...result, order: await getOrderWithTrx(trx, shopId, orderId) };
  });
}

function isRentChecklistLine(row) {
  return String(row?.type || 'rent').toLowerCase() !== 'sell';
}

async function propagateOrderStatus(trx, shopId, orderId) {
  const items = await trx('order_items')
    .where({ order_id: orderId })
    .select('stage_flags', 'missing', 'damaged', 'type');
  const accessories = await trx('order_accessories')
    .where({ order_id: orderId })
    .select('stage_flags', 'type');
  const itemFlags = items.map((r) => normalizeStageFlags(r.stage_flags));
  const accessoryFlags = accessories.map((r) => normalizeAccessoryStageFlags(r.stage_flags));
  const all = [...itemFlags, ...accessoryFlags];
  if (all.length === 0) return;

  const rentItems = items.filter(isRentChecklistLine);
  const rentAccessories = accessories.filter(isRentChecklistLine);
  const rentItemFlags = rentItems.map((r) => normalizeStageFlags(r.stage_flags));
  const rentAccessoryFlags = rentAccessories.map((r) =>
    normalizeAccessoryStageFlags(r.stage_flags)
  );

  // Business rule:
  // Missing/damaged product blocks Returned. Order becomes Returned when all rent products are received
  // (accessories may still be pending). Any unreceived product keeps Delivered. Accessory-only orders
  // use all rent accessories as the rollup gate.
  const hasProductIssue = hasBlockingProductCondition(items);

  const allItemToCollect = itemFlags.length > 0 && itemFlags.every((f) => f.item_to_collect);
  const allPrepared = all.every((f) => f.prepared);
  const allDelivered = all.every((f) => f.delivered);
  const allProductsReceived =
    !hasProductIssue && rentItemFlags.length > 0 && rentItemFlags.every((f) => f.received);
  const allAccessoriesReceived =
    !hasProductIssue &&
    rentItemFlags.length === 0 &&
    rentAccessoryFlags.length > 0 &&
    rentAccessoryFlags.every((f) => f.received);
  const orderReceived = allProductsReceived || allAccessoriesReceived;

  const incomplete = all.filter((f) => !f.delivered);
  const incompleteItemFlags = itemFlags.filter((f) => !f.delivered);
  const incAllPrepared = incomplete.length > 0 && incomplete.every((f) => f.prepared);
  const incAnyPrepared = incomplete.some((f) => f.prepared);
  const incAllItemToCollect =
    incompleteItemFlags.length > 0 && incompleteItemFlags.every((f) => f.item_to_collect);

  let status;
  const patch = {};
  if (orderReceived) {
    status = 'returned';
    patch.returned_at = trx.fn.now();
  } else if (allDelivered) {
    status = 'delivered';
    patch.delivered_at = trx.fn.now();
  } else if (allPrepared) {
    status = 'ready_for_delivery';
    patch.packed_at = trx.fn.now();
    patch.delivered_at = null;
  } else if (allItemToCollect) {
    status = 'item_to_collect';
    patch.delivered_at = null;
    patch.packed_at = null;
  } else if (!allDelivered) {
    if (incAllPrepared) {
      status = 'ready_for_delivery';
      patch.packed_at = trx.fn.now();
      patch.delivered_at = null;
    } else if (incAllItemToCollect) {
      status = 'item_to_collect';
      patch.delivered_at = null;
      patch.packed_at = null;
    } else if (incAnyPrepared) {
      status = 'in_preparation';
      patch.delivered_at = null;
      patch.packed_at = null;
    } else {
      status = 'booked';
      patch.delivered_at = null;
      patch.packed_at = null;
    }
  }

  if (status) {
    await trx('orders')
      .where({ id: orderId, shop_id: shopId })
      .update({ status, ...patch, updated_at: trx.fn.now() });
  }
}

async function nextBillNumber(trx, shopId) {
  const row = await trx('orders').where({ shop_id: shopId }).max('bill_no as max_bill').first();
  return Number(row?.max_bill || 0) + 1;
}

async function resolveItemSalesPersonId(trx, shopId, item, fallbackUserId) {
  const candidate = item.sales_person_id || fallbackUserId || null;
  if (!candidate) return null;
  const row = await trx('users as u')
    .join('users_shops as us', 'us.user_id', 'u.id')
    .where({ 'us.shop_id': shopId, 'u.id': candidate, 'u.is_active': true })
    .first('u.id');
  if (!row) throw badRequest('Invalid salesman for this shop');
  return candidate;
}

function buildItemRow(item, orderId, shopId, options = {}) {
  const lineTotal = round2(
    (Number(item.price || 0) - Number(item.discount || 0)) * Number(item.qty || 1)
  );
  const stageFlags = options.stage_flags || item.stage_flags || DEFAULT_STAGE_FLAGS;
  return {
    id: item.id || uuid(),
    order_id: orderId,
    shop_id: shopId,
    product_id: item.product_id || null,
    name_snapshot: item.name_snapshot || 'Item',
    code_snapshot: item.code_snapshot || null,
    qty: item.qty || 1,
    price: item.price || 0,
    discount: item.discount || 0,
    tax: item.tax || 0,
    line_total: lineTotal,
    type: item.type || 'rent',
    condition: item.condition || 'fresh',
    tailor_notes: item.tailor_notes || null,
    tailor_note_image: item.tailor_note_image || null,
    sales_person_id: item.sales_person_id || null,
    display_order: Number(item.display_order ?? 0),
    stage_flags: JSON.stringify(normalizeStageFlags(stageFlags)),
  };
}

function buildAccessoryRow(item, orderId, shopId, orderItemId, options = {}) {
  const lineTotal = round2(
    (Number(item.price || 0) - Number(item.discount || 0)) * Number(item.qty || 1)
  );
  const stageFlags = options.stage_flags || item.stage_flags || DEFAULT_ACCESSORY_STAGE_FLAGS;
  let givenStatus = 'regular';
  if (item.given_with_rent) givenStatus = 'given_with_rent';
  else if (item.pack_with_rent) givenStatus = 'pack_with_rent';
  const remarks = String(item.remarks ?? '')
    .trim()
    .slice(0, 500);
  return {
    id: item.id || uuid(),
    order_id: orderId,
    shop_id: shopId,
    order_item_id: orderItemId || null,
    accessory_id: item.accessory_id || null,
    name_snapshot: item.name_snapshot || 'Accessory',
    qty: item.qty || 1,
    price: item.price || 0,
    discount: item.discount || 0,
    line_total: lineTotal,
    type: item.type || 'sell',
    given_status: givenStatus,
    remarks: remarks || '',
    display_order: Number(item.display_order ?? 0),
    stage_flags: JSON.stringify(normalizeAccessoryStageFlags(stageFlags)),
  };
}

function linesForComputeTotalsFromDbRows(items, accessories) {
  const lines = [];
  for (const i of items || []) {
    lines.push({
      qty: Number(i.qty || 1),
      price: Number(i.price || 0),
      discount: Number(i.discount || 0),
      tax: Number(i.tax || 0),
    });
  }
  for (const a of accessories || []) {
    lines.push({
      qty: Number(a.qty || 1),
      price: Number(a.price || 0),
      discount: Number(a.discount || 0),
      tax: Number(a.tax || 0),
    });
  }
  return lines;
}

function lineDiscountSumFromDbRows(items, accessories) {
  let d = 0;
  for (const i of items || []) d += Number(i.discount || 0) * Number(i.qty || 1);
  for (const a of accessories || []) d += Number(a.discount || 0) * Number(a.qty || 1);
  return round2(d);
}

function subtotalFromDbRows(items, accessories) {
  let s = 0;
  for (const i of items || []) s += Number(i.price || 0) * Number(i.qty || 1);
  for (const a of accessories || []) s += Number(a.price || 0) * Number(a.qty || 1);
  return round2(s);
}

function computeTotals(data) {
  const items = data.items || [];
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const i of items) {
    const qty = Number(i.qty || 1);
    subtotal += Number(i.price || 0) * qty;
    discount += Number(i.discount || 0) * qty;
    tax += Number(i.tax || 0);
  }
  const bookingDiscountAmount =
    data.booking_discount_type === 'percent'
      ? round2(Math.max(0, subtotal - discount) * (Number(data.booking_discount_value || 0) / 100))
      : round2(Number(data.booking_discount_value || 0));
  const extras = Number(data.extra_charges || 0);
  const core = round2(subtotal - discount - bookingDiscountAmount);
  const taxMode = data.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive';
  const total = taxMode === 'inclusive' ? round2(core + extras) : round2(core + tax + extras);
  return {
    subtotal: round2(subtotal),
    discount_total: round2(discount + bookingDiscountAmount),
    tax_total: round2(tax),
    extra_charges: round2(extras),
    booking_discount_amount: round2(bookingDiscountAmount),
    total_amount: total,
  };
}

function parseJSONSafe(v) {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Map legacy pre_check keys/fields to item_to_collect. */
function normalizeStageField(field) {
  return field === 'pre_check' ? 'item_to_collect' : field;
}

function normalizeStageFlags(raw) {
  const parsed = parseStageFlagsJson(raw);
  return normalizeProductStageFlagsFromParsed(parsed);
}

function normalizeAccessoryStageFlags(raw) {
  const parsed = parseStageFlagsJson(raw);
  return normalizeAccessoryStageFlagsFromParsed(parsed);
}

function canBulkStageTransition(field, nextValue, flags, itemType = 'item') {
  const f = normalizeStageField(field);
  if (!nextValue) return true;
  if (itemType === 'accessory' && f === 'item_to_collect') return false;
  if (f === 'prepared') return itemType === 'accessory' ? true : !!flags.item_to_collect;
  if (field === 'delivered') return !!flags.prepared;
  if (field === 'received') return !!flags.delivered;
  return true;
}

function nullIfEmpty(v) {
  return v === '' || v == null ? null : v;
}

function summarizeSellAccessoryQtyFromItems(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item.item_type !== 'accessory') continue;
    if (String(item.type || 'sell') !== 'sell') continue;
    if (!item.accessory_id) continue;
    map.set(item.accessory_id, (map.get(item.accessory_id) || 0) + Number(item.qty || 1));
  }
  return map;
}

async function summarizeSellAccessoryQtyForOrder(trx, shopId, orderId) {
  const rows = await trx('order_accessories')
    .where({ order_id: orderId, shop_id: shopId, type: 'sell' })
    .whereNotNull('accessory_id')
    .groupBy('accessory_id')
    .select('accessory_id')
    .sum({ qty: 'qty' });
  return new Map(rows.map((row) => [row.accessory_id, Number(row.qty || 0)]));
}

function diffSellAccessoryQtyMaps(nextMap, prevMap) {
  const delta = new Map();
  for (const [accessoryId, qty] of nextMap) {
    delta.set(accessoryId, (delta.get(accessoryId) || 0) + qty);
  }
  for (const [accessoryId, qty] of prevMap) {
    delta.set(accessoryId, (delta.get(accessoryId) || 0) - qty);
  }
  for (const [accessoryId, qty] of [...delta]) {
    if (!qty) delta.delete(accessoryId);
    else delta.set(accessoryId, qty);
  }
  return delta;
}

/**
 * Release every damaged hold an order's accessory lines are holding. Used when
 * the lines are about to stop existing.
 *
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string} orderId
 */
async function releaseDamagedAccessoryHoldsForOrder(trx, shopId, orderId) {
  const lines = await trx('order_accessories')
    .where({ order_id: orderId, shop_id: shopId, type: 'rent' })
    .andWhere((builder) => builder.where('damaged', true).orWhere('missing', true))
    .select('accessory_id', 'qty', 'type', 'damaged', 'missing', 'damaged_qty', 'missing_qty');
  if (!lines.length) return;
  await applyDamagedAccessoryHoldDelta(
    trx,
    shopId,
    lines.map((before) => ({ before, after: null }))
  );
}

async function applySellAccessoryInventoryDelta(trx, shopId, deltaMap) {
  for (const [accessoryId, delta] of deltaMap) {
    const change = Number(delta || 0);
    if (!change) continue;
    const row = await trx('accessories')
      .where({ id: accessoryId, shop_id: shopId, is_active: true })
      .first('id', 'qty', 'spare_qty', 'damaged_qty', 'name');
    if (!row) throw badRequest('Accessory not found for inventory update');
    const spareQty = Math.max(0, Number(row.spare_qty || 0));
    const damagedQty = Math.max(0, Number(row.damaged_qty || 0));
    // Damaged stock is held back the same way the spare reserve is — a sell
    // line must not be able to eat into either.
    const reservedQty = spareQty + damagedQty;
    const rentable = accessoryRentableQty(row);
    const nextQty = Number(row.qty || 0) - change;
    if (nextQty < reservedQty) {
      throw badRequest(
        formatAccessoryQtyExceededMessage(
          row.name || 'Accessory',
          change,
          rentable,
          spareQty,
          'sell',
          damagedQty
        )
      );
    }
    if (nextQty < 0) throw badRequest('Insufficient accessory stock for sell item');
    await trx('accessories')
      .where({ id: accessoryId, shop_id: shopId })
      .update({ qty: nextQty, updated_at: trx.fn.now() });
  }
}

const SELL_PRODUCT_BLOCKED_STATUSES = new Set(['repair', 'lost', 'sold']);

function summarizeSellProductQtyFromItems(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item.item_type === 'accessory') continue;
    if (String(item.type || 'rent') !== 'sell') continue;
    if (!item.product_id) continue;
    map.set(item.product_id, (map.get(item.product_id) || 0) + Number(item.qty || 1));
  }
  return map;
}

async function summarizeSellProductQtyForOrder(trx, shopId, orderId) {
  const rows = await trx('order_items')
    .where({ order_id: orderId, shop_id: shopId, type: 'sell' })
    .whereNotNull('product_id')
    .groupBy('product_id')
    .select('product_id')
    .sum({ qty: 'qty' });
  return new Map(rows.map((row) => [row.product_id, Number(row.qty || 0)]));
}

async function applySellProductInventoryDelta(trx, shopId, deltaMap) {
  for (const [productId, delta] of deltaMap) {
    const change = Number(delta || 0);
    if (!change) continue;
    const row = await trx('products')
      .where({ id: productId, shop_id: shopId, is_active: true })
      .first('id', 'qty', 'status');
    if (!row) throw badRequest('Product not found for inventory update');

    if (change > 0) {
      const status = String(row.status || 'available').toLowerCase();
      if (SELL_PRODUCT_BLOCKED_STATUSES.has(status)) {
        throw badRequest(`Product cannot be sold (status: ${status})`);
      }
      const nextQty = Number(row.qty || 0) - change;
      if (nextQty < 0) throw badRequest('Insufficient product stock for sell item');
      const patch = { qty: Math.max(0, nextQty), updated_at: trx.fn.now() };
      if (nextQty <= 0) patch.status = 'sold';
      await trx('products').where({ id: productId, shop_id: shopId }).update(patch);
      continue;
    }

    const restoreQty = Math.abs(change);
    const nextQty = Number(row.qty || 0) + restoreQty;
    const patch = { qty: nextQty, updated_at: trx.fn.now() };
    if (String(row.status || '').toLowerCase() === 'sold') {
      patch.status = 'available';
    }
    await trx('products').where({ id: productId, shop_id: shopId }).update(patch);
  }
}

async function getOrderWithTrx(trx, shopId, id) {
  const order = await trx('orders').where({ id, shop_id: shopId }).first();
  if (!order) throw notFound('Order not found');
  const [items, accessories, payments, customer] = await Promise.all([
    trx('order_items as oi')
      .leftJoin('products as p', 'p.id', 'oi.product_id')
      .where('oi.order_id', id)
      .select(
        'oi.*',
        'p.main_image as main_image',
        'p.code as product_code',
        'p.price_sell as catalog_price_sell'
      )
      .orderBy(['oi.display_order', 'oi.created_at']),
    trx('order_accessories as oa')
      .leftJoin('accessories as a', 'a.id', 'oa.accessory_id')
      .leftJoin('categories as cat', 'cat.id', 'a.category_id')
      .leftJoin('order_items as oi_link', 'oi_link.id', 'oa.order_item_id')
      .leftJoin('products as p_link', 'p_link.id', 'oi_link.product_id')
      .leftJoin('product_category_accessory_categories as pca', function joinPca() {
        this.on('pca.accessory_category_id', '=', 'a.category_id').andOn(
          'pca.product_category_id',
          '=',
          'p_link.category_id'
        );
      })
      .where('oa.order_id', id)
      .select(
        'oa.*',
        'a.image_url as image_url',
        'a.category_id as category_id',
        'cat.label as category_name',
        trx.raw('a.price_rent as catalog_price_rent'),
        trx.raw('a.price_sell as catalog_price_sell'),
        trx.raw('a.qty as catalog_qty'),
        trx.raw('pca.display_order as category_display_order')
      )
      .orderBy(['oa.display_order', 'oa.created_at']),
    trx('payments as p')
      .leftJoin('payment_accounts as pa', function joinPa() {
        this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
      })
      .leftJoin('security_accounts as sa', function joinSa() {
        this.on('sa.shop_id', '=', 'p.shop_id').andOn('sa.id', '=', 'p.security_account_id');
      })
      .where('p.order_id', id)
      .andWhere('p.is_deleted', false)
      .select(
        'p.*',
        trx.raw('pa.name as payment_account_name'),
        trx.raw('sa.name as security_account_name')
      )
      .orderBy('p.payment_date', 'desc'),
    order.customer_id
      ? trx('customers').where({ id: order.customer_id, shop_id: shopId }).first()
      : Promise.resolve(null),
  ]);
  for (const i of items) {
    i.stage_flags = normalizeStageFlags(i.stage_flags);
    if (!i.code_snapshot && i.product_code) i.code_snapshot = i.product_code;
    delete i.product_code;
  }
  for (const a of accessories) a.stage_flags = normalizeAccessoryStageFlags(a.stage_flags);
  await attachOrderItemsLineAvailability(shopId, order, items, trx);
  const pendingCombined = await trx('security_charges')
    .where({
      shop_id: shopId,
      order_id: id,
      source: 'checklist',
      status: 'pending',
    })
    .whereNull('item_id')
    .whereNull('item_type')
    .select('amount', 'remarks')
    .first();

  const orderPayload = {
    ...order,
    items,
    accessories,
    payments,
    customer: customer || null,
    pending_checklist_combined_charge: pendingCombined
      ? {
          amount: Number(pendingCombined.amount || 0),
          remarks: pendingCombined.remarks || null,
        }
      : null,
  };
  orderPayload.security_held_amount = await getSecurityHeld(trx, id);
  orderPayload.checklist_state_token = await readChecklistStateToken(trx, shopId, id, orderPayload);
  orderPayload.ordinary_security_net = await getOrdinarySecurityNet(trx, shopId, id);
  orderPayload.replacement_requirements = await listOrderReplacementRequirements(trx, shopId, id);
  await attachNextBookingAlerts(trx, shopId, orderPayload);
  return orderPayload;
}
