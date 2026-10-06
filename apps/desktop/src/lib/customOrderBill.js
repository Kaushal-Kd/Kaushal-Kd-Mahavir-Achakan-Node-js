import { computeCustomOrderTotals, customOrderItemsFromOrder, round2 } from '@wrs/shared';

/**
 * @param {object} item
 * @returns {string}
 */
function buildCustomOrderItemName(item) {
  const parts = [item.product_name, item.design_name, item.color, item.size]
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean);
  return parts.join(' · ') || 'Custom order';
}

function categoryNameForItem(item, options, isPrimary, co) {
  const byId = options.categoryNameById;
  if (byId && item?.category_id && byId[item.category_id]) return byId[item.category_id];
  if (isPrimary) return options.categoryName || co.category_name || '';
  return '';
}

/**
 * @param {object} co
 * @param {{ categoryName?: string, categoryNameById?: Record<string, string>, gstPercent?: number }} [options]
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

  const productItems = customOrderItemsFromOrder(co).filter(
    (item) => item.product_name || item.design_name || item.color || item.size
  );
  const sourceItems = productItems.length ? productItems : [co];
  const items = sourceItems.map((item, index) => {
    const isPrimary = index === 0;
    return {
      type: orderType,
      name_snapshot: buildCustomOrderItemName(item),
      category_name: categoryNameForItem(item, options, isPrimary, co),
      qty: 1,
      price: isPrimary ? linePrice : 0,
      discount: isPrimary ? lineDiscount : 0,
      tax: isPrimary ? lineTax : 0,
      total: isPrimary ? lineTotal : 0,
      line_total: isPrimary ? lineTotal : 0,
    };
  });

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
    items,
    accessories: [],
  };
}
