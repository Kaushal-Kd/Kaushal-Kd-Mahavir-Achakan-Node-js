/**
 * Print utilities for bills and receipts.
 *
 * `printBill` renders an order using the shop's default `bill_template`
 * (A4 / A5 / thermal), falling back to DEFAULT_TEMPLATE when none is saved.
 * `printReceipt` renders a compact receipt for a single payment.
 */

import { formatCurrency, formatDate, formatDateTime, formatPaymentDateTime } from '@wrs/shared';

import { configurationsApi } from '../lib/api/configurations.js';
import { billTemplatesApi } from '../lib/api/billTemplates.js';
import { useShopStore } from '../stores/shopStore.js';
import { customOrderToBillOrder } from '../lib/customOrderBill.js';
import { ordersApi } from '../lib/api/orders.js';
import { saleToBillOrder } from '../lib/saleBill.js';
import { mergeTemplate, prepareOrderForBill, renderBillHtml } from './billTemplates.js';
import {
  applyShopLogoToTemplate,
  billPrintTitle,
  mapShopForBill,
  resolveBillShopHeader,
} from './shopBillHeader.js';

/**
 * Print via a hidden iframe — opens the system print dialog only (no new tab/window).
 */
export function renderAndPrint(html, { title = 'Invoice' } = {}) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;left:-10000px;top:0;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(frame);

  const doc = frame.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(frame);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();
  try {
    doc.title = title;
  } catch {
    /* noop */
  }

  const win = frame.contentWindow;
  if (!win) {
    document.body.removeChild(frame);
    return;
  }

  const cleanup = () => {
    setTimeout(() => {
      try {
        document.body.removeChild(frame);
      } catch {
        /* noop */
      }
    }, 500);
  };

  let printed = false;
  const triggerPrintOnce = () => {
    if (printed) return;
    printed = true;
    try {
      win.focus();
      win.print();
    } catch {
      cleanup();
    }
  };

  if (typeof win.addEventListener === 'function') {
    win.addEventListener('afterprint', cleanup, { once: true });
  } else {
    win.onafterprint = cleanup;
  }

  const schedulePrint = () => setTimeout(triggerPrintOnce, 350);
  frame.addEventListener('load', schedulePrint, { once: true });
  setTimeout(schedulePrint, 600);
}

function getShopHeaderFromStore() {
  try {
    const { shops, selectedShopId } = useShopStore.getState();
    const shop = shops.find((sh) => sh.id === selectedShopId);
    return mapShopForBill(shop);
  } catch {
    return mapShopForBill(null);
  }
}

let cachedDefault = null;
let cachedShopId = null;
let cachedBillNotesHtml = null;
let cachedBillNotesShopId = null;

/** Shop-wide HTML bill notes from App Settings → BILL_NOTES. */
export async function fetchShopBillNotesHtml() {
  const shopId = useShopStore.getState().selectedShopId;
  if (!shopId) return '';
  if (cachedBillNotesShopId === shopId && cachedBillNotesHtml !== null) {
    return cachedBillNotesHtml;
  }
  try {
    const res = await configurationsApi.getAppSettings();
    const row = (res?.data?.items || []).find((i) => i.key === 'BILL_NOTES');
    cachedBillNotesHtml = String(row?.value || '');
    cachedBillNotesShopId = shopId;
    return cachedBillNotesHtml;
  } catch {
    return '';
  }
}

export function invalidateBillNotesCache() {
  cachedBillNotesHtml = null;
  cachedBillNotesShopId = null;
}

async function getDefaultTemplate() {
  const s = useShopStore.getState();
  const shopId = s.selectedShopId;
  if (!shopId) return null;
  if (cachedShopId === shopId && cachedDefault !== null) return cachedDefault;
  try {
    const res = await billTemplatesApi.list();
    const list = res?.data || [];
    const def = list.find((t) => t.is_default) || list[0] || null;
    cachedDefault = def;
    cachedShopId = shopId;
    return def;
  } catch {
    return null;
  }
}

