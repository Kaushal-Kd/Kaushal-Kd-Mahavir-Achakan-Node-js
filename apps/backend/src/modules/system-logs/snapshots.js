/**
 * Build JSON snapshots for system_logs (WRS field names).
 */

const STAGE_ONLY_ACTIONS = new Set([
  'UPDATE_STAGE',
  'UPDATE_STAGE_BULK',
  'UPDATE_STAGE_BATCH',
]);

/** @param {string} [action] */
export function isStageOnlyBookingAction(action) {
  return STAGE_ONLY_ACTIONS.has(String(action || '').toUpperCase());
}

/** @param {object} order */
/** @param {object|null} customer */
export function buildBookingBillSnapshot(order, customer = null) {
  const c = customer || order?.customer || null;
  return {
    order: {
      id: order?.id,
      order_number: order?.order_number,
      status: order?.status,
      booking_date: order?.booking_date,
      booking_time: order?.booking_time,
      pickup_name: order?.pickup_name,
      pickup_number: order?.pickup_number,
      reference_name: order?.reference_name,
      customer_id: order?.customer_id,
      sales_person_id: order?.sales_person_id,
      subtotal: order?.subtotal,
      discount_total: order?.discount_total,
      tax_total: order?.tax_total,
      total_amount: order?.total_amount,
      advance_amount: order?.advance_amount,
      paid_amount: order?.paid_amount,
      balance: order?.balance,
      deposit_amount: order?.deposit_amount,
      customer_notes: order?.customer_notes,
    },
    customer: c
      ? {
          id: c.id,
          name: c.name,
          phone1: c.phone1 || c.phone || null,
          phone: c.phone1 || c.phone || null,
          phone2: c.phone2,
          email: c.email,
          address: c.address,
        }
      : null,
  };
}

/** @param {object} line @param {boolean} stageOnly @param {string|null} orderSalesPersonId */
function mapBookingItemLine(line, stageOnly, orderSalesPersonId) {
  const code = line.code_snapshot || line.product_code || line.code;
  const name = line.name_snapshot || line.product_name || null;
  const salesPersonId = line.sales_person_id || orderSalesPersonId || null;

  if (stageOnly) {
    return {
      id: line.id,
      product_id: line.product_id,
      code,
      name_snapshot: name,
      stage_flags: line.stage_flags,
    };
  }
  return {
    id: line.id,
    product_id: line.product_id,
    code,
    name_snapshot: name,
    qty: line.qty,
    rent: line.price ?? line.rent,
    discount: line.discount,
    type: line.type || 'rent',
    sales_person_id: salesPersonId,
    remarks: line.remarks,
    stage_flags: line.stage_flags,
  };
}

/** @param {object} line @param {boolean} stageOnly */
function mapBookingAccessoryLine(line, stageOnly) {
  const code = line.code_snapshot || null;
  const name = line.name_snapshot || line.accessory_name || null;

  if (stageOnly) {
    return {
      id: line.id,
      accessory_id: line.accessory_id,
      code,
      name_snapshot: name,
      stage_flags: line.stage_flags,
    };
  }
  return {
    id: line.id,
    accessory_id: line.accessory_id,
    name_snapshot: name,
    category_name: line.category_name,
    code,
    qty: line.qty,
    rent: line.price ?? line.rent,
    sell_price: line.sell_price ?? line.price_sell,
    discount: line.discount,
    type: line.type || 'rent',
    remarks: line.remarks,
    stage_flags: line.stage_flags,
  };
}

/**
 * @param {object} order — must include items[] and accessories[]
 * @param {{ action?: string, order?: object }} [options]
 */
export function buildBookingProductSnapshot(order, options = {}) {
  const source = options.order || order;
  const stageOnly = isStageOnlyBookingAction(options.action);
  const orderSalesPersonId = source?.sales_person_id || null;
  const items = (order?.items || []).map((line) =>
    mapBookingItemLine(line, stageOnly, orderSalesPersonId)
  );
  const accessories = (order?.accessories || []).map((line) =>
    mapBookingAccessoryLine(line, stageOnly)
  );
  return { items, accessories };
}

/** @param {object} sale — includes items if loaded */
export function buildSaleProductSnapshot(sale) {
  return {
    items: (sale?.items || []).map((line) => ({
      id: line.id,
      product_id: line.product_id,
      accessory_id: line.accessory_id,
      description: line.description || line.name_snapshot,
      qty: line.qty,
      rate: line.rate ?? line.price,
      amount: line.amount ?? line.total_amount,
    })),
  };
}

export { normalizeSnapshotForDiff, tagBookingProductSnapshotContext } from './normalizeSnapshot.js';
