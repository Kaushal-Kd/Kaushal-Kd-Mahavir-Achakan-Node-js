/**
 * Bill template renderer.
 *
 * Produces self-contained HTML strings for A4 / A5 / thermal_80 / thermal_58
 * paper sizes from an order + an optional template configuration object.
 *
 * The generated HTML is used both for the live preview in the settings page
 * and for the actual print jobs triggered from the orders flow.
 */

import {
  addDays,
  formatCurrency,
  formatDate,
  round2,
  todayIndiaISODate,
  toLocalISODate,
} from '@wrs/shared';

import {
  computeRentSaleSubtotalsFromPartition,
  formatAccessoryGivenStatusLabel,
  isSellLine,
  partitionOrderForBill,
  sortAccessoriesByDisplayOrder,
} from '../lib/bookingAccessoryCart.js';

export const PAPER_SIZES = [
  { id: 'A4', label: 'A4 — Standard', widthMm: 210, heightMm: 297 },
  { id: 'A5', label: 'A5 — Compact', widthMm: 148, heightMm: 210 },
  { id: 'thermal_80', label: 'Thermal 80mm', widthMm: 80, heightMm: 297 },
  { id: 'thermal_58', label: 'Thermal 58mm', widthMm: 58, heightMm: 297 },
];

export const DEFAULT_MANUAL_BILL_CONTENT = `{{header}}
{{customer}}
{{items}}
{{totals}}
{{footer}}
{{notes}}`;