export function invalidateBillTemplateCache() {
  cachedDefault = null;
  cachedShopId = null;
  invalidateBillNotesCache();
}

async function buildBillHtml(order, options = {}) {
  if (!order) return { html: '', printTitle: 'Invoice', paperSize: 'A4' };
  const billOrder = prepareOrderForBill(order);
  const shop = options.shop || (await resolveBillShopHeader(options.shopId));
  const rawTemplate = options.template || (await getDefaultTemplate());
  const template = applyShopLogoToTemplate(rawTemplate, shop);
  const merged = mergeTemplate(template);
  const printTitle = billPrintTitle(billOrder, shop);
  const billNotesHtml =
    options.billNotesHtml !== undefined ? options.billNotesHtml : await fetchShopBillNotesHtml();
  const html = renderBillHtml({
    order: billOrder,
    template,
    shop,
    title: printTitle,
    billNotesHtml,
    renderOptions: options.renderOptions || {},
  });
  return { html, printTitle, paperSize: merged.paper_size || 'A4' };
}

/** Custom order bills: delivery/return dates, single custom line item. */
export const CUSTOM_ORDER_BILL_PRINT_OPTIONS = {
  renderOptions: {
    showPickupReturn: true,
  },
};

/** Sale bills: no pickup/return, show sale date, no terms block, no shop notes footer. */
export const SALE_BILL_PRINT_OPTIONS = {
  billNotesHtml: '',
  renderOptions: {
    showPickupReturn: false,
    showOrderDate: true,
    orderDateLabel: 'Date of order',
    footerTermsOverride: '',
  },
};

export async function printBill(order, options = {}) {
  const { html, printTitle } = await buildBillHtml(order, options);
  if (!html) return;
  renderAndPrint(html, { title: printTitle });
}

/** Same HTML as print; downloads as a PDF file. */
export async function downloadBill(order, options = {}) {
  const { html, paperSize } = await buildBillHtml(order, options);
  if (!html) return;
  const safe = String(order.order_number || order.id || 'invoice').replace(/[^\w.-]+/g, '_');
  const { downloadHtmlAsPdf } = await import('./billPdf.js');
  await downloadHtmlAsPdf(html, `invoice-${safe}.pdf`, paperSize);
}

/**
 * Print a custom order bill. When linked to a booking, prints the booking invoice instead.
 * @param {object} customOrder
 * @param {object} [options]
 */
export async function printCustomOrderBill(customOrder, options = {}) {
  if (!customOrder) return;
  if (customOrder.linked_order_id) {
    const { data: order } = await ordersApi.get(customOrder.linked_order_id);
    await printBill(order, options);
    return;
  }
  const order = customOrderToBillOrder(customOrder, options);
  if (!order) return;
  await printBill(order, {
    ...CUSTOM_ORDER_BILL_PRINT_OPTIONS,
    ...options,
    renderOptions: {
      ...CUSTOM_ORDER_BILL_PRINT_OPTIONS.renderOptions,
      ...(options.renderOptions || {}),
    },
  });
}

/** Download a custom order bill as PDF. */
export async function downloadCustomOrderBill(customOrder, options = {}) {
  if (!customOrder) return;
  if (customOrder.linked_order_id) {
    const { data: order } = await ordersApi.get(customOrder.linked_order_id);
    await downloadBill(order, options);
    return;
  }
  const order = customOrderToBillOrder(customOrder, options);
  if (!order) return;
  await downloadBill(order, {
    ...CUSTOM_ORDER_BILL_PRINT_OPTIONS,
    ...options,
    renderOptions: {
      ...CUSTOM_ORDER_BILL_PRINT_OPTIONS.renderOptions,
      ...(options.renderOptions || {}),
    },
  });
}

