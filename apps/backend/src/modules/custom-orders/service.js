import {
  APP_SETTINGS_REGISTRY,
  buildAppSettingsMap,
  buildOrderNumber,
  getAppSettingValue,
  buildCustomOrderTrialReminderDismissPatch,
  getCustomOrderTrialReminderEntry,
  isCustomOrderTrialDashboardEligible,
  isCustomOrderTrialOverdue,
  normalizeCustomOrderMeasurements,
  normalizeCustomOrderRetrials,
  normalizeOrderNumberPrefix,
  normalizeCustomOrderSqlDate,
  normalizeProductCode,
  toLocalISODate,
  computeCustomOrderTotals,
  validateCustomOrderMeasurements,
  validateCustomOrderForCompletion,
  validateCustomOrderPaymentAccounts,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { listCustomOrderFieldDefinitions } from '../custom-order-fields/service.js';
import { createProduct, generateNextProductCode, getProduct } from '../products/service.js';

const SEARCH_FIELDS = [
  'co.order_number',
  'co.customer_name',
  'co.customer_phone',
  'co.design_name',
  'co.product_name',
  'co.generated_product_code',
];

const SEQ_KEY = 'custom_order.next_sequence';

async function loadAppSettingsMap(shopId) {
  const keys = APP_SETTINGS_REGISTRY.map((r) => r.key);
  const rows = await knex('settings').where({ shop_id: shopId }).whereIn('key', keys);
  return buildAppSettingsMap(rows);
}

async function getCustomOrderPrefix(shopId) {
  const map = await loadAppSettingsMap(shopId);
  const raw = getAppSettingValue(map, 'CUSTOM_ORDER_NUMBER_PREFIX');
  return normalizeOrderNumberPrefix(raw) || 'CO';
}

async function nextCustomOrderSequence(trx, shopId) {
  let row = await trx('settings')
    .where({ shop_id: shopId, key: SEQ_KEY })
    .forUpdate()
    .first();

  if (!row) {
    const maxRow = await trx('custom_orders')
      .where({ shop_id: shopId })
      .select(knex.raw('COUNT(*) as c'))
      .first();
    const count = Number(maxRow?.c || 0);
    let start = 1;
    if (count > 0) {
      const last = await trx('custom_orders')
        .where({ shop_id: shopId })
        .orderBy('created_at', 'desc')
        .select('order_number')
        .first();
      const m = String(last?.order_number || '').match(/-(\d+)$/);
      if (m) start = Number(m[1]) + 1;
    }
    await trx('settings').insert({
      id: uuid(),
      shop_id: shopId,
      key: SEQ_KEY,
      value: String(start + 1),
    });
    return start;
  }

  const n = Math.max(1, Number(row.value) || 1);
  await trx('settings').where({ shop_id: shopId, key: SEQ_KEY }).update({ value: String(n + 1) });
  return n;
}

/** @param {unknown} raw */
function parseJsonArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** @param {unknown} raw */
function parseMeasurements(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** @param {unknown} raw */
function parseRetrials(raw) {
  if (raw == null) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      date: r.date || null,
      notes: r.notes != null && String(r.notes).trim() ? String(r.notes).trim() : null,
    }));
}

/** @param {unknown} value */
function mapSqlDateField(value) {
  if (value == null || value === '') return null;
  const normalized = normalizeCustomOrderSqlDate(value);
  return normalized || null;
}

/** @param {object} row */
function mapCustomOrderRow(row) {
  if (!row) return row;
  return {
    ...row,
    given_to_tailor: !!row.given_to_tailor,
    delivery_date: mapSqlDateField(row.delivery_date),
    return_date: mapSqlDateField(row.return_date),
    marriage_date: mapSqlDateField(row.marriage_date),
    order_date: mapSqlDateField(row.order_date),
    order_time: row.order_time != null && String(row.order_time).trim()
      ? String(row.order_time).trim()
      : null,
    tailor_date: mapSqlDateField(row.tailor_date),
    trial_date: mapSqlDateField(row.trial_date),
    trial_product:
      row.trial_product != null && String(row.trial_product).trim()
        ? String(row.trial_product).trim()
        : null,
    trial_reminder_dismissed_date: mapSqlDateField(row.trial_reminder_dismissed_date),
    measurements: parseMeasurements(row.measurements),
    design_images: parseJsonArray(row.design_images),
    trial_images: parseJsonArray(row.trial_images),
    retrials: parseRetrials(row.retrials),
  };
}