export const DEFAULT_TEMPLATE = {
  paper_size: 'A4',
  header_config: {
    show_logo: true,
    show_address: true,
    show_phone: true,
    title: 'Invoice',
  },
  bill_info_config: {
    show_customer: true,
    show_customer_address: true,
    show_pickup_return: true,
    show_reference: true,
    show_booking_notes: true,
  },
  items_config: {
    show_code: true,
    show_discount: true,
    show_tax: false,
    show_qty: true,
    show_accessories: true,
  },
  footer_config: {
    thank_you: 'Thank you for choosing us!',
    terms: 'Items must be returned in the same condition. Late returns will incur charges.',
    show_signature: true,
  },
  typography: {
    base_size: 12,
    heading_size: 18,
    // Item-row sizes. `null` means "follow base_size" — important for templates
    // saved before these existed, which would otherwise be silently resized to
    // the default rather than keeping their own base_size. Set a number to
    // override; accessories default a step smaller than products so a bill with
    // many add-ons stays readable.
    product_size: null,
    accessory_size: null,
  },
  colors: {
    brand: '#0C6EE1',
    muted: '#6b7280',
    border: '#e5e7eb',
  },
  page_settings: {
    vertical_offset_in: 0,
  },
  custom_content: {
    enabled: false,
    text: DEFAULT_MANUAL_BILL_CONTENT,
  },
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function mergeTemplate(tpl) {
  const base = DEFAULT_TEMPLATE;
  return {
    paper_size: tpl?.paper_size || base.paper_size,
    header_config: { ...base.header_config, ...(tpl?.header_config || {}) },
    bill_info_config: { ...base.bill_info_config, ...(tpl?.bill_info_config || {}) },
    items_config: { ...base.items_config, ...(tpl?.items_config || {}) },
    footer_config: { ...base.footer_config, ...(tpl?.footer_config || {}) },
    typography: { ...base.typography, ...(tpl?.typography || {}) },
    colors: { ...base.colors, ...(tpl?.colors || {}) },
    page_settings: { ...base.page_settings, ...(tpl?.page_settings || {}) },
    custom_content: { ...base.custom_content, ...(tpl?.custom_content || {}) },
    logo_url: tpl?.logo_url || null,
    logo_width: tpl?.logo_width || 120,
    logo_height: tpl?.logo_height || 60,
    logo_position: tpl?.logo_position || 'left',
  };
}

function isThermal(paper) {
  return paper === 'thermal_58' || paper === 'thermal_80';
}

function pageStyles(tpl) {
  const { paper_size, typography, colors, page_settings } = tpl;
  const thermal = isThermal(paper_size);
  const size = PAPER_SIZES.find((p) => p.id === paper_size) || PAPER_SIZES[0];
  const pageCss = thermal
    ? `size: ${size.widthMm}mm auto; margin: 3mm;`
    : `size: ${size.widthMm}mm ${size.heightMm}mm; margin: 8mm;`;
  const brand = colors.brand || '#0C6EE1';
  const docPad = thermal ? '3mm 2.5mm 4mm' : '14mm 12mm 16mm';
  // Fall back to base_size for templates saved before these settings existed.
  const productSize = Number(typography.product_size) || typography.base_size;
  const accessorySize = Number(typography.accessory_size) || Math.max(6, typography.base_size - 1);
  const rawVerticalOffset = Number(page_settings?.vertical_offset_in);
  const verticalOffsetIn = Number.isFinite(rawVerticalOffset)
    ? Math.min(4, Math.max(-2, rawVerticalOffset))
    : 0;
  return `
    <style>
      @page { ${pageCss} }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body {
        font-family: 'Segoe UI', Inter, system-ui, Arial, sans-serif;
        color: #111827;
        font-size: ${typography.base_size}px;
        line-height: 1.4;
        ${thermal ? `width: ${size.widthMm}mm;` : ''}
      }
      .bill-document {
        padding: ${docPad};
        position: relative;
        top: ${verticalOffsetIn}in;
        ${thermal ? '' : 'max-width: 210mm; margin: 0 auto;'}
      }
      h1, h2, h3 { margin: 0; line-height: 1.2; }
      .muted { color: ${colors.muted}; font-size: ${typography.base_size - 1}px; }
      .right { text-align: right; }

      .bill-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding-bottom: 10px;
      }
      .bill-header-brand { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
      .shop-name {
        font-size: ${typography.heading_size + 2}px;
        font-weight: 700;
        color: ${brand};
        letter-spacing: -0.02em;
      }
      .shop-meta { margin-top: 2px; color: ${colors.muted}; font-size: ${typography.base_size - 1}px; line-height: 1.35; max-width: 420px; }
      .bill-header-doc { text-align: right; flex-shrink: 0; }
      .doc-title {
        font-size: ${typography.heading_size + 2}px;
        font-weight: 700;
        color: #111827;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .doc-sub { margin-top: 2px; font-size: ${typography.base_size - 1}px; color: #374151; }
      .doc-sub strong { color: ${brand}; font-weight: 700; }
      .brand-rule { height: 2px; background: ${brand}; border-radius: 1px; margin-bottom: 12px; }

      .info-card {
        border: 1px solid ${colors.border};
        border-radius: 4px;
        background: #fafafa;
        padding: 12px 14px;
        margin-bottom: 12px;
      }
      .info-grid-single { grid-template-columns: 1fr; }
      .info-grid {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px 16px;
        align-items: start;
      }
      .section-label {
        font-size: ${typography.base_size - 2}px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: ${brand};
        margin-bottom: 4px;
      }
      .customer-name {
        font-size: ${typography.base_size + 1}px;
        font-weight: 700;
        color: #111827;
        word-break: break-word;
      }
      .customer-line { margin-top: 2px; color: #374151; }
      .customer-line.phone { font-weight: 600; color: #111827; }
      .detail-row { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
      .detail-label { font-size: ${typography.base_size - 2}px; font-weight: 600; color: ${colors.muted}; min-width: 64px; }
      .detail-value { color: #111827; font-weight: 600; }
      .notes-box {
        margin-top: 8px;
        padding: 8px 10px;
        background: #fff;
        border: 1px solid ${colors.border};
        border-left: 2px solid ${brand};
        border-radius: 3px;
        font-size: ${typography.base_size - 1}px;
        color: #374151;
        white-space: pre-wrap;
        line-height: 1.3;
      }
      .meta-col { min-width: 140px; }
      .meta-stack { display: flex; flex-direction: column; gap: 8px; }
      .meta-box {
        background: #fff;
        border: 1px solid ${colors.border};
        border-radius: 4px;
        padding: 10px 12px;
        text-align: right;
      }
      .meta-box .meta-label {
        font-size: ${typography.base_size - 2}px;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        color: ${colors.muted};
        margin-bottom: 2px;
      }
      .meta-box .meta-value { font-size: ${typography.base_size}px; font-weight: 700; color: #111827; }
      .meta-box .meta-value.brand { color: ${brand}; }
      .meta-box .meta-hint { margin-top: 2px; font-size: ${typography.base_size - 2}px; color: ${colors.muted}; }

      .items-wrap {
        border: 1px solid ${colors.border};
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      table.items { width: 100%; border-collapse: collapse; font-size: ${typography.base_size}px; margin: 0; }
      table.items th {
        background: ${brand};
        color: #fff;
        font-weight: 600;
        font-size: ${typography.base_size - 1}px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        padding: 8px 10px;
        border: none;
      }
      table.items th:first-child { padding-left: 12px; }
      table.items th:last-child { padding-right: 12px; }
      table.items td {
        padding: 7px 10px;
        border-bottom: 1px solid ${colors.border};
        vertical-align: top;
        font-size: ${productSize}px;
      }
      .item-code {
        font-weight: 700;
        color: #111827;
        font-size: ${Math.max(6, productSize - 1)}px;
      }
      table.items td:first-child { padding-left: 12px; }
      table.items td:last-child { padding-right: 12px; }
      table.items tbody tr:last-child td { border-bottom: none; }
      table.items tbody tr:nth-child(even) td { background: #fafafa; }
      .item-acc td { font-size: ${accessorySize}px; }
      .item-acc td .muted { font-size: ${Math.max(6, accessorySize - 1)}px; }
      .item-acc td:first-child { padding-left: 22px; color: #4b5563; }
      .section-row td {
        font-weight: 700;
        font-size: ${typography.base_size - 1}px;
        background: #f3f4f6;
        color: #374151;
        padding: 6px 12px;
        border-bottom: 1px solid ${colors.border};
      }
      .section-row-sale td {
        background: #e8f2fc;
        color: ${brand};
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .section-subtotal td {
        font-weight: 700;
        font-size: ${typography.base_size - 1}px;
        padding: 6px 12px;
        border-bottom: 1px solid ${colors.border};
      }
      .subtotal-row-rent td { background: #f9fafb; color: #374151; }
      .subtotal-row-sale td { background: #fffbeb; color: #374151; }
      .subtotal-row-sale td:last-child { color: #b45309; }
      .item-sale td { background: #f0f7ff; }

      .totals-wrap {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 14px;
        margin-top: 4px;
      }
      table.totals {
        width: ${thermal ? '100%' : 'min(280px, 100%)'};
        border-collapse: collapse;
        border: 1px solid ${colors.border};
        border-radius: 4px;
        overflow: hidden;
        font-size: ${typography.base_size}px;
      }
      table.totals td { padding: 6px 12px; border-bottom: 1px solid ${colors.border}; }
      table.totals tr:last-child td { border-bottom: none; }
      table.totals td:first-child { color: #4b5563; }
      table.totals .grand td {
        background: #f3f4f6;
        font-weight: 700;
        font-size: ${typography.base_size}px;
        color: #111827;
      }
      table.totals .grand-total td {
        background: ${brand};
        color: #fff;
        font-weight: 700;
        font-size: ${typography.base_size + 1}px;
        border-bottom: none;
        padding: 8px 12px;
      }
      table.totals .balance td { font-weight: 700; color: ${brand}; }
      table.totals .credit-applied td { font-weight: 600; color: ${brand}; }
      table.totals .credit-applied-detail td {
        padding-top: 2px;
        padding-bottom: 6px;
        font-size: ${typography.base_size - 1}px;
        color: #6b7280;
        border-bottom: 1px solid ${colors.border};
      }
      table.totals .rent-subtotal td:first-child { color: #4b5563; }
      table.totals .sale-subtotal td { font-weight: 700; }
      table.totals .sale-subtotal td:last-child { color: #b45309; font-weight: 700; }

      .terms-card {
        border: 1px solid ${colors.border};
        border-radius: 4px;
        padding: 10px 12px;
        margin-top: 12px;
        background: #fafafa;
      }
      .terms-card .section-label { margin-bottom: 3px; }
      .foot {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px solid ${colors.border};
        font-size: ${typography.base_size - 1}px;
        font-weight: 600;
        color: ${brand};
        text-align: center;
      }
      .bill-notes-card {
        margin-top: 14px;
        padding: 12px 14px;
        border: 1px solid ${colors.border};
        border-radius: 4px;
        background: #fafafa;
        page-break-inside: avoid;
      }
      .bill-notes-body {
        font-size: ${typography.base_size - 1}px;
        color: #374151;
        line-height: 1.5;
      }
      .bill-notes-body ul, .bill-notes-body ol { margin: 6px 0 6px 1.2em; padding: 0; }
      .bill-notes-body li { margin: 4px 0; }
      .bill-notes-body p { margin: 4px 0; }
      .sig-row { display: flex; justify-content: space-between; gap: 32px; margin-top: 28px; padding: 0 4px; }
      .sig {
        flex: 1;
        border-top: 1px solid #9ca3af;
        padding-top: 8px;
        text-align: center;
        font-size: ${typography.base_size - 1}px;
        color: ${colors.muted};
      }

      ${
        thermal
          ? `
        .info-grid { grid-template-columns: 1fr; }
        .meta-col .meta-box { text-align: left; }
        table.items th { padding: 2px 4px; font-size: ${Math.max(6, typography.base_size - 1)}px; }
        table.items td { padding: 2px 4px; font-size: ${Math.max(6, productSize - 1)}px; }
        .item-acc td { font-size: ${Math.max(6, accessorySize - 1)}px; }
        .bill-header { flex-direction: column; }
        .bill-header-doc { text-align: left; }
        .sig-row { display: block; }
        .sig { margin-top: 14px; }
        .item-acc td:first-child { padding-left: 8px; }
      `
          : ''
      }
      @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  `;
}

function headerBlock(tpl, shop, order) {
  const { header_config, logo_url, logo_width, logo_height, paper_size } = tpl;
  const thermal = isThermal(paper_size);
  const logoHtml =
    header_config.show_logo && logo_url
      ? `<img src="${esc(logo_url)}" alt="logo" style="max-width:${logo_width}px;max-height:${logo_height}px;object-fit:contain"/>`
      : '';
  const addressHtml =
    header_config.show_address && shop.address
      ? `<div class="shop-meta">${esc(shop.address)}</div>`
      : '';
  const phoneHtml =
    header_config.show_phone && shop.phone
      ? `<div class="shop-meta">Ph: <strong>${esc(shop.phone)}</strong></div>`
      : '';
  const contactHtml = [addressHtml, phoneHtml].filter(Boolean).join('');
  const docTitle = esc(header_config.title || 'Invoice');
  const orderNo = order?.order_number ? esc(order.order_number) : '';
  const bookingDate = order?.booking_date ? formatDate(order.booking_date) : '';

  if (thermal) {
    return `
      <div style="text-align:center;margin-bottom:4px">
        ${logoHtml}
        <div class="shop-name" style="font-size:15px">${esc(shop.name)}</div>
        ${contactHtml}
        <div class="doc-title" style="font-size:13px;margin-top:4px">${docTitle}</div>
        ${orderNo ? `<div class="muted">#${orderNo}${bookingDate ? ` · ${bookingDate}` : ''}</div>` : ''}
      </div>
      <div class="brand-rule" style="margin-bottom:6px"></div>
    `;
  }

  return `
    <header class="bill-header">
      <div class="bill-header-brand">
        ${logoHtml}
        <div>
          <div class="shop-name">${esc(shop.name)}</div>
          ${contactHtml}
        </div>
      </div>
      <div class="bill-header-doc">
        <div class="doc-title">${docTitle}</div>
        ${orderNo ? `<div class="doc-sub">No. <strong>${orderNo}</strong></div>` : ''}
        ${bookingDate ? `<div class="doc-sub muted">Date: ${bookingDate}</div>` : ''}
      </div>
    </header>
    <div class="brand-rule"></div>
  `;
}

function orderCustomerName(order) {
  return order.pickup_name || order.customer?.name || order.customer_name || '';
}

function orderCustomerAddress(order) {
  return String(order.customer?.address || order.customer_address || '').trim();
}

/** Per-order remarks entered on the booking form (not shop-wide bill notes). */
function orderCustomerRemarks(order) {
  return String(order.customer_notes || '').trim();
}

function customerBlock(tpl, order, renderOptions = {}) {
  const { bill_info_config, paper_size } = tpl;
  const showPickupReturn =
    renderOptions.showPickupReturn !== undefined
      ? renderOptions.showPickupReturn
      : bill_info_config.show_pickup_return;
  const showOrderDate = !!renderOptions.showOrderDate && !!order?.booking_date;
  const showAddress =
    bill_info_config.show_customer_address !== false && orderCustomerAddress(order);
  const showReference =
    bill_info_config.show_reference !== false && String(order.reference_name || '').trim();
  const showRemarks = bill_info_config.show_booking_notes !== false && orderCustomerRemarks(order);
  if (
    !bill_info_config.show_customer &&
    !showPickupReturn &&
    !showOrderDate &&
    !showAddress &&
    !showReference &&
    !showRemarks
  ) {
    return '';
  }
  const thermal = isThermal(paper_size);
  const phone = order.pickup_number || order.customer?.phone1 || order.customer_phone || '';

  const customerCol = bill_info_config.show_customer
    ? `
      <div class="info-col">
        <div class="section-label">Bill to</div>
        <div class="customer-name">${esc(orderCustomerName(order))}</div>
        ${phone ? `<div class="customer-line phone">${esc(phone)}</div>` : ''}
        ${showAddress ? `<div class="customer-line">${esc(orderCustomerAddress(order))}</div>` : ''}
        ${
          showReference
            ? `
          <div class="detail-row">
            <span class="detail-label">Reference</span>
            <span class="detail-value">${esc(order.reference_name)}</span>
          </div>
        `
            : ''
        }
        ${
          showRemarks
            ? `
          <div class="detail-row" style="display:block">
            <div class="detail-label">Remarks</div>
            <div class="notes-box">${esc(orderCustomerRemarks(order))}</div>
          </div>
        `
            : ''
        }
      </div>
    `
    : [
        showAddress
          ? `<div class="info-col"><div class="section-label">Address</div><div class="customer-line">${esc(orderCustomerAddress(order))}</div></div>`
          : '',
        showReference
          ? `<div class="info-col"><div class="section-label">Reference</div><div class="detail-value">${esc(order.reference_name)}</div></div>`
          : '',
        showRemarks
          ? `<div class="info-col"><div class="section-label">Remarks</div><div class="notes-box">${esc(orderCustomerRemarks(order))}</div></div>`
          : '',
      ]
        .filter(Boolean)
        .join('');

  const metaBoxes = [];
  if (showOrderDate) {
    const dateLabel = String(renderOptions.orderDateLabel || 'Date').trim() || 'Date';
    metaBoxes.push(`
      <div class="meta-box">
        <div class="meta-label">${esc(dateLabel)}</div>
        <div class="meta-value brand">${formatDate(order.booking_date)}</div>
      </div>
    `);
  } else if (showPickupReturn) {
    metaBoxes.push(`
      <div class="meta-box">
        <div class="meta-label">Pickup · Return</div>
        <div class="meta-value brand">${formatDate(order.pickup_date)} — ${formatDate(order.return_date)}</div>
      </div>
    `);
  }
  const metaCol =
    metaBoxes.length > 0
      ? `<div class="meta-col"><div class="meta-stack">${metaBoxes.join('')}</div></div>`
      : '';

  const gridClass = thermal || !metaCol ? 'info-grid info-grid-single' : 'info-grid';
  return `<section class="info-card"><div class="${gridClass}">${customerCol}${metaCol}</div></section>`;
}

function normalizeBillLine(line) {
  if (!line || typeof line !== 'object') return line;
  return {
    ...line,
    total: line.total ?? line.line_total ?? 0,
  };
}

/** Ensure bill lines use category mapping order (CategoriesEditor) per product. */
export function prepareOrderForBill(order) {
  if (!order) return order;
  const accessoriesByItem = new Map();
  const external = [];
  for (const raw of order.accessories || []) {
    const a = normalizeBillLine(raw);
    if (a.order_item_id) {
      if (!accessoriesByItem.has(a.order_item_id)) accessoriesByItem.set(a.order_item_id, []);
      accessoriesByItem.get(a.order_item_id).push(a);
    } else {
      external.push(a);
    }
  }
  const accessories = [];
  for (const list of accessoriesByItem.values()) {
    accessories.push(...sortAccessoriesByDisplayOrder(list));
  }
  accessories.push(...sortAccessoriesByDisplayOrder(external));
  return {
    ...order,
    items: (order.items || []).map(normalizeBillLine),
    accessories,
  };
}

function itemNameCell(cfg, line, { isAccessory, isSale, parentProduct }) {
  const saleTag = isSale ? ' <span class="muted">(Sale)</span>' : '';
  if (isAccessory) {
    const cat = String(line.category_name || '').trim();
    const catPart = cat ? `<b>${esc(cat)}</b> · ` : '';
    const parentPart =
      !isSale && parentProduct && (parentProduct.code_snapshot || parentProduct.name_snapshot)
        ? `<div class="muted">${esc(parentProduct.code_snapshot || '')}${parentProduct.code_snapshot && parentProduct.name_snapshot ? ' · ' : ''}${esc(parentProduct.name_snapshot || '')}</div>`
        : '';
    const givenLabel = !isSale && !isSellLine(line) ? formatAccessoryGivenStatusLabel(line) : '';
    const accTag = givenLabel
      ? `<span class="muted">(acc. · ${esc(givenLabel)})</span>`
      : '<span class="muted">(acc.)</span>';
    return `${parentPart}${catPart}${esc(line.name_snapshot)} ${accTag}${saleTag}`;
  }
  const code =
    !isSale && cfg.show_code && line.code_snapshot
      ? `<div class="item-code">${esc(line.code_snapshot)}</div>`
      : '';
  return `${esc(line.name_snapshot)}${saleTag}${code}`;
}

function itemsBlock(tpl, order) {
  const cfg = tpl.items_config;
  const rows = [];
  const headers = ['<th>Item</th>'];
  if (cfg.show_qty) headers.push('<th class="right">Qty</th>');
  headers.push('<th class="right">Price</th>');
  if (cfg.show_discount) headers.push('<th class="right">Disc</th>');
  if (cfg.show_tax) headers.push('<th class="right">Tax</th>');
  headers.push('<th class="right">Total</th>');
  const colSpan = headers.length;

  const billOrder = {
    ...order,
    items: (order.items || []).map(normalizeBillLine),
    accessories: (order.accessories || []).map(normalizeBillLine),
  };
  const parts = partitionOrderForBill(billOrder);

  const hasRentSection =
    parts.rentItems.length > 0 ||
    parts.rentAccessoriesByItem.size > 0 ||
    parts.rentExternal.length > 0;
  const hasSaleSection =
    parts.saleItems.length > 0 ||
    parts.saleAccessoriesByItem.size > 0 ||
    parts.saleExternal.length > 0 ||
    parts.saleDetachedFromProducts.length > 0;
  const showRentSaleHeaders = hasRentSection && hasSaleSection;
  const { rentSubtotal, saleSubtotal } = computeRentSaleSubtotalsFromPartition(parts);

  const pushLineRow = (line, { isAccessory, isSale, parentProduct }) => {
    const cells = [];
    cells.push(`<td>${itemNameCell(cfg, line, { isAccessory, isSale, parentProduct })}</td>`);
    if (cfg.show_qty) cells.push(`<td class="right">${line.qty}</td>`);
    cells.push(`<td class="right">${formatCurrency(line.price)}</td>`);
    if (cfg.show_discount)
      cells.push(`<td class="right">${formatCurrency(line.discount || 0)}</td>`);
    if (cfg.show_tax) cells.push(`<td class="right">${formatCurrency(line.tax || 0)}</td>`);
    cells.push(`<td class="right">${formatCurrency(line.total)}</td>`);
    const classes = [];
    if (isAccessory) classes.push('item-acc');
    if (isSale) classes.push('item-sale');
    const rowClass = classes.length ? ` class="${classes.join(' ')}"` : '';
    rows.push(`<tr${rowClass}>${cells.join('')}</tr>`);
  };

  const pushSectionRow = (label, { sale } = {}) => {
    const cls = sale ? 'section-row section-row-sale' : 'section-row';
    rows.push(`<tr class="${cls}"><td colspan="${colSpan}">${esc(label)}</td></tr>`);
  };

  const pushSubtotalRow = (label, amount, kind) => {
    const kindClass = kind === 'sale' ? 'subtotal-row-sale' : 'subtotal-row-rent';
    rows.push(
      `<tr class="section-subtotal ${kindClass}">` +
        `<td colspan="${colSpan - 1}">${esc(label)}</td>` +
        `<td class="right">${formatCurrency(amount)}</td>` +
        `</tr>`
    );
  };

  if (showRentSaleHeaders && hasRentSection) {
    pushSectionRow('Rental items');
  }

  for (const item of parts.rentItems) {
    pushLineRow(item, { isAccessory: false, isSale: isSellLine(item) });
    if (cfg.show_accessories) {
      for (const acc of parts.rentAccessoriesByItem.get(String(item.id)) || []) {
        pushLineRow(acc, { isAccessory: true, isSale: false });
      }
    }
  }

  if (cfg.show_accessories && parts.rentExternal.length > 0) {
    if (!showRentSaleHeaders) pushSectionRow('External accessories');
    else pushSectionRow('External rental accessories');
    for (const acc of parts.rentExternal) {
      pushLineRow(acc, { isAccessory: true, isSale: false });
    }
  }

  if (showRentSaleHeaders && hasRentSection) {
    pushSubtotalRow('Rent subtotal', rentSubtotal, 'rent');
  }

  if (hasSaleSection) {
    pushSectionRow('Sale items', { sale: true });
    for (const item of parts.saleItems) {
      pushLineRow(item, { isAccessory: false, isSale: true });
      if (cfg.show_accessories) {
        for (const acc of parts.saleAccessoriesByItem.get(String(item.id)) || []) {
          pushLineRow(acc, { isAccessory: true, isSale: true });
        }
      }
    }
    for (const { accessory, parentItem } of parts.saleDetachedFromProducts) {
      pushLineRow(accessory, {
        isAccessory: true,
        isSale: true,
        parentProduct: parentItem,
      });
    }
    if (cfg.show_accessories && parts.saleExternal.length > 0) {
      for (const acc of parts.saleExternal) {
        pushLineRow(acc, { isAccessory: true, isSale: true });
      }
    }
    if (showRentSaleHeaders) {
      pushSubtotalRow('Sale subtotal', saleSubtotal, 'sale');
    }
  }

  return `
    <div class="items-wrap">
      <table class="items">
        <thead><tr>${headers.join('')}</tr></thead>
        <tbody>${rows.join('') || `<tr><td colspan="${colSpan}" class="muted">No items</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

/**
 * @param {Array<{ category?: string, amount?: number, is_deleted?: boolean, notes?: string }>} payments
 * @param {string} category
 */
function sumBillPaymentsByCategory(payments, category) {
  return (payments || [])
    .filter((p) => p?.category === category && !p?.is_deleted)
    .reduce((s, p) => s + Number(p?.amount || 0), 0);
}

/**
 * Split bill payments for print: credit note apply vs cash (advance/partial/final).
 * @param {object|null|undefined} order
 */
export function summarizeBillPaymentTotals(order) {
  const payments = (order?.payments || []).filter((p) => !p?.is_deleted);
  const creditNoteApplied = round2(sumBillPaymentsByCategory(payments, 'credit_note_apply'));
  const cashPaid = round2(
    sumBillPaymentsByCategory(payments, 'advance') +
      sumBillPaymentsByCategory(payments, 'partial') +
      sumBillPaymentsByCategory(payments, 'final')
  );
  const balance = round2(Number(order?.balance ?? 0));
  const creditNoteRefs = payments
    .filter((p) => p?.category === 'credit_note_apply')
    .map((p) => String(p.notes || '').trim())
    .filter(Boolean);
  return {
    creditNoteApplied,
    cashPaid,
    balance,
    creditNoteRefs,
    hasCredit: creditNoteApplied > 0,
  };
}

function totalsBlock(tpl, order) {
  const billOrder = {
    ...order,
    items: (order.items || []).map(normalizeBillLine),
    accessories: (order.accessories || []).map(normalizeBillLine),
  };
  const parts = partitionOrderForBill(billOrder);
  const { rentSubtotal, saleSubtotal } = computeRentSaleSubtotalsFromPartition(parts);
  const showSplit = rentSubtotal > 0 && saleSubtotal > 0;
  const pay = summarizeBillPaymentTotals(order);

  const splitRows = showSplit
    ? `<tr class="rent-subtotal"><td>Rent subtotal</td><td class="right">${formatCurrency(rentSubtotal)}</td></tr>
        <tr class="sale-subtotal"><td>Sale subtotal</td><td class="right">${formatCurrency(saleSubtotal)}</td></tr>`
    : '';

  const creditDetailRow =
    pay.hasCredit && pay.creditNoteRefs.length
      ? `<tr class="credit-applied-detail"><td colspan="2">${esc(pay.creditNoteRefs.join(', '))}</td></tr>`
      : '';

  const paymentRows = pay.hasCredit
    ? `<tr class="credit-applied"><td>Credit note applied</td><td class="right">${formatCurrency(pay.creditNoteApplied)}</td></tr>
        ${creditDetailRow}
        ${pay.cashPaid > 0 ? `<tr><td>Paid (cash)</td><td class="right">${formatCurrency(pay.cashPaid)}</td></tr>` : ''}
        <tr class="balance"><td>You give</td><td class="right">${formatCurrency(pay.balance)}</td></tr>`
    : `<tr><td>Paid</td><td class="right">${formatCurrency(order.paid_amount || 0)}</td></tr>
        <tr class="balance"><td>Balance due</td><td class="right">${formatCurrency(order.balance || 0)}</td></tr>`;

  return `
    <div class="totals-wrap">
      <table class="totals">
        ${splitRows}
        <tr><td>Subtotal</td><td class="right">${formatCurrency(order.subtotal || order.total_amount)}</td></tr>
        ${order.discount_amount ? `<tr><td>Discount</td><td class="right">${formatCurrency(order.discount_amount)}</td></tr>` : ''}
        ${order.tax_amount ? `<tr><td>Tax</td><td class="right">${formatCurrency(order.tax_amount)}</td></tr>` : ''}
        ${order.security_deposit ? `<tr><td>Security deposit</td><td class="right">${formatCurrency(order.security_deposit)}</td></tr>` : ''}
        <tr class="grand-total"><td>Grand total</td><td class="right">${formatCurrency(order.total_amount)}</td></tr>
        ${paymentRows}
      </table>
    </div>
  `;
}

function footerBlock(tpl, renderOptions = {}) {
  const { footer_config, paper_size } = tpl;
  const thermal = isThermal(paper_size);
  const parts = [];
  const termsText =
    renderOptions.footerTermsOverride !== undefined
      ? String(renderOptions.footerTermsOverride || '').trim()
      : String(footer_config.terms || '').trim();
  if (termsText) {
    parts.push(
      `<div class="terms-card"><div class="section-label">Terms & conditions</div><div>${esc(termsText)}</div></div>`
    );
  }
  if (!thermal && footer_config.show_signature) {
    parts.push(`
      <div class="sig-row">
        <div class="sig">Customer Signature</div>
        <div class="sig">Authorised Signatory</div>
      </div>
    `);
  }
  if (footer_config.thank_you) {
    parts.push(`<div class="foot">${esc(footer_config.thank_you)}</div>`);
  }
  return parts.join('');
}

/** Shop-wide bill notes from App Settings (HTML), rendered at the end of the invoice. */
export function billNotesBlock(billNotesHtml) {
  const raw = String(billNotesHtml || '').trim();
  if (!raw) return '';
  return `
    <section class="bill-notes-card">
      <div class="section-label">Notes</div>
      <div class="bill-notes-body">${raw}</div>
    </section>
  `;
}

function renderManualTextSegment(text, scalarTokens) {
  return esc(
    String(text || '').replace(/{{\s*([a-z_]+)\s*}}/gi, (token, rawKey) => {
      const key = String(rawKey || '').toLowerCase();
      return Object.hasOwn(scalarTokens, key) ? scalarTokens[key] : token;
    })
  ).replace(/\r?\n/g, '<br>');
}

function manualBillBody({ tpl, billOrder, order, shopInfo, renderOptions, billNotesHtml }) {
  const source = String(tpl.custom_content?.text || DEFAULT_MANUAL_BILL_CONTENT);
  const blocks = {
    header: headerBlock(tpl, shopInfo, order),
    customer: customerBlock(tpl, order, renderOptions),
    items: itemsBlock(tpl, billOrder),
    totals: totalsBlock(tpl, billOrder),
    footer: footerBlock(tpl, renderOptions),
    notes: billNotesBlock(billNotesHtml),
  };
  const scalarTokens = {
    shop_name: shopInfo.name,
    bill_number: order?.order_number || order?.bill_no || '',
    customer_name: order?.pickup_name || order?.customer_name || '',
    pickup_date: order?.pickup_date ? formatDate(order.pickup_date) : '',
    return_date: order?.return_date ? formatDate(order.return_date) : '',
    total: formatCurrency(
      billOrder?.total_amount ?? billOrder?.grand_total ?? billOrder?.total ?? 0
    ),
  };
  const blockPattern = /{{\s*(header|customer|items|totals|footer|notes)\s*}}/gi;
  const parts = [];
  let cursor = 0;
  let match = blockPattern.exec(source);
  while (match) {
    parts.push(renderManualTextSegment(source.slice(cursor, match.index), scalarTokens));
    parts.push(blocks[String(match[1]).toLowerCase()] || '');
    cursor = match.index + match[0].length;
    match = blockPattern.exec(source);
  }
  parts.push(renderManualTextSegment(source.slice(cursor), scalarTokens));
  return parts.join('');
}

/**
 * Render a full bill HTML document for the given order and template.
 * Shop is expected to look like `{ name, address, phone }`.
 */
export function renderBillHtml({
  order,
  template,
  shop,
  title,
  billNotesHtml = '',
  renderOptions = {},
}) {
  const billOrder = prepareOrderForBill(order);
  const tpl = mergeTemplate(template);
  const shopInfo = {
    name: shop?.name || '',
    address: shop?.address || '',
    phone: shop?.phone || '',
  };
  const docTitle =
    title || [shopInfo.name, order?.order_number].filter(Boolean).join(' — ') || 'Invoice';

  const body = tpl.custom_content?.enabled
    ? manualBillBody({ tpl, billOrder, order, shopInfo, renderOptions, billNotesHtml })
    : `
      ${headerBlock(tpl, shopInfo, order)}
      ${customerBlock(tpl, order, renderOptions)}
      ${itemsBlock(tpl, billOrder)}
      ${totalsBlock(tpl, billOrder)}
      ${footerBlock(tpl, renderOptions)}
      ${billNotesBlock(billNotesHtml)}
    `;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(docTitle)}</title>${pageStyles(tpl)}</head><body><div class="bill-document">${body}</div></body></html>`;
}

/** A lightweight sample order used for the live preview. */
export const SAMPLE_ORDER = {
  order_number: 'INV-0001',
  booking_date: todayIndiaISODate(),
  pickup_date: toLocalISODate(addDays(new Date(), 2)),
  return_date: toLocalISODate(addDays(new Date(), 4)),
  pickup_name: 'Rahul Sharma',
  pickup_number: '9876543210',
  reference_name: 'Priya Sharma',
  items: [
    {
      id: 'item-1',
      name_snapshot: 'Royal Sherwani - Maroon',
      code_snapshot: 'SH-001',
      qty: 1,
      price: 3500,
      discount: 500,
      tax: 0,
      total: 3000,
    },
    {
      id: 'item-2',
      name_snapshot: 'Classic Tuxedo - Black',
      code_snapshot: 'TX-014',
      qty: 1,
      price: 2800,
      discount: 0,
      tax: 0,
      total: 2800,
    },
  ],
  accessories: [
    {
      order_item_id: 'item-1',
      category_name: 'Headwear',
      name_snapshot: 'Silk Turban',
      given_status: 'given_with_rent',
      qty: 1,
      price: 350,
      discount: 0,
      tax: 0,
      total: 350,
    },
    {
      category_name: 'Footwear',
      name_snapshot: 'Embroidered Mojari',
      given_status: 'pack_with_rent',
      qty: 1,
      price: 200,
      discount: 0,
      tax: 0,
      total: 200,
    },
  ],
  subtotal: 6850,
  discount_amount: 500,
  tax_amount: 0,
  security_deposit: 1000,
  total_amount: 6350,
  paid_amount: 3000,
  balance: 3350,
  customer_address: '12 MG Road, Ahmedabad, Gujarat',
  customer_notes: 'Handle embroidery with care. Pickup between 10am–12pm.',
};
