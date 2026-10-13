import {
  customOrderHasLinkedProduct,
  customOrderItemNotesForBooking,
  customOrderLinkedProductIds,
  formatCustomOrderMeasurementsSummary,
  normalizeCustomOrderSqlDate,
  nowDatetimeLocal,
} from '@wrs/shared';

import { normalizeWhatsappSource } from './bookingCustomerHydration.js';

export const CUSTOM_ORDER_BOOKING_HANDOFF_KEY = 'wrs.customOrderBookingHandoff';

/**
 * Convert-to-booking must use the conversion clock, not the custom order's
 * `order_date` (that can be weeks old and hides the bill from Today's bookings).
 * @returns {string} datetime-local value
 */
export function bookingDateTimeForConvert() {
  return nowDatetimeLocal();
}

/**
 * @param {object} order Custom order row from API
 * @param {object[]} [fieldDefs]
 * @returns {string}
 */
export function buildMeasurementsSummary(order, fieldDefs = []) {
  return formatCustomOrderMeasurementsSummary(order, fieldDefs);
}

/**
 * @param {object} order
 * @param {boolean} wasAlreadyCompleted
 * @returns {boolean}
 */
export function shouldOfferBookingAfterComplete(order, wasAlreadyCompleted) {
  if (wasAlreadyCompleted) return false;
  if (!order || order.status !== 'completed') return false;
  if (!customOrderHasLinkedProduct(order)) return false;
  if (order.linked_order_id) return false;
  return true;
}

/**
 * Remaining per-product notes queues from a convert-to-booking handoff.
 * @param {object} [handoff]
 * @returns {Map<string, string[]>}
 */
export function handoffItemNotesQueues(handoff) {
  const queues = new Map();
  for (const row of Array.isArray(handoff?.item_notes) ? handoff.item_notes : []) {
    const id = String(row?.product_id || '').trim();
    const notes = String(row?.notes || '').trim();
    if (!id || !notes) continue;
    if (!queues.has(id)) queues.set(id, []);
    queues.get(id).push(notes);
  }
  return queues;
}

/**
 * Take the next note for this booking line. Matches by product id so notes
 * stay on the product they were measured for, even if cart order differs.
 * @param {object} [handoff]
 * @param {string} productId
 * @param {number} index
 * @param {Map<string, string[]>} queues
 * @returns {string}
 */
export function takeHandoffItemNotes(handoff, productId, index, queues) {
  const id = String(productId || '').trim();
  if (id && queues?.has(id)) {
    const list = queues.get(id);
    if (list.length) return String(list.shift() || '').trim().slice(0, 500);
  }
  const itemNotes = Array.isArray(handoff?.item_notes) ? handoff.item_notes : [];
  if (itemNotes.length) return '';
  if (index === 0) {
    return String(handoff?.tailor_notes || '').trim().slice(0, 500);
  }
  return '';
}

/**
 * @param {object} order Custom order row from API
 * @param {string} [measurementsSummary]
 * @param {object[]} [fieldDefs]
 */
export function buildCustomOrderBookingHandoff(order, measurementsSummary = '', fieldDefs = []) {
  const itemNotes = customOrderItemNotesForBooking(order, fieldDefs);
  const fallbackNotes = itemNotes
    .map((row) => row.notes)
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 500);
  const productIds = customOrderLinkedProductIds(order);
  return {
    custom_order_id: order.id,
    customer: {
      id: order.customer_id || null,
      name: order.customer_name || '',
      phone1: order.customer_phone || '',
      phone2: order.customer_phone2 || '',
      phone2_name: order.customer_phone2_name || '',
      whatsapp: order.customer_whatsapp || '',
      whatsapp_source: normalizeWhatsappSource(order.customer_whatsapp_source || 'phone1'),
      address: order.customer_address || '',
    },
    delivery_date: normalizeCustomOrderSqlDate(order.delivery_date) || null,
    return_date: normalizeCustomOrderSqlDate(order.return_date) || null,
    product_id: productIds[0] || order.linked_product_id || null,
    product_ids: productIds,
    product_code: order.generated_product_code || '',
    product_name: order.product_name || order.design_name || '',
    remarks: order.remarks || '',
    tailor_notes: fallbackNotes,
    item_notes: itemNotes,
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