/** Prefer rental booking order_number (e.g. MAHAVIR-0043) over numeric bill_no (43). */
function linkedBookingDisplayNumber(row) {
  const orderNumber = String(row?.linked_order_number || '').trim();
  if (orderNumber) return orderNumber;
  const billNo = row?.linked_bill_no_num ?? row?.linked_bill_no;
  if (billNo != null && billNo !== '') return String(billNo);
  return null;
}

/** @param {object} row */
function mapCustomOrderRowWithLinkedBooking(row) {
  const mapped = mapCustomOrderRow(row);
  mapped.linked_bill_no = linkedBookingDisplayNumber(row);
  return mapped;
}

function buildListQb(shopId, query) {
  const qb = knex('custom_orders as co').where({ 'co.shop_id': shopId });

  if (query.status) qb.where('co.status', query.status);
  if (query.order_date_from) qb.where('co.order_date', '>=', query.order_date_from);
  if (query.order_date_to) qb.where('co.order_date', '<=', query.order_date_to);
  if (query.delivery_date_from) qb.where('co.delivery_date', '>=', query.delivery_date_from);
  if (query.delivery_date_to) qb.where('co.delivery_date', '<=', query.delivery_date_to);

  return qb;
}

async function assertMeasurementsValid(shopId, measurements) {
  const defs = await listCustomOrderFieldDefinitions(shopId);
  const v = validateCustomOrderMeasurements(defs, measurements);
  if (!v.ok) throw badRequest(v.message);
}

