import JsBarcode from 'jsbarcode';

/** Prefix so a scanned bill code is never confused with a product/accessory code. */
export const BILL_BARCODE_PREFIX = 'BILL:';

/**
 * @param {unknown} orderNumber
 * @returns {string} encoded barcode value, or ''
 */
export function encodeBillBarcodeValue(orderNumber) {
  const billNo = String(orderNumber || '').trim();
  if (!billNo) return '';
  if (billNo.toUpperCase().startsWith(BILL_BARCODE_PREFIX)) return billNo.toUpperCase();
  return `${BILL_BARCODE_PREFIX}${billNo}`;
}

/**
 * @param {unknown} scanned
 * @returns {string} bill number without prefix, or ''
 */
export function parseBillBarcodeValue(scanned) {
  const raw = String(scanned || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (!upper.startsWith(BILL_BARCODE_PREFIX)) return '';
  return raw.slice(BILL_BARCODE_PREFIX.length).trim();
}

/**
 * Render a CODE128 SVG for the given encoded bill value.
 * Uses the live DOM when available (print + preview). Node tests get a data stub.
 *
 * @param {string} encoded
 * @param {{ text?: string, height?: number, width?: number, displayValue?: boolean }} [opts]
 * @returns {string} SVG markup
 */
export function renderBillBarcodeSvg(encoded, opts = {}) {
  const value = String(encoded || '').trim();
  if (!value) return '';
  const text = String(opts.text || parseBillBarcodeValue(value) || value).trim();
  const displayValue = opts.displayValue !== false;
  if (typeof document === 'undefined') {
    return `<svg class="bill-barcode-svg" data-value="${escapeXml(value)}" role="img" aria-label="${escapeXml(text)}"></svg>`;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, value, {
      format: 'CODE128',
      width: opts.width ?? 1.4,
      height: opts.height ?? 32,
      fontSize: 11,
      displayValue,
      text,
      margin: 0,
      background: '#ffffff',
      lineColor: '#111827',
    });
  } catch {
    return '';
  }
  return new XMLSerializer().serializeToString(svg);
}

/**
 * @param {unknown} orderNumber
 * @param {{ thermal?: boolean, displayValue?: boolean }} [opts]
 * @returns {string} HTML
 */
export function renderBillBarcodeMarkup(orderNumber, opts = {}) {
  const encoded = encodeBillBarcodeValue(orderNumber);
  if (!encoded) return '';
  const billNo = parseBillBarcodeValue(encoded);
  const svg = renderBillBarcodeSvg(encoded, {
    text: billNo,
    height: opts.thermal ? 28 : 32,
    width: opts.thermal ? 1.2 : 1.4,
    displayValue: opts.displayValue,
  });
  if (!svg) return '';
  return `<div class="bill-barcode" data-bill-code="${escapeXml(encoded)}">${svg}</div>`;
}

/**
 * @param {object} payload
 * @param {unknown} payload.scanned
 * @param {(params: object) => Promise<{ data?: object[] }>} payload.listOrders
 * @param {(params: object) => Promise<{ data?: object[] }>} [payload.listSales]
 * @returns {Promise<{ kind: 'not_bill' } | { kind: 'booking', id: string|number } | { kind: 'sale', id: string|number } | { kind: 'missing', billNo: string }>}
 */
export async function resolveBillFromScan({ scanned, listOrders, listSales }) {
  const billNo = parseBillBarcodeValue(scanned);
  if (!billNo) return { kind: 'not_bill' };

  const ordersRes = await listOrders({ search: billNo, per_page: 8 });
  const order = findExactCode(ordersRes?.data, 'order_number', billNo);
  if (order?.id != null) return { kind: 'booking', id: order.id };

  if (typeof listSales === 'function') {
    const salesRes = await listSales({
      search: billNo,
      per_page: 8,
      page: 1,
      sort: '-s.sale_date',
    });
    const sale = findExactCode(salesRes?.data, 'sale_number', billNo);
    if (sale?.id != null) return { kind: 'sale', id: sale.id };
  }

  return { kind: 'missing', billNo };
}

function findExactCode(rows, field, billNo) {
  const needle = String(billNo).trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).find(
    (row) => String(row?.[field] || '').trim().toLowerCase() === needle
  );
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
