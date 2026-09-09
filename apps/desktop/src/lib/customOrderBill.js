import { computeCustomOrderTotals, round2 } from '@wrs/shared';

/**
 * @param {object} co
 * @returns {string}
 */
function buildCustomOrderItemName(co) {
  const parts = [co.product_name, co.design_name, co.color, co.size]
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean);
  return parts.join(' · ') || 'Custom order';
}

/**
 * @param {object} co
 * @param {{ categoryName?: string, gstPercent?: number }} [options]
 * @returns {object|null} order-shaped payload for printBill
 */
export function customOrderToBillOrder(co, options = {}) {
  if (!co) return null;

  const totals =
    co.total_amount != null && co.total_amount !== ''
      ? {
          subtotal: round2(co.subtotal),
          discount_total: round2(co.discount_total),
          tax_total: round2(co.tax_total),
          total_amount: round2(co.total_amount),
          paid_amount: round2(co.paid_amount),
          balance: round2(co.balance),
          booking_discount_amount: round2(co.booking_discount_amount),
        }
      : computeCustomOrderTotals(co, { gstPercent: options.gstPercent });

  const lineDiscount = round2(
    Number(co.line_discount || 0) + Number(totals.booking_discount_amount || 0)
  );
  const linePrice = round2(co.price);
  const lineTax = round2(totals.tax_total);
  const lineTotal = round2(totals.total_amount);
  const orderType = co.order_type === 'sell' ? 'sell' : 'rent';

  return {
    order_number: co.order_number || '',
    booking_date: co.order_date || null,
    pickup_date: co.delivery_date || null,
    return_date: co.return_date || null,
    pickup_name: co.customer_name || '',
    pickup_number: co.customer_phone || '',
    customer_name: co.customer_name || '',
    customer_address: co.customer_address || '',
    customer_notes: co.remarks || '',
    subtotal: round2(totals.subtotal),
    discount_amount: round2(totals.discount_total),
    tax_amount: round2(totals.tax_total),
    total_amount: lineTotal,
    paid_amount: round2(totals.paid_amount),
    balance: round2(totals.balance),
    security_deposit: co.paid_security_amt ? round2(co.deposit_amount) : 0,
    items: [
      {
        type: orderType,
        name_snapshot: buildCustomOrderItemName(co),
        category_name: options.categoryName || co.category_name || '',
        qty: 1,
        price: linePrice,
        discount: lineDiscount,
        tax: lineTax,
        total: lineTotal,
        line_total: lineTotal,
      },
    ],
    accessories: [],
  };
}