async function getGstDefaultRate(shopId) {
  const map = await loadAppSettingsMap(shopId);
  const raw = getAppSettingValue(map, 'GST_PERCENTAGE');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function pickFinancialInput(body, existing, key, fallback = 0) {
  if (body[key] !== undefined) return body[key];
  if (existing?.[key] !== undefined && existing?.[key] !== null) return existing[key];
  return fallback;
}

/**
 * @param {object} body
 * @param {object|null|undefined} existing
 * @param {number} gstPercent
 */
function financialFromBody(body, existing, gstPercent) {
  const merged = {
    price: pickFinancialInput(body, existing, 'price', 0),
    line_discount: pickFinancialInput(body, existing, 'line_discount', 0),
    order_type: pickFinancialInput(body, existing, 'order_type', 'rent'),
    tax_mode: pickFinancialInput(body, existing, 'tax_mode', 'exclusive'),
    gst_enabled: pickFinancialInput(body, existing, 'gst_enabled', true),
    igst_bill: pickFinancialInput(body, existing, 'igst_bill', false),
    booking_discount_type: pickFinancialInput(body, existing, 'booking_discount_type', 'flat'),
    booking_discount_value: pickFinancialInput(body, existing, 'booking_discount_value', 0),
    advance_amount: pickFinancialInput(body, existing, 'advance_amount', 0),
    deposit_amount: pickFinancialInput(body, existing, 'deposit_amount', 0),
    paid_security_amt: pickFinancialInput(body, existing, 'paid_security_amt', false),
    advance_account_id: pickFinancialInput(body, existing, 'advance_account_id', null),
    security_account_id: pickFinancialInput(body, existing, 'security_account_id', null),
    apply_credit_amount: pickFinancialInput(body, existing, 'apply_credit_amount', 0),
  };

  const totals = computeCustomOrderTotals(merged, { gstPercent });

  return {
    price: roundMoney(merged.price),
    line_discount: roundMoney(merged.line_discount),
    order_type: merged.order_type === 'sell' ? 'sell' : 'rent',
    tax_mode: merged.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
    gst_enabled: !!merged.gst_enabled,
    igst_bill: !!merged.igst_bill,
    booking_discount_type: merged.booking_discount_type === 'percent' ? 'percent' : 'flat',
    booking_discount_value: roundMoney(merged.booking_discount_value),
    booking_discount_amount: totals.booking_discount_amount,
    subtotal: totals.subtotal,
    discount_total: totals.discount_total,
    tax_total: totals.tax_total,
    total_amount: totals.total_amount,
    advance_amount: roundMoney(merged.advance_amount),
    deposit_amount: roundMoney(merged.deposit_amount),
    paid_security_amt: !!merged.paid_security_amt,
    advance_account_id: merged.advance_account_id || null,
    security_account_id: merged.security_account_id || null,
    apply_credit_amount: roundMoney(merged.apply_credit_amount),
    paid_amount: totals.paid_amount,
    balance: totals.balance,
    payment_status: totals.payment_status,
  };
}

function rowFromBody(body, userId, existing = null) {
  return {
    status: body.status ?? existing?.status ?? 'in_progress',
    customer_id: body.customer_id ?? existing?.customer_id ?? null,
    customer_name: body.customer_name ?? existing?.customer_name,
    customer_phone: body.customer_phone ?? existing?.customer_phone ?? null,
    customer_phone2: body.customer_phone2 ?? existing?.customer_phone2 ?? null,
    customer_phone2_name: body.customer_phone2_name ?? existing?.customer_phone2_name ?? null,
    customer_whatsapp: body.customer_whatsapp ?? existing?.customer_whatsapp ?? null,
    customer_whatsapp_source: body.customer_whatsapp_source ?? existing?.customer_whatsapp_source ?? null,
    customer_address: body.customer_address ?? existing?.customer_address ?? null,
    delivery_date: body.delivery_date ?? existing?.delivery_date ?? null,
    return_date: body.return_date ?? existing?.return_date ?? null,
    marriage_date: body.marriage_date ?? existing?.marriage_date ?? null,
    order_date: body.order_date ?? existing?.order_date ?? null,
    order_time: body.order_time ?? existing?.order_time ?? null,
    design_name: body.design_name ?? existing?.design_name ?? null,
    category_id: body.category_id ?? existing?.category_id ?? null,
    product_name: body.product_name ?? existing?.product_name ?? null,
    color: body.color ?? existing?.color ?? null,
    size: body.size ?? existing?.size ?? null,
    remarks: body.remarks ?? existing?.remarks ?? null,
    given_to_tailor: body.given_to_tailor ?? existing?.given_to_tailor ?? false,
    tailor_name: body.tailor_name ?? existing?.tailor_name ?? null,
    tailor_date: body.tailor_date ?? existing?.tailor_date ?? null,
    trial_date: body.trial_date ?? existing?.trial_date ?? null,
    trial_product:
      body.trial_product !== undefined
        ? body.trial_product?.trim() || null
        : existing?.trial_product ?? null,
    retrials:
      body.retrials != null
        ? JSON.stringify(normalizeCustomOrderRetrials(body.retrials))
        : existing?.retrials != null
          ? JSON.stringify(normalizeCustomOrderRetrials(existing.retrials))
          : JSON.stringify([]),
    measurements:
      body.measurements != null
        ? JSON.stringify(normalizeCustomOrderMeasurements(body.measurements))
        : existing?.measurements != null
          ? JSON.stringify(existing.measurements)
          : null,
    design_images:
      body.design_images != null
        ? JSON.stringify(body.design_images)
        : existing?.design_images != null
          ? JSON.stringify(existing.design_images)
          : JSON.stringify([]),
    trial_images:
      body.trial_images != null
        ? JSON.stringify(body.trial_images)
        : existing?.trial_images != null
          ? JSON.stringify(existing.trial_images)
          : JSON.stringify([]),
    updated_by: userId || null,
  };
}

/**
 * @param {string} shopId
 * @param {object} body
 * @param {string|null|undefined} userId
 * @param {object|null|undefined} existing
 */
async function rowFromBodyWithFinancials(shopId, body, userId, existing = null) {
  const base = rowFromBody(body, userId, existing);
  if (existing?.linked_order_id) {
    return base;
  }
  const gstPercent = await getGstDefaultRate(shopId);
  return { ...base, ...financialFromBody(body, existing, gstPercent) };
}

export async function listCustomOrders(shopId, query) {
  const qb = buildListQb(shopId, query)
    .leftJoin('orders as lo', 'lo.id', 'co.linked_order_id')
    .select('co.*', 'lo.order_number as linked_order_number', 'lo.bill_no as linked_bill_no_num');
  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-co.created_at',
    search_fields: SEARCH_FIELDS,
  });
  result.data = (result.data || []).map((row) => mapCustomOrderRowWithLinkedBooking(row));
  return result;
}

export async function getCustomOrder(shopId, id) {
  const row = await knex('custom_orders as co')
    .leftJoin('orders as lo', 'lo.id', 'co.linked_order_id')
    .where({ 'co.shop_id': shopId, 'co.id': id })
    .select('co.*', 'lo.order_number as linked_order_number', 'lo.bill_no as linked_bill_no_num')
    .first();
  if (!row) throw notFound('Custom order not found');
  return mapCustomOrderRowWithLinkedBooking(row);
}

