import { isIndianPhone, normalizeCustomOrderSqlDate, normalizePhone } from '@wrs/shared';

import { customersApi } from './api/customers.js';
import { customOrdersApi } from './api/customOrders.js';

export const CUSTOM_ORDER_BOOKING_HANDOFF_KEY = 'wrs.customOrderBookingHandoff';

/**
 * @param {object} order Custom order row from API
 * @param {object[]} [fieldDefs]
 * @returns {string}
 */
export function buildMeasurementsSummary(order, fieldDefs = []) {
  const measurements =
    order?.measurements && typeof order.measurements === 'object' ? order.measurements : {};
  const lines = [];
  for (const def of fieldDefs) {
    const val = measurements[def.id];
    const s = String(val ?? '').trim();
    if (!s) continue;
    lines.push(`${def.label}: ${s}${def.unit ? ` ${def.unit}` : ''}`);
  }
  return lines.join('; ');
}

/**
 * @param {object} order
 * @param {boolean} wasAlreadyCompleted
 * @returns {boolean}
 */
export function shouldOfferBookingAfterComplete(order, wasAlreadyCompleted) {
  if (wasAlreadyCompleted) return false;
  if (!order || order.status !== 'completed') return false;
  if (!order.linked_product_id) return false;
  if (order.linked_order_id) return false;
  return true;
}

/**
 * @param {object} order Custom order row from API
 * @param {string} [measurementsSummary]
 */
export function buildCustomOrderBookingHandoff(order, measurementsSummary = '') {
  const tailorNotes = [String(order.remarks || '').trim(), measurementsSummary]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 500);
  return {
    custom_order_id: order.id,
    customer: {
      id: order.customer_id || null,
      name: order.customer_name || '',
      phone1: order.customer_phone || '',
      phone2: order.customer_phone2 || '',
      phone2_name: order.customer_phone2_name || '',
      whatsapp: order.customer_whatsapp || '',
      whatsapp_source: order.customer_whatsapp_source || 'phone1',
      address: order.customer_address || '',
    },
    delivery_date: normalizeCustomOrderSqlDate(order.delivery_date) || null,
    return_date: normalizeCustomOrderSqlDate(order.return_date) || null,
    product_id: order.linked_product_id || null,
    product_code: order.generated_product_code || '',
    product_name: order.product_name || order.design_name || '',
    remarks: order.remarks || '',
    tailor_notes: tailorNotes,
    measurements_summary: measurementsSummary,
    financial: {
      price: Number(order.price || 0),
      line_discount: 0,
      order_type: order.order_type || 'rent',
      gst_enabled: order.gst_enabled !== false,
      igst_bill: !!order.igst_bill,
      tax_mode: order.tax_mode || 'exclusive',
      booking_discount_type: order.booking_discount_type || 'flat',
      booking_discount_value: Number(order.booking_discount_value || 0),
      advance_amount: Number(order.advance_amount || 0),
      deposit_amount: Number(order.deposit_amount || 0),
      paid_security_amt: !!order.paid_security_amt,
      advance_account_id: order.advance_account_id || '',
      security_account_id: order.security_account_id || '',
      apply_credit_amount: Number(order.apply_credit_amount || 0),
      subtotal: Number(order.subtotal || 0),
      discount_total: Number(order.discount_total || 0),
      tax_total: Number(order.tax_total || 0),
      total_amount: Number(order.total_amount || 0),
    },
  };
}

/**
 * @param {object} order
 * @param {import('react-router-dom').NavigateFunction} navigate
 * @param {{ measurementsSummary?: string, fieldDefs?: object[] }} [options]
 * @returns {boolean}
 */
export function startCustomOrderBookingHandoff(order, navigate, options = {}) {
  if (!order?.linked_product_id) return false;
  if (order.linked_order_id) return false;
  const summary =
    options.measurementsSummary ??
    buildMeasurementsSummary(order, options.fieldDefs || []);
  writeCustomOrderBookingHandoff(buildCustomOrderBookingHandoff(order, summary));
  navigate('/booking/new', { state: { fromCustomOrder: true } });
  return true;
}

