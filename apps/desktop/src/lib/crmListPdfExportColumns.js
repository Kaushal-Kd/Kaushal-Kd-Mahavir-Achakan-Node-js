import {
  formatBookingDateTime,
  formatCurrency,
  formatDate,
  resolveOrderContactAddress,
  resolveOrderContactPhone1,
  resolveOrderContactPhone2,
} from '@wrs/shared';

/**
 * Shared PDF columns for Delivery and Prepare Item exports.
 * Users pick/reorder these with the settings control next to Export PDF.
 */

function resolvePendingAmount(row) {
  return Math.max(0, Number(row?.balance ?? 0));
}

function money(value) {
  return formatCurrency(Number(value || 0), { showSymbol: false });
}

function uniquePhones(...values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || '').trim();
    const digits = text.replace(/\D/g, '');
    if (!text || !digits || seen.has(digits)) continue;
    seen.add(digits);
    out.push(text);
  }
  return out;
}

function richLinesToPlain(lines) {
  return (lines || [])
    .map((line) => (line.segments || []).map((s) => s.text).join(''))
    .join('\n');
}

function formatLineType(type) {
  return String(type || '')
    .trim()
    .toLowerCase() === 'sell'
    ? 'Sell'
    : '';
}

function formatGivenStatus(status) {
  const key = String(status || '').trim();
  if (key === 'given_with_rent') return 'Given with rent';
  if (key === 'pack_with_rent') return 'Pack with rent';
  if (key === 'regular') return 'Regular';
  return key;
}

function accessoryHeading(category, prefix = '') {
  const cat = String(category ?? '').trim();
  const label = cat ? `${cat.toUpperCase()}: ` : 'Accessory: ';
  return `${prefix}${label}`;
}

function itemDetailRichLine(heading, name, qty, typeLabel, givenLabel = '') {
  const detailParts = [];
  if (qty > 1) detailParts.push(`Qty ${qty}`);
  if (typeLabel) detailParts.push(typeLabel);
  if (givenLabel) detailParts.push(givenLabel);
  const detailText = detailParts.length ? `, ${detailParts.join(', ')}` : '';
  return {
    segments: [
      { text: heading, bold: true },
      { text: name, bold: false },
      { text: detailText, bold: false },
    ],
  };
}

function accessoryRichLine(acc, prefix = '') {
  return itemDetailRichLine(
    accessoryHeading(acc?.category_name, prefix),
    String(acc?.name_snapshot ?? '').trim() || '—',
    Number(acc?.qty ?? 0) || 0,
    formatLineType(acc?.type),
    formatGivenStatus(acc?.given_status)
  );
}

function productHeading(code, name, qty, type, index) {
  let productName = String(code || '').trim();
  const n = String(name || '').trim();
  if (n && n !== productName) productName = productName ? `${productName} - ${n}` : n;
  const detailParts = [];
  if (Number(qty || 0) > 1) detailParts.push(`Qty ${qty}`);
  const typeLabel = formatLineType(type);
  if (typeLabel) detailParts.push(typeLabel);
  const detailText = detailParts.length ? `, ${detailParts.join(', ')}` : '';
  const heading = index > 0 ? `Product ${index}: ` : 'Product: ';
  return {
    segments: [
      { text: heading, bold: true },
      { text: productName || '—', bold: false },
      { text: detailText, bold: false },
    ],
  };
}

export function formatPdfBillNo(row) {
  return String(row?.order_number ?? row?.bill_no ?? '').trim();
}

export function formatPdfCustomerName(row) {
  return String(row?.customer_name ?? row?.pickup_name ?? '').trim();
}

export function formatPdfAddress(row) {
  return resolveOrderContactAddress(row);
}

export function formatPdfMobileNumber(row) {
  const mobiles = uniquePhones(resolveOrderContactPhone1(row), resolveOrderContactPhone2(row));
  const whatsapp = String(row?.customer_whatsapp || '').trim();
  const waDigits = whatsapp.replace(/\D/g, '');
  const extraWa =
    whatsapp && waDigits && !mobiles.some((m) => m.replace(/\D/g, '') === waDigits)
      ? whatsapp
      : '';
  const blocks = [];
  if (mobiles.length) blocks.push(['Mobile', ...mobiles].join('\n'));
  if (extraWa) blocks.push(['WhatsApp', extraWa].join('\n'));
  return blocks.join('\n');
}

export function formatPdfPickupDate(row) {
  return row?.pickup_date ? formatDate(row.pickup_date) : '';
}

export function formatPdfReturnDate(row) {
  return row?.return_date ? formatDate(row.return_date) : '';
}

export function formatPdfDeliveryDateTime(row) {
  return formatBookingDateTime(row?.pickup_date, row?.delivery_time) || '';
}

export function formatPdfReturnDateTime(row) {
  return formatBookingDateTime(row?.return_date, row?.return_time) || '';
}

export function formatPdfTotalRent(row) {
  const subtotal = Number(row?.subtotal ?? 0);
  const discount = Number(row?.discount_total ?? 0);
  return money(Math.max(0, subtotal - discount));
}

export function formatPdfAdvance(row) {
  return money(row?.paid_amount);
}

