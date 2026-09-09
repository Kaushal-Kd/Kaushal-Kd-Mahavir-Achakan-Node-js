/**
 * Normalize audit snapshots before diff/store so unchanged lines do not appear as modified.
 */
import {
  normalizeAccessoryStageFlagsFromParsed,
  normalizeProductStageFlagsFromParsed,
  parseStageFlagsJson,
} from '@wrs/shared';

const MONEY_KEYS = new Set([
  'subtotal',
  'discount_total',
  'tax_total',
  'total_amount',
  'advance_amount',
  'paid_amount',
  'balance',
  'deposit_amount',
  'amount',
  'net_amount',
  'payable_amount',
  'discount_amount',
  'booking_discount_amount',
  'booking_discount_value',
]);

const VOLATILE_BILL_KEYS = new Set([
  'created_at',
  'updated_at',
  'created_by',
  'user_id',
  'user_name',
  'main_image',
  'image_url',
  'catalog_qty',
  'catalog_price_rent',
  'catalog_price_sell',
  'product_catalog_notes',
  'category_display_order',
  'payments',
  'customer',
  'items',
  'accessories',
  'pending_checklist_combined_charge',
  'next_booking_alert',
  'next_booking_alerts',
  'gap_days',
  'next_pickup_date',
  'next_order_id',
  'next_order_number',
  'free_qty',
  'booked_qty',
  'total_qty',
  'in_delivery_qty',
  'return_pending_qty',
  'washing_qty',
  'repair_qty',
  'can_book',
  'next_available_date',
]);

function round2(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function normStr(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s || null;
}

function normMoney(v) {
  if (v == null || v === '') return null;
  return round2(v);
}

function normQty(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function normProductStageFlags(raw) {
  return normalizeProductStageFlagsFromParsed(parseStageFlagsJson(raw));
}

function normAccessoryStageFlags(raw) {
  return normalizeAccessoryStageFlagsFromParsed(parseStageFlagsJson(raw));
}

function effectiveSalesPersonId(line, orderSalesPersonId) {
  const lineId = line?.sales_person_id;
  if (lineId != null && String(lineId).trim() !== '') return String(lineId).trim();
  if (orderSalesPersonId != null && String(orderSalesPersonId).trim() !== '') {
    return String(orderSalesPersonId).trim();
  }
  return null;
}

function lineNameSnapshot(line, fallbackKey) {
  return normStr(line?.name_snapshot || line?.[fallbackKey] || line?.product_name || line?.name);
}

/** @param {object} line @param {boolean} stageOnly @param {string|null} orderSalesPersonId */
function normalizeBookingItemLine(line, stageOnly, orderSalesPersonId) {
  const code = normStr(line?.code_snapshot || line?.product_code || line?.code);
  const name = lineNameSnapshot(line, 'product_name');
  const stageFlags = normProductStageFlags(line?.stage_flags);

  if (stageOnly) {
    return {
      id: line?.id,
      product_id: line?.product_id || null,
      code,
      name_snapshot: name,
      stage_flags: stageFlags,
    };
  }

  return {
    id: line?.id,
    product_id: line?.product_id || null,
    code,
    name_snapshot: name,
    qty: normQty(line?.qty),
    rent: normMoney(line?.price ?? line?.rent),
    discount: normMoney(line?.discount),
    type: normStr(line?.type) || 'rent',
    sales_person_id: effectiveSalesPersonId(line, orderSalesPersonId),
    remarks: normStr(line?.remarks),
    stage_flags: stageFlags,
  };
}

/** @param {object} line @param {boolean} stageOnly */
function normalizeBookingAccessoryLine(line, stageOnly) {
  const code = normStr(line?.code_snapshot);
  const name = lineNameSnapshot(line, 'accessory_name');
  const stageFlags = normAccessoryStageFlags(line?.stage_flags);

  if (stageOnly) {
    return {
      id: line?.id,
      accessory_id: line?.accessory_id || null,
      code,
      name_snapshot: name,
      stage_flags: stageFlags,
    };
  }

  return {
    id: line?.id,
    accessory_id: line?.accessory_id || null,
    code,
    name_snapshot: name,
    category_name: normStr(line?.category_name),
    qty: normQty(line?.qty),
    rent: normMoney(line?.price ?? line?.rent),
    sell_price: normMoney(line?.sell_price ?? line?.price_sell),
    discount: normMoney(line?.discount),
    type: normStr(line?.type) || 'rent',
    remarks: normStr(line?.remarks),
    stage_flags: stageFlags,
  };
}

function normalizeBookingBillSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const order = snapshot.order && typeof snapshot.order === 'object' ? { ...snapshot.order } : {};
  for (const key of Object.keys(order)) {
    if (MONEY_KEYS.has(key)) order[key] = normMoney(order[key]);
    if (key === 'sales_person_name') delete order[key];
  }
  const customer =
    snapshot.customer && typeof snapshot.customer === 'object'
      ? {
          id: snapshot.customer.id,
          name: normStr(snapshot.customer.name),
          phone1: normStr(snapshot.customer.phone1 || snapshot.customer.phone),
          phone: normStr(snapshot.customer.phone1 || snapshot.customer.phone),
          phone2: normStr(snapshot.customer.phone2),
          email: normStr(snapshot.customer.email),
          address: normStr(snapshot.customer.address),
        }
      : null;
  return { order, customer };
}

function normalizeBookingProductSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const orderSalesPersonId = snapshot._order_sales_person_id || null;
  const stageOnly = !!snapshot._stage_only;
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.map((line) => normalizeBookingItemLine(line, stageOnly, orderSalesPersonId))
    : [];
  const accessories = Array.isArray(snapshot.accessories)
    ? snapshot.accessories.map((line) => normalizeBookingAccessoryLine(line, stageOnly))
    : [];
  return { items, accessories };
}

function normalizeSaleProductSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.map((line) => ({
        id: line?.id,
        product_id: line?.product_id || null,
        accessory_id: line?.accessory_id || null,
        description: normStr(line?.description || line?.name_snapshot),
        qty: normQty(line?.qty),
        rate: normMoney(line?.rate ?? line?.price),
        amount: normMoney(line?.amount ?? line?.total_amount),
      }))
    : [];
  return { items };
}

function stripVolatileKeys(obj, extraVolatile = new Set()) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (VOLATILE_BILL_KEYS.has(key) || extraVolatile.has(key)) continue;
    if (MONEY_KEYS.has(key)) {
      out[key] = normMoney(val);
      continue;
    }
    if (Array.isArray(val)) {
      out[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? stripVolatileKeys(item, extraVolatile)
          : item
      );
      continue;
    }
    if (val && typeof val === 'object') {
      out[key] = stripVolatileKeys(val, extraVolatile);
      continue;
    }
    out[key] = val;
  }
  return out;
}

function normalizeGenericBillSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return stripVolatileKeys(snapshot);
}

/**
 * @param {string} module
 * @param {'bill'|'product'} kind
 * @param {unknown} snapshot
 * @returns {unknown}
 */
export function normalizeSnapshotForDiff(module, kind, snapshot) {
  if (snapshot == null) return null;
  const mod = String(module || '').toLowerCase();

  if (mod === 'booking') {
    if (kind === 'bill') return normalizeBookingBillSnapshot(snapshot);
    if (kind === 'product') return normalizeBookingProductSnapshot(snapshot);
  }

  if (mod === 'sale') {
    if (kind === 'product') return normalizeSaleProductSnapshot(snapshot);
    if (kind === 'bill') return normalizeGenericBillSnapshot(snapshot);
  }

  if (kind === 'bill') return normalizeGenericBillSnapshot(snapshot);
  if (kind === 'product') return normalizeGenericBillSnapshot(snapshot);
  return snapshot;
}

/**
 * Tag raw booking product snapshot with order context before normalize.
 * @param {object|null|undefined} productData
 * @param {object|null|undefined} order
 * @param {boolean} stageOnly
 */
export function tagBookingProductSnapshotContext(productData, order, stageOnly) {
  if (!productData || typeof productData !== 'object') return productData;
  return {
    ...productData,
    _order_sales_person_id: order?.sales_person_id || null,
    _stage_only: stageOnly,
  };
}
