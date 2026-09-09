import {
  BOOKED_PRODUCT_BUCKET_LABELS,
  orderStatusToBookedProductBucket,
} from '../constants/orderStatus.js';
import { isDamageChargePayment } from './damageChargePayment.js';
import { toLocalISODate } from './date.js';

/** Backfill stored bucket literals — not granular audit statuses. */
export function isLegacyPaymentStatusBackfillBucket(status) {
  const s = String(status || '').trim();
  return s === 'booked' || s === 'delivered' || s === 'returned';
}

/**
 * Collapse granular order status to finance-report display bucket key.
 * Pre-delivery statuses → `booked`; returned-family → `returned`.
 * @param {string|null|undefined} status
 * @returns {'booked'|'delivered'|'returned'|'cancelled'|string}
 */
export function paymentOrderStatusForDisplay(status) {
  const s = String(status || '').trim();
  // Handover / delivery-screen payments while status is still pre-delivered granular.
  if (s === 'ready_for_delivery') return 'delivered';
  const bucket = orderStatusToBookedProductBucket(status);
  if (bucket === 'booked') return 'booked';
  if (bucket === 'delivered') return 'delivered';
  if (bucket === 'returned') return 'returned';
  if (bucket === 'cancelled') return 'cancelled';
  return s || 'booked';
}