/** Print a sale bill using the shop default bill template. */
export async function printSale(sale, options = {}) {
  const order = saleToBillOrder(sale);
  if (!order) return;
  await printBill(order, {
    ...SALE_BILL_PRINT_OPTIONS,
    ...options,
    renderOptions: {
      ...SALE_BILL_PRINT_OPTIONS.renderOptions,
      ...(options.renderOptions || {}),
    },
  });
}

/** Download a sale bill as PDF. */
export async function downloadSale(sale, options = {}) {
  const order = saleToBillOrder(sale);
  if (!order) return;
  await downloadBill(order, {
    ...SALE_BILL_PRINT_OPTIONS,
    ...options,
    renderOptions: {
      ...SALE_BILL_PRINT_OPTIONS.renderOptions,
      ...(options.renderOptions || {}),
    },
  });
}

/**
 * Build bill PDF for WhatsApp attachment.
 * @param {object} order
 * @param {object} [options]
 * @returns {Promise<{ base64: string, filename: string, paperSize: string }|null>}
 */
export async function buildBillPdfBase64(order, options = {}) {
  const { html, paperSize } = await buildBillHtml(order, options);
  if (!html) return null;
  const safe = String(order.order_number || order.id || 'invoice').replace(/[^\w.-]+/g, '_');
  const { blobToBase64, htmlToPdfBlob } = await import('./billPdf.js');
  const blob = await htmlToPdfBlob(html, paperSize);
  const base64 = await blobToBase64(blob);
  return {
    base64,
    filename: `invoice-${safe}.pdf`,
    paperSize,
  };
}

/** Print a single payment receipt (always compact). */
export async function printReceipt(order, payment) {
  if (!order || !payment) return;
  const shop = await resolveBillShopHeader();
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const printTitle = billPrintTitle(order, shop);
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(printTitle)}</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; color: #111; margin: 16mm; }
      h1 { font-size: 20px; margin: 0 0 6px 0; color: #0C6EE1; }
      h2 { font-size: 16px; margin: 0 0 4px 0; }
      .muted { color: #6b7280; font-size: 12px; }
      .row { display: flex; justify-content: space-between; gap: 16px; }
      .card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin-top: 10px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
      th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
      th { background: #f7f7f7; font-weight: 600; }
      .foot { margin-top: 20px; font-size: 11px; color: #6b7280; text-align: center; }
    </style></head><body>
    <div class="row">
      <div>
        <h1>${esc(shop.name)}</h1>
        <div class="muted">${esc(shop.address || '')}</div>
      </div>
      <div style="text-align:right">
        <h2>Payment Receipt</h2>
        <div class="muted">${formatPaymentDateTime(payment)}</div>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <div>
          <div class="muted">Order</div>
          <div><b>${esc(order.order_number)}</b></div>
        </div>
        <div>
          <div class="muted">Customer</div>
          <div><b>${esc(order.pickup_name || '')}</b></div>
          <div class="muted">${esc(order.pickup_number || '')}</div>
        </div>
      </div>
    </div>
    <table>
      <tr><th>Category</th><td>${esc(String(payment.category || '').replace('_', ' '))}</td></tr>
      <tr><th>Mode</th><td>${esc(String(payment.payment_type || ''))}</td></tr>
      ${payment.transaction_id ? `<tr><th>Txn id</th><td>${esc(payment.transaction_id)}</td></tr>` : ''}
      <tr><th>Amount</th><td><b>${formatCurrency(payment.amount)}</b></td></tr>
      <tr><th>Order total</th><td>${formatCurrency(order.total_amount)}</td></tr>
      <tr><th>Paid so far</th><td>${formatCurrency(order.paid_amount || 0)}</td></tr>
      <tr><th>Balance</th><td><b>${formatCurrency(order.balance || 0)}</b></td></tr>
    </table>
    <div class="foot">Thank you for your payment.</div>
    </body></html>`;
  renderAndPrint(html, { title: printTitle });
}
