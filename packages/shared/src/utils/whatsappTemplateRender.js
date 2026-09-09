const TOKEN_MAP = [
  ['*{CUSTOMER_NAME}*', 'customer_name'],
  ['*{SHOP_NAME}*', 'shop_name'],
  ['*{PRODUCT_NAME}*', 'product_name'],
  ['{BILL_PDF}', 'bill_pdf'],
  ['*{BILL_NO}*', 'bill_no'],
  ['*{ITEMS}*', 'items'],
  ['*{DISCOUNT}*', 'discount'],
  ['*{TOTAL_RENT}*', 'total_rent'],
  ['*{ADVANCE}*', 'advance'],
  ['{PENDING_AMOUNT}', 'pending_amount'],
  ['*{SECURITY}*', 'security'],
  ['*{BILL_NOTES}*', 'bill_notes'],
  ['*{DELIVERY_DATE}*', 'delivery_date'],
  ['*{DELIVERY_TIME}*', 'delivery_time'],
  ['*{RETURN_DATE}*', 'return_date'],
  ['*{RETURN_TIME}*', 'return_time'],
  ['*{CUSTOMER_ADDRESS}*', 'customer_address'],
  ['*{DELIVERED_ITEMS}*', 'delivered_items'],
  ['*{PENDING_DELIVERY_ITEMS}*', 'pending_delivery_items'],
  ['*{MISSING_ITEMS}*', 'missing_items'],
  ['*{DAMAGE_ITEMS}*', 'damage_items'],
  ['*{MISSING_CHARGES}*', 'missing_charges'],
  ['*{DAMAGE_CHARGES}*', 'damage_charges'],
];

const BILL_PDF_TOKEN_RE = /\{BILL_PDF\}/gi;
const LEGACY_BILL_URL_TOKEN_RE = /\{BILL_URL\}/gi;

function cleanupMessageBody(text) {
  return String(text ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Replace WhatsApp template placeholders with context values.
 * @param {string} template
 * @param {Record<string, string | number | null | undefined>} context
 * @param {{ stripBillPdfTokens?: boolean }} [options]
 */
export function renderWhatsAppTemplate(template, context = {}, options = {}) {
  let out = String(template ?? '');
  for (const [token, key] of TOKEN_MAP) {
    const val = context[key];
    const replacement = val == null ? '' : String(val);
    out = out.split(token).join(replacement);
  }
  out = out.replace(LEGACY_BILL_URL_TOKEN_RE, '');
  if (options.stripBillPdfTokens) {
    out = out.replace(BILL_PDF_TOKEN_RE, '');
    out = cleanupMessageBody(out);
  }
  return out;
}

export function buildWhatsAppContextFromOrder(order = {}, shop = {}, customer = {}) {
  const customerName = customer.name || order.customer_name || '';
  const shopName = shop.shop_name || shop.company_name || '';
  return {
    customer_name: customerName,
    shop_name: shopName,
    product_name: order.product_name || order.product_names || '',
    bill_pdf: '',
    bill_no: order.order_number || order.bill_no || '',
    items: order.items_summary || order.items || '',
    discount: order.discount != null ? String(order.discount) : '',
    total_rent:
      order.total_rent != null
        ? String(order.total_rent)
        : order.grand_total != null
          ? String(order.grand_total)
          : '',
    advance: order.advance_amount != null ? String(order.advance_amount) : '',
    pending_amount: order.pending_amount != null ? String(order.pending_amount) : '',
    security:
      order.deposit_amount != null
        ? String(order.deposit_amount)
        : order.security != null
          ? String(order.security)
          : '',
    bill_notes: order.bill_notes || '',
    delivery_date: order.pickup_date || order.delivery_date || '',
    delivery_time: order.delivery_time || '',
    return_date: order.return_date || '',
    return_time: order.return_time || '',
    customer_address: customer.address || order.contact_address || order.customer_address || '',
    delivered_items: order.delivered_items || '',
    pending_delivery_items: order.pending_delivery_items || '',
    missing_items: order.missing_items || '',
    damage_items: order.damage_items || '',
    missing_charges: order.missing_charges || '',
    damage_charges: order.damage_charges || '',
  };
}