function parseComparableInstant(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Infer payment-time status from order milestone timestamps (legacy rows).
 * @param {{ created_at?: unknown, delivered_at?: unknown, returned_at?: unknown, packed_at?: unknown }} input
 * @returns {'booked'|'delivered'|'returned'}
 */
export function inferPaymentOrderStatusFromTimestamps({
  created_at,
  delivered_at,
  returned_at,
  packed_at,
}) {
  const payTs = parseComparableInstant(created_at);
  const retTs = parseComparableInstant(returned_at);
  const delTs = parseComparableInstant(delivered_at);
  const packTs = parseComparableInstant(packed_at);
  if (payTs != null && retTs != null && payTs >= retTs) return 'returned';
  if (payTs != null && delTs != null && payTs >= delTs) return 'delivered';
  // Payment after pack/handover prep but before delivered_at is recorded (common at delivery).
  if (payTs != null && packTs != null && payTs >= packTs) return 'delivered';
  return 'booked';
}

/**
 * Resolve order status for finance payment Details (never uses current order status alone).
 * @param {object} row
 * @returns {'booked'|'delivered'|'returned'|'cancelled'|string}
 */
function milestoneTimestampsFromRow(row = {}) {
  return {
    created_at: row.created_at,
    delivered_at: row.delivered_at ?? row.order_delivered_at,
    returned_at: row.returned_at ?? row.order_returned_at,
    packed_at: row.packed_at ?? row.order_packed_at,
  };
}

function isFollowUpOrderPayment(row = {}) {
  const v = row.is_follow_up_order_payment;
  return v === true || v === 1 || v === '1';
}

const DELIVERY_PHASE_ORDER_STATUSES = Object.freeze([
  'ready_for_delivery',
  'delivered',
  'partially_returned',
  'returned',
  'closed',
]);

function inferFollowUpPaymentStatus(row, milestones) {
  if (!isFollowUpOrderPayment(row)) return null;

  const orderStatus = String(row.order_status ?? row.fallback_status ?? '').trim();
  if (!orderStatus) return null;

  if (orderStatus === 'ready_for_delivery') return 'delivered';

  const bucket = orderStatusToBookedProductBucket(orderStatus);
  if (bucket === 'returned') return 'returned';
  if (bucket === 'delivered') return 'delivered';

  if (DELIVERY_PHASE_ORDER_STATUSES.includes(orderStatus)) return 'delivered';

  if (milestones.delivered_at && milestones.created_at) {
    const payDay = toLocalISODate(milestones.created_at);
    const delDay = toLocalISODate(milestones.delivered_at);
    if (payDay && delDay && payDay === delDay) return 'delivered';
  }

  return null;
}

export function resolvePaymentOrderStatus(row = {}) {
  const recorded = { booking: 'booked', delivery: 'delivered', return: 'returned' };
  if (Object.hasOwn(recorded, row.payment_stage)) return recorded[row.payment_stage];
  const milestones = milestoneTimestampsFromRow(row);
  const hasMilestones =
    milestones.created_at != null ||
    milestones.delivered_at != null ||
    milestones.returned_at != null ||
    milestones.packed_at != null;

  if (hasMilestones) {
    const inferred = inferPaymentOrderStatusFromTimestamps(milestones);
    if (inferred !== 'booked') return inferred;
  }

  const stored = row.order_status_at_payment;
  if (stored && !isLegacyPaymentStatusBackfillBucket(stored)) {
    return paymentOrderStatusForDisplay(stored);
  }

  const followUp = inferFollowUpPaymentStatus(row, milestones);
  if (followUp) return followUp;

  if (hasMilestones) {
    return inferPaymentOrderStatusFromTimestamps(milestones);
  }

  return paymentOrderStatusForDisplay(row.fallback_status ?? row.order_status);
}

/**
 * @param {string|null|undefined} status
 * @returns {string}
 */
export function formatOrderPaymentBookingPart(status) {
  const key = paymentOrderStatusForDisplay(status);
  const label = BOOKED_PRODUCT_BUCKET_LABELS[key];
  return label ? `BOOKING - ${label}` : 'BOOKING';
}

/**
 * @param {string|null|undefined} orderNumber
 * @param {string|null|undefined} orderStatus
 * @param {string|null|undefined} notes
 * @returns {string}
 */
export function formatOrderPaymentIncomeDetails(orderNumber, orderStatus, notes) {
  const bookingPart = formatOrderPaymentBookingPart(orderStatus);
  if (isDamageChargePayment(notes)) {
    if (orderNumber) return `${orderNumber} - DAMAGE / MISSING CHARGE (${bookingPart})`;
    return `DAMAGE / MISSING CHARGE (${bookingPart})`;
  }
  if (orderNumber) return `${orderNumber} - PAYMENT (${bookingPart})`;
  return `PAYMENT (${bookingPart})`;
}

/**
 * @param {string|null|undefined} orderNumber
 * @param {string|null|undefined} orderStatus
 * @param {string|null|undefined} category
 * @param {string|null|undefined} notes
 * @returns {string}
 */
export function formatOrderPaymentExpenseDetails(orderNumber, orderStatus, category, notes) {
  const bookingPart = formatOrderPaymentBookingPart(orderStatus);
  if (isDamageChargePayment(notes)) {
    if (orderNumber) return `${orderNumber} - DAMAGE CHARGE REVERSAL (${bookingPart})`;
    return `DAMAGE CHARGE REVERSAL (${bookingPart})`;
  }
  const cat = category === 'deposit_refund' ? 'DEPOSIT REFUND' : 'REFUND';
  if (orderNumber) return `${orderNumber} - ${cat} (${bookingPart})`;
  return `${cat} (${bookingPart})`;
}

/**
 * Resolved display status for income/expense transaction_type SQL filter.
 * @param {string|null|undefined} transactionType
 * @returns {'booked'|'delivered'|'returned'|null}
 */
export function orderPaymentDisplayStatusForFilter(transactionType) {
  const tx = String(transactionType || '').trim();
  if (tx === 'order_payment_booked') return 'booked';
  if (tx === 'order_payment_delivered') return 'delivered';
  if (tx === 'order_payment_returned') return 'returned';
  return null;
}

/**
 * Format payment details for account ledger / daily cashbook (income side).
 * @param {string|null|undefined} orderNumber
 * @param {string|null|undefined} orderStatus
 * @param {boolean} isRefund
 * @param {string|null|undefined} notes
 * @returns {string}
 */
export function formatOrderPaymentLedgerDetails(orderNumber, orderStatus, isRefund, notes) {
  const bookingPart = formatOrderPaymentBookingPart(orderStatus);
  if (isDamageChargePayment(notes)) {
    const kind = isRefund ? 'DAMAGE CHARGE REVERSAL' : 'DAMAGE / MISSING CHARGE';
    if (orderNumber) return `${orderNumber} - ${kind} (${bookingPart})`;
    return `${kind} (${bookingPart})`;
  }
  if (isRefund) {
    const cat = 'REFUND';
    if (orderNumber) return `${orderNumber} - ${cat} (${bookingPart})`;
    return `${cat} (${bookingPart})`;
  }
  if (orderNumber) return `${orderNumber} - PAYMENT (${bookingPart})`;
  return `PAYMENT (${bookingPart})`;
}
