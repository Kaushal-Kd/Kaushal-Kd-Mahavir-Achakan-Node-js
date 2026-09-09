import { round2 } from './currency.js';

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNonNegativeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
}

/**
 * Compute booking-style totals for a single-line custom order.
 * @param {object} body
 * @param {{ gstPercent?: number }} [options]
 */
export function computeCustomOrderTotals(body, options = {}) {
  const row = body && typeof body === 'object' ? body : {};
  const qty = 1;
  const price = toNonNegativeAmount(row.price);
  const lineDiscount = toNonNegativeAmount(row.line_discount);
  const gstEnabled = row.gst_enabled !== false;
  const igstBill = !!row.igst_bill;
  const taxMode = row.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive';
  const gstPercent = toNonNegativeAmount(options.gstPercent ?? row.gst_percent ?? 0);

  const gross = price * qty;
  const itemDiscount = lineDiscount * qty;
  const taxableBeforeBooking = Math.max(0, gross - itemDiscount);

  let tax = 0;
  if (gstEnabled && gstPercent > 0) {
    const rate = gstPercent / 100;
    tax =
      taxMode === 'inclusive'
        ? taxableBeforeBooking - taxableBeforeBooking / (1 + rate)
        : taxableBeforeBooking * rate;
  }

  const bookingDiscountRaw =
    row.booking_discount_type === 'percent'
      ? (taxableBeforeBooking * toNonNegativeAmount(row.booking_discount_value)) / 100
      : toNonNegativeAmount(row.booking_discount_value);
  const bookingDiscount = round2(Math.max(0, bookingDiscountRaw));
  const taxableAmount = round2(Math.max(0, taxableBeforeBooking - bookingDiscount));
  const taxTotal = round2(tax);
  const subAfterTaxMode = taxMode === 'inclusive' ? taxableAmount : taxableAmount + taxTotal;
  const grandTotal = round2(Math.round(subAfterTaxMode));

  const advance = toNonNegativeAmount(row.advance_amount);
  const applyCredit = toNonNegativeAmount(row.apply_credit_amount);
  const paidTowardBill = round2(advance + applyCredit);
  const balance = round2(Math.max(0, grandTotal - paidTowardBill));

  let paymentStatus = 'pending';
  if (paidTowardBill > grandTotal + 0.005) paymentStatus = 'overpaid';
  else if (grandTotal > 0 && paidTowardBill >= grandTotal - 0.005) paymentStatus = 'paid';
  else if (paidTowardBill > 0) paymentStatus = 'partial';

  return {
    subtotal: round2(gross),
    item_discount: round2(itemDiscount),
    booking_discount: bookingDiscount,
    booking_discount_amount: bookingDiscount,
    discount_total: round2(itemDiscount + bookingDiscount),
    taxable: taxableAmount,
    tax_total: taxTotal,
    cgst: igstBill || !gstEnabled ? 0 : round2(taxTotal / 2),
    sgst: igstBill || !gstEnabled ? 0 : round2(taxTotal / 2),
    igst: igstBill && gstEnabled ? taxTotal : 0,
    round_off: round2(grandTotal - subAfterTaxMode),
    grand_total: grandTotal,
    total_amount: grandTotal,
    paid_amount: paidTowardBill,
    balance,
    payment_status: paymentStatus,
  };
}