/** @returns {object|null} */
export function readCustomOrderBookingHandoff() {
  try {
    const raw = sessionStorage.getItem(CUSTOM_ORDER_BOOKING_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {object} payload */
export function writeCustomOrderBookingHandoff(payload) {
  sessionStorage.setItem(CUSTOM_ORDER_BOOKING_HANDOFF_KEY, JSON.stringify(payload));
}

export function clearCustomOrderBookingHandoff() {
  try {
    sessionStorage.removeItem(CUSTOM_ORDER_BOOKING_HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Find or create a master customer from a custom-order handoff snapshot.
 * @param {object} c Handoff customer snapshot
 * @returns {Promise<{ customer: object, created: boolean }|null>}
 */
export async function resolveHandoffCustomer(c) {
  if (c?.id) {
    return {
      customer: {
        id: c.id,
        name: c.name || '',
        phone1: c.phone1 || '',
        phone2: c.phone2 || '',
        phone2_name: c.phone2_name || '',
        whatsapp: c.whatsapp || '',
        address: c.address || '',
      },
      created: false,
    };
  }

  const name = String(c?.name || '').trim();
  const phone1 = normalizePhone(c?.phone1 || '');
  const phone2 = normalizePhone(c?.phone2 || '') || null;
  const hasPhone = isIndianPhone(phone1);
  const hasName = name.length >= 1;

  if (!hasPhone && !hasName) return null;

  const searchTerm = hasPhone ? phone1 : name;
  if (searchTerm.length >= 2) {
    try {
      const res = await customersApi.search(searchTerm);
      const rows = res?.data || [];
      if (hasPhone) {
        const exact = rows.find((row) => normalizePhone(row.phone1 || '') === phone1);
        if (exact) return { customer: exact, created: false };
      } else {
        const exactName = rows.find(
          (row) => String(row.name || '').trim().toLowerCase() === name.toLowerCase()
        );
        if (exactName) return { customer: exactName, created: false };
      }
    } catch {
      /* continue to create */
    }
  }

  try {
    if (hasPhone) {
      const res = await customersApi.create({
        name: name || 'Customer',
        phone1,
        phone2,
        phone2_name: c?.phone2_name?.trim() || null,
        whatsapp: c?.whatsapp ? normalizePhone(c.whatsapp) || null : null,
        address: c?.address?.trim() || null,
        is_active: true,
      });
      const customer = res?.data || null;
      return customer ? { customer, created: true } : null;
    }

    const res = await customersApi.quickAvailabilityCreate({ name, phone1: '' });
    let customer = res?.data || null;
    if (!customer) return null;

    const patch = {};
    if (c?.address?.trim()) patch.address = c.address.trim();
    if (phone2) patch.phone2 = phone2;
    if (c?.phone2_name?.trim()) patch.phone2_name = c.phone2_name.trim();
    const whatsapp = c?.whatsapp ? normalizePhone(c.whatsapp) : '';
    if (whatsapp && isIndianPhone(whatsapp)) patch.whatsapp = whatsapp;

    if (Object.keys(patch).length > 0) {
      try {
        const updated = await customersApi.update(customer.id, patch);
        customer = updated?.data || customer;
      } catch {
        /* keep base customer */
      }
    }

    return { customer, created: true };
  } catch (err) {
    const status = err?.response?.status;
    const msg = String(err?.message || '').toLowerCase();
    const isConflict = status === 409 || msg.includes('already exists');
    if (hasPhone && isConflict) {
      try {
        const res = await customersApi.search(phone1);
        const exact = (res?.data || []).find((row) => normalizePhone(row.phone1 || '') === phone1);
        if (exact) return { customer: exact, created: false };
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

/**
 * @param {string} customOrderId
 * @param {string} customerId
 */
export function linkHandoffCustomerToCustomOrder(customOrderId, customerId) {
  if (!customOrderId || !customerId) return;
  customOrdersApi.update(customOrderId, { customer_id: customerId }).catch(() => {
    /* fire-and-forget */
  });
}