export function formatPdfPendingAmount(row) {
  return money(resolvePendingAmount(row));
}

export function formatPdfSecurityReference(row) {
  const expected = Number(row?.deposit_amount || 0);
  const isReturned = !!row?.deposit_returned;
  const isPaid = !!row?.paid_security_amt || !!row?.deposit_received;
  const ref = String(row?.reference_name || '').trim();
  const parts = [];
  if (expected <= 0) parts.push('No deposit');
  else {
    const state = isReturned ? 'Returned' : isPaid ? 'Paid' : 'Unpaid';
    parts.push(`${money(expected)} (${state})`);
  }
  if (ref) parts.push(`Ref: ${ref}`);
  return parts.join('\n');
}

/**
 * Product & accessory lines from a delivery/order row (order-level or product-wise).
 * @param {object} row
 * @returns {import('../utils/pdfRichText.js').PdfRichLine[]}
 */
export function buildDeliveryPdfLineDetailsRichLines(row) {
  const accessories = Array.isArray(row?.accessories) ? row.accessories : [];
  /** @type {import('../utils/pdfRichText.js').PdfRichLine[]} */
  const lines = [];

  if (row?._row_kind === 'product') {
    lines.push(
      productHeading(row.product_code, row.product_name, row.product_qty, row.product_type, 1)
    );
    const itemId = String(row.product_item_id || '');
    for (const acc of accessories) {
      if (itemId && String(acc?.order_item_id || '') !== itemId) continue;
      lines.push(accessoryRichLine(acc));
    }
    return lines;
  }

  const items = Array.isArray(row?.items) ? row.items : [];
  items.forEach((item, index) => {
    lines.push(
      productHeading(
        item.code_snapshot,
        item.name_snapshot,
        item.qty,
        item.type,
        items.length > 1 ? index + 1 : 1
      )
    );
    const itemId = String(item.id || '');
    for (const acc of accessories) {
      if (!itemId || String(acc?.order_item_id || '') !== itemId) continue;
      lines.push(accessoryRichLine(acc));
    }
  });

  for (const acc of accessories) {
    if (acc?.order_item_id) continue;
    lines.push(accessoryRichLine(acc, 'Extra '));
  }

  return lines;
}

export function formatDeliveryPdfLineDetails(row) {
  return richLinesToPlain(buildDeliveryPdfLineDetailsRichLines(row));
}

/**
 * @param {Record<string, object>} [overrides] keyed by column key
 * @returns {object[]}
 */
export function buildCrmListPdfCoreColumns(overrides = {}) {
  const cols = [
    {
      key: 'order_number',
      header: 'Bill no',
      columnPickerLabel: 'Bill no',
      width: 16,
      get: formatPdfBillNo,
    },
    {
      key: 'customer_address',
      header: 'Address',
      columnPickerLabel: 'Address',
      width: 20,
      get: formatPdfAddress,
    },
    {
      key: 'customer_name',
      header: 'Customer name',
      columnPickerLabel: 'Customer name',
      width: 20,
      get: formatPdfCustomerName,
    },
    {
      key: 'customer_phone',
      header: 'Mobile number',
      columnPickerLabel: 'Mobile number',
      width: 22,
      get: formatPdfMobileNumber,
    },
    {
      key: 'pickup_date',
      header: 'Pickup date',
      columnPickerLabel: 'Pickup date',
      width: 16,
      get: formatPdfPickupDate,
    },
    {
      key: 'return_date',
      header: 'Return date',
      columnPickerLabel: 'Return date',
      width: 16,
      get: formatPdfReturnDate,
    },
    {
      key: 'delivery_datetime',
      header: 'Delivery date & time',
      columnPickerLabel: 'Delivery date & time',
      width: 20,
      get: formatPdfDeliveryDateTime,
    },
    {
      key: 'return_datetime',
      header: 'Return date & time',
      columnPickerLabel: 'Return date & time',
      width: 20,
      get: formatPdfReturnDateTime,
    },
    {
      key: 'line_details',
      header: 'Product & accessories',
      columnPickerLabel: 'Product & accessories',
      width: 40,
      get: formatDeliveryPdfLineDetails,
      richGet: buildDeliveryPdfLineDetailsRichLines,
    },
    {
      key: 'rent_total',
      header: 'Total rent',
      columnPickerLabel: 'Total rent',
      width: 16,
      get: formatPdfTotalRent,
    },
    {
      key: 'paid_amount',
      header: 'Advance',
      columnPickerLabel: 'Advance',
      width: 16,
      get: formatPdfAdvance,
    },
    {
      key: 'balance',
      header: 'Pending amount',
      columnPickerLabel: 'Pending amount',
      width: 16,
      get: formatPdfPendingAmount,
    },
    {
      key: 'security_reference',
      header: 'Security / Reference',
      columnPickerLabel: 'Security / Reference',
      width: 22,
      get: formatPdfSecurityReference,
    },
  ];
  return cols.map((col) => (overrides[col.key] ? { ...col, ...overrides[col.key] } : col));
}

export const DELIVERY_PDF_EXPORT_COLUMNS = buildCrmListPdfCoreColumns();

export const CRM_LIST_PDF_EXPORT_DEFAULT_HIDDEN = [];