export async function createCustomOrder(shopId, body, userId) {
  await assertMeasurementsValid(shopId, body.measurements || {});

  if (body.status === 'completed') {
    const v = validateCustomOrderForCompletion(body);
    if (!v.ok) throw badRequest(v.message);
  }

  const paymentAccounts = validateCustomOrderPaymentAccounts(body);
  if (!paymentAccounts.ok) throw badRequest(paymentAccounts.message);

  const id = await knex.transaction(async (trx) => {
    const prefix = await getCustomOrderPrefix(shopId);
    const seq = await nextCustomOrderSequence(trx, shopId);
    const orderNumber = buildOrderNumber({ prefix, sequence: seq });
    const newId = uuid();
    const patch = await rowFromBodyWithFinancials(shopId, body, userId);

    await trx('custom_orders').insert({
      id: newId,
      shop_id: shopId,
      order_number: orderNumber,
      ...patch,
      created_by: userId || null,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    return newId;
  });

  return getCustomOrder(shopId, id);
}

export async function updateCustomOrder(shopId, id, body, userId) {
  const existing = await getCustomOrder(shopId, id);
  if (existing.status === 'cancelled') {
    throw badRequest('Cancelled orders cannot be edited');
  }

  if (body.measurements != null) {
    await assertMeasurementsValid(shopId, body.measurements);
  }

  const nextStatus = body.status ?? existing.status;
  const becomingCompleted = nextStatus === 'completed' && existing.status !== 'completed';
  if (becomingCompleted) {
    const merged = { ...existing, ...body, status: nextStatus };
    const v = validateCustomOrderForCompletion(merged);
    if (!v.ok) throw badRequest(v.message);
  }

  if (!existing.linked_order_id) {
    const paymentAccounts = validateCustomOrderPaymentAccounts({ ...existing, ...body });
    if (!paymentAccounts.ok) throw badRequest(paymentAccounts.message);
  }

  const patch = await rowFromBodyWithFinancials(shopId, body, userId, existing);
  if (body.trial_date !== undefined || body.retrials !== undefined) {
    patch.trial_reminder_dismissed_date = null;
    patch.trial_reminder_dismissed_kind = null;
  }
  await knex('custom_orders')
    .where({ shop_id: shopId, id })
    .update({ ...patch, updated_at: knex.fn.now() });

  return getCustomOrder(shopId, id);
}

/**
 * Allocate the next product code at save time; honor manual override only when flagged.
 * @param {string} shopId
 * @param {string|null|undefined} categoryId
 * @param {string} size
 * @param {Record<string, unknown>} overrides
 */
async function allocateProductCodeForCustomOrder(shopId, categoryId, size, overrides) {
  const { code: allocatedCode } = await generateNextProductCode(shopId, categoryId, size);
  const codeIsManual = overrides.code_is_manual === true;

  if (!codeIsManual || overrides.code == null || String(overrides.code).trim() === '') {
    return allocatedCode;
  }

  const requested = normalizeProductCode(String(overrides.code).trim());
  if (!requested || requested === allocatedCode) {
    return allocatedCode;
  }

  const taken = await knex('products').where({ shop_id: shopId, code: requested }).first('id');
  return taken ? allocatedCode : requested;
}

/**
 * @param {string} shopId
 * @param {string} customOrderId
 * @param {string|null|undefined} userId
 * @param {Record<string, unknown>} [overrides]
 */
export async function createProductFromCustomOrder(shopId, customOrderId, userId, overrides = {}) {
  const order = await getCustomOrder(shopId, customOrderId);
  if (order.status === 'cancelled') {
    throw badRequest('Product cannot be created for a cancelled custom order');
  }

  if (order.linked_product_id) {
    const product = await getProduct(shopId, order.linked_product_id);
    return { custom_order: order, product };
  }

  const categoryId = overrides.category_id ?? order.category_id;
  const size = String(overrides.size ?? order.size ?? '').trim();
  const name = String(
    overrides.name ?? order.product_name ?? order.design_name ?? ''
  ).trim();

  const mergedForValidation = {
    ...order,
    category_id: categoryId,
    product_name: name,
  };
  const v = validateCustomOrderForCompletion(mergedForValidation);
  if (!v.ok) throw badRequest(v.message);

  if (!name) {
    throw badRequest('Product name is required to create inventory');
  }

  const code = await allocateProductCodeForCustomOrder(shopId, categoryId, size, overrides);

  const designImages = parseJsonArray(order.design_images);
  const trialImages = parseJsonArray(order.trial_images);
  const defaultPhotos = [...designImages, ...trialImages].filter(Boolean);
  const photos =
    overrides.photos != null ? parseJsonArray(overrides.photos) : defaultPhotos;
  const mainImage =
    overrides.main_image != null && String(overrides.main_image).trim()
      ? String(overrides.main_image).trim()
      : photos[0] || null;
  const notes =
    overrides.notes !== undefined
      ? overrides.notes != null && String(overrides.notes).trim()
        ? String(overrides.notes).trim()
        : null
      : String(order.design_name || '').trim() || null;
  const color =
    overrides.color !== undefined ? overrides.color : order.color || null;
  const qty = overrides.qty != null ? Number(overrides.qty) : 1;
  const productType = overrides.type || (order.order_type === 'sell' ? 'sell' : 'rent');
  const unitPrice = roundMoney(Number(order.price || 0));
  const priceRent = productType === 'sell' ? 0 : unitPrice;
  const priceSell = productType === 'sell' || productType === 'both' ? unitPrice : 0;

  const product = await createProduct(shopId, {
    category_id: categoryId,
    name,
    code,
    type: productType,
    color,
    size: size || null,
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    price_rent: priceRent,
    price_sell: priceSell,
    status: 'available',
    main_image: mainImage,
    photos,
    notes,
    is_active: true,
  });

  await knex('custom_orders')
    .where({ shop_id: shopId, id: customOrderId })
    .update({
      linked_product_id: product.id,
      generated_product_code: code,
      category_id: categoryId,
      product_name: name,
      color,
      size: size || null,
      updated_by: userId || null,
      updated_at: knex.fn.now(),
    });

  const updated = await getCustomOrder(shopId, customOrderId);
  return { custom_order: updated, product };
}

export async function linkCustomOrderBooking(shopId, customOrderId, orderId, userId) {
  const order = await getCustomOrder(shopId, customOrderId);
  const booking = await knex('orders')
    .where({ id: orderId, shop_id: shopId, is_deleted: false })
    .first('id');
  if (!booking) throw notFound('Booking not found');

  if (order.linked_order_id && order.linked_order_id !== orderId) {
    throw badRequest('Custom order is already linked to another booking');
  }

  await knex('custom_orders')
    .where({ shop_id: shopId, id: customOrderId })
    .update({
      linked_order_id: orderId,
      updated_by: userId || null,
      updated_at: knex.fn.now(),
    });

  return getCustomOrder(shopId, customOrderId);
}

export async function dismissCustomOrderTrialReminder(shopId, id, userId) {
  const existing = await getCustomOrder(shopId, id);
  if (existing.status === 'cancelled') {
    throw badRequest('Cancelled orders cannot be updated');
  }
  const dismiss = buildCustomOrderTrialReminderDismissPatch(existing);
  if (!dismiss) {
    throw badRequest('No trial or re-trial reminder to mark complete');
  }

  await knex('custom_orders')
    .where({ shop_id: shopId, id })
    .update({
      trial_reminder_dismissed_date: dismiss.trial_reminder_dismissed_date,
      trial_reminder_dismissed_kind: dismiss.trial_reminder_dismissed_kind,
      updated_by: userId || null,
      updated_at: knex.fn.now(),
    });

  return getCustomOrder(shopId, id);
}

export async function cancelCustomOrder(shopId, id, userId) {
  const existing = await getCustomOrder(shopId, id);
  if (existing.status === 'cancelled') return existing;

  await knex('custom_orders')
    .where({ shop_id: shopId, id })
    .update({
      status: 'cancelled',
      updated_by: userId || null,
      updated_at: knex.fn.now(),
    });

  return getCustomOrder(shopId, id);
}

export async function listCustomOrderTrialReminders(shopId) {
  const todayIso = toLocalISODate(new Date());

  const rows = await knex('custom_orders as co')
    .where({ 'co.shop_id': shopId })
    .whereNotIn('co.status', ['completed', 'cancelled'])
    .andWhere(function filterTrialOrRetrial() {
      this.whereNotNull('co.trial_date').orWhereNotNull('co.retrials');
    })
    .select('co.*');

  const data = [];
  for (const row of rows) {
    const mapped = mapCustomOrderRow(row);
    if (!isCustomOrderTrialDashboardEligible(mapped)) continue;
    const entry = getCustomOrderTrialReminderEntry(mapped);
    if (!entry) continue;
    data.push({
      ...mapped,
      reminder_date: entry.date,
      reminder_time: null,
      reminder_kind: entry.kind,
      is_overdue: isCustomOrderTrialOverdue(entry, todayIso),
    });
  }

  data.sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    const byDate = String(a.reminder_date).localeCompare(String(b.reminder_date));
    if (byDate !== 0) return byDate;
    return String(a.order_number || '').localeCompare(String(b.order_number || ''));
  });

  return {
    data,
    meta: {
      total: data.length,
      overdue_count: data.filter((r) => r.is_overdue).length,
    },
  };
}
