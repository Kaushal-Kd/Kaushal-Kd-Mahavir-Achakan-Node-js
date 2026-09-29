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

import { renderBillBarcodeMarkup } from './billBarcode.js';

export const PAPER_SIZES = [
  { id: 'A4', label: 'A4 — Standard', widthMm: 210, heightMm: 297 },
  { id: 'A5', label: 'A5 — Compact', widthMm: 148, heightMm: 210 },
  { id: 'thermal_80', label: 'Thermal 80mm', widthMm: 80, heightMm: 297 },
  { id: 'thermal_58', label: 'Thermal 58mm', widthMm: 58, heightMm: 297 },
];

/**
 * New A4 letter-pad templates. Artwork: docs/reference/mahavir-achakan-letterpad.pdf
 * (210×297 mm page, 210×251 mm marked print window). Bill CSS already pads 14mm
 * top / 6mm bottom, so these inches only clear the remaining preprinted header.
 */
export const LETTER_PAD_PAGE_SETTINGS = {
  letterhead_top_in: 0.75,
  letterhead_bottom_in: 0.15,
};

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
    show_barcode: false,
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
    letterhead_top_in: 0,
    letterhead_bottom_in: 0,
    token_width_mm: 75,
    token_height_mm: 50,
    token_min_height_mm: 0,
    token_font_size: 7,
    token_page_margin_mm: 1.5,
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

function formatBillAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '';
  return formatCurrency(n);
}

function formatBillQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) < 0.0005) return '';
  return Number.isInteger(n) ? String(n) : String(round2(n));
}

function sumPrintedQty(lines) {
  return (lines || []).reduce((sum, line) => sum + (Number(line?.qty) || 0), 0);
}

function sumAccessoryMapQty(map) {
  let n = 0;
  if (!map) return 0;
  for (const list of map.values()) n += sumPrintedQty(list);
  return n;
}

function firstBillMoney(order, keys) {
  for (const key of keys) {
    const n = Number(order?.[key]);
    if (Number.isFinite(n) && Math.abs(n) >= 0.005) return n;
  }
  return 0;
}

function orderBillDiscount(order) {
  return firstBillMoney(order, ['discount_amount', 'discount_total']);
}

function orderBillTax(order) {
  return firstBillMoney(order, ['tax_amount', 'tax_total']);
}

function orderBillSecurity(order) {
  return firstBillMoney(order, ['security_deposit', 'deposit_amount']);
}

function orderSecurityIsPaid(order) {
  if (order?.paid_security_amt === true || order?.deposit_received === true) return true;
  const expected = orderBillSecurity(order);
  const held = Number(order?.security_held_amount);
  return expected > 0 && Number.isFinite(held) && held >= expected - 0.005;
}

function orderUnpaidSecurity(order) {
  const expected = orderBillSecurity(order);
  if (expected <= 0) return 0;
  const held = Number(order?.security_held_amount);
  if (Number.isFinite(held) && held >= 0) return round2(Math.max(0, expected - held));
  return orderSecurityIsPaid(order) ? 0 : expected;
}

function orderBillBalance(order) {
  const n = Number(order?.balance);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function orderPayableAmount(order, billBalance) {
  const pending = Number.isFinite(Number(billBalance)) ? Math.max(0, Number(billBalance)) : orderBillBalance(order);
  return round2(orderUnpaidSecurity(order) + pending);
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

/** Normal table type for 1–20 printed lines. Shrink starts at 21. */
export const BILL_ONE_PAGE_ROW_MIN = 21;
/** Compact size that keeps ~30–35 lines on one page. */
export const BILL_ONE_PAGE_COMPACT_AT = 30;
/** Hold the compact size through this many lines; longer bills stay this small. */
export const BILL_ONE_PAGE_ROW_MAX = 35;

function countAccessoryMap(map) {
  let n = 0;
  for (const list of map.values()) n += list.length;
  return n;
}

/**
 * Count product + accessory lines that actually print, plus section/subtotal rows.
 * @param {object|null|undefined} order
 * @param {object} [itemsConfig]
 */
export function countBillPrintRows(order, itemsConfig = {}) {
  const showAccessories = itemsConfig.show_accessories !== false;
  const billOrder = {
    ...order,
    items: (order?.items || []).map(normalizeBillLine),
    accessories: (order?.accessories || []).map(normalizeBillLine),
  };
  const parts = partitionOrderForBill(billOrder);
  let rows = parts.rentItems.length + parts.saleItems.length;
  if (showAccessories) {
    rows += countAccessoryMap(parts.rentAccessoriesByItem);
    rows += countAccessoryMap(parts.saleAccessoriesByItem);
    rows += parts.rentExternal.length + parts.saleExternal.length;
  }
  rows += parts.saleDetachedFromProducts.length;
  const hasRentSection =
    parts.rentItems.length > 0 ||
    (showAccessories &&
      (countAccessoryMap(parts.rentAccessoriesByItem) > 0 || parts.rentExternal.length > 0));
  const hasSaleSection =
    parts.saleItems.length > 0 ||
    (showAccessories &&
      (countAccessoryMap(parts.saleAccessoriesByItem) > 0 || parts.saleExternal.length > 0)) ||
    parts.saleDetachedFromProducts.length > 0;
  if (hasRentSection && hasSaleSection) rows += 4;
  else if (hasSaleSection) rows += 1;
  if (showAccessories && parts.rentExternal.length > 0) rows += 1;
  return rows;
}

function roundFontSize(value, min) {
  return Math.max(min, Math.round(Number(value) * 10) / 10);
}

/**
 * Shrink item-table type on A4/A5 so extra lines stay on one page.
 * 1–20 lines keep the normal font; 21–29 ease down; 30–35 use compact type.
 * Thermal bills keep the template font. Bills longer than 35 stay compact.
 * @param {object} tpl
 * @param {object|null|undefined} order
 */
export function applyBillPrintDensity(tpl, order) {
  const rows = countBillPrintRows(order, tpl.items_config);
  const defaultDensity = {
    compact: false,
    rows,
    pad_y: 7,
    pad_x: 10,
    head_pad_y: 8,
    section_pad_y: 6,
  };
  if (isThermal(tpl.paper_size) || rows < BILL_ONE_PAGE_ROW_MIN) {
    return { ...tpl, item_density: defaultDensity };
  }
  const ramp = Math.max(1, BILL_ONE_PAGE_COMPACT_AT - (BILL_ONE_PAGE_ROW_MIN - 1));
  const t = Math.min(1, (rows - (BILL_ONE_PAGE_ROW_MIN - 1)) / ramp);
  const scale = 1 - t * 0.28;
  const base = Number(tpl.typography?.base_size) || 12;
  const product = Number(tpl.typography?.product_size) || base;
  const accessory = Number(tpl.typography?.accessory_size) || Math.max(6, base - 1);
  return {
    ...tpl,
    typography: {
      ...tpl.typography,
      product_size: roundFontSize(product * scale, 8),
      accessory_size: roundFontSize(accessory * scale, 7),
    },
    item_density: {
      compact: true,
      rows,
      pad_y: Math.max(2, Math.round(7 - t * 5)),
      pad_x: Math.max(5, Math.round(10 - t * 4)),
      head_pad_y: Math.max(3, Math.round(8 - t * 5)),
      section_pad_y: Math.max(2, Math.round(6 - t * 4)),
    },
  };
}

function pageStyles(tpl) {
  const { paper_size, typography, colors, page_settings } = tpl;
  const thermal = isThermal(paper_size);
  const size = PAPER_SIZES.find((p) => p.id === paper_size) || PAPER_SIZES[0];
  const pageCss = thermal
    ? `size: ${size.widthMm}mm auto; margin: 3mm;`
    : `size: ${size.widthMm}mm ${size.heightMm}mm; margin: 8mm;`;
  const brand = colors.brand || '#0C6EE1';
  const docPad = thermal ? '3mm 2.5mm 4mm' : '14mm 12mm 6mm';
  // Fall back to base_size for templates saved before these settings existed.
  const productSize = Number(typography.product_size) || typography.base_size;
  const accessorySize = Number(typography.accessory_size) || Math.max(6, typography.base_size - 1);
  const density = tpl.item_density || { pad_y: 7, pad_x: 10, head_pad_y: 8, section_pad_y: 6 };
  const itemPadY = Number(density.pad_y) || 7;
  const itemPadX = Number(density.pad_x) || 10;
  const headPadY = Number(density.head_pad_y) || 8;
  const sectionPadY = Number(density.section_pad_y) || 6;
  const tableLineHeight = density.compact ? 1.15 : 1.35;
  const rawVerticalOffset = Number(page_settings?.vertical_offset_in);
  const verticalOffsetIn = Number.isFinite(rawVerticalOffset)
    ? Math.min(4, Math.max(-2, rawVerticalOffset))
    : 0;
  const letterheadTopIn = thermal
    ? 0
    : Math.min(4, Math.max(0, Number(page_settings?.letterhead_top_in) || 0));
  const letterheadBottomIn = thermal
    ? 0
    : Math.min(4, Math.max(0, Number(page_settings?.letterhead_bottom_in) || 0));
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
        ${thermal ? '' : `padding-top: calc(14mm + ${letterheadTopIn}in);`}
        ${thermal ? '' : `padding-bottom: calc(6mm + ${letterheadBottomIn}in);`}
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
      .brand-rule { height: 2px; background: ${brand}; border-radius: 1px; margin-bottom: 8px; }
      .meta-box .bill-barcode {
        display: block;
        margin: 0 0 8px auto;
        max-width: 180px;
      }
      .meta-box .bill-barcode svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .info-card {
        border: 1px solid ${colors.border};
        border-radius: 4px;
        background: #fafafa;
        padding: 10px 14px;
        margin-bottom: 8px;
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
      .customer-field {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 6px 8px;
        margin-top: 3px;
        align-items: start;
      }
      .customer-field:first-of-type { margin-top: 2px; }
      .pickup-return-box {
        display: inline-block;
        width: max-content;
        max-width: 100%;
        margin-top: 8px;
        border: 1px solid ${colors.border};
        border-radius: 4px;
        padding: 4px 8px;
        background: #fff;
      }
      .pickup-return-box .customer-field {
        grid-template-columns: auto auto;
        margin-top: 2px;
        gap: 6px 10px;
      }
      .pickup-return-box .customer-field:first-of-type { margin-top: 0; }
      .pickup-return-box .field-label,
      .pickup-return-box .field-value {
        font-weight: 700;
        color: #111827;
        white-space: nowrap;
      }
      .field-label {
        font-size: ${typography.base_size - 1}px;
        font-weight: 700;
        color: #4b5563;
        padding-top: 1px;
      }
      .field-value { color: #111827; font-weight: 600; word-break: break-word; }
      .field-value.phone { font-weight: 700; }
      .customer-line { margin-top: 2px; color: #374151; }
      .customer-line.phone { font-weight: 600; color: #111827; }
      .detail-row { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
      .detail-label { font-size: ${typography.base_size - 2}px; font-weight: 600; color: ${colors.muted}; min-width: 64px; }
      .detail-value { color: #111827; font-weight: 600; }
      .notes-box {
        margin-top: 4px;
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
      .remarks-highlight {
        background: #fef9c3;
        border: 1px solid #facc15;
        border-left: 3px solid #ca8a04;
        color: #111827;
        font-weight: 700;
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
      .meta-box .meta-row + .meta-row {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid ${colors.border};
      }
      .meta-box .meta-value { font-size: ${typography.base_size}px; font-weight: 700; color: #111827; }
      .meta-box .meta-value.brand { color: ${brand}; }
      .meta-box .meta-hint { margin-top: 2px; font-size: ${typography.base_size - 2}px; color: ${colors.muted}; }

      .items-wrap {
        border: 1px solid #4b5563;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
      }
      table.items {
        width: 100%;
        border-collapse: collapse;
        font-size: ${typography.base_size}px;
        margin: 0;
        line-height: ${tableLineHeight};
      }
      table.items th {
        background: ${brand};
        color: #fff;
        font-weight: 600;
        font-size: ${typography.base_size - 1}px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        padding: ${headPadY}px ${itemPadX}px;
        border-top: none;
        border-bottom: 1px solid #1d4ed8;
        border-left: none;
        border-right: 1px solid rgba(255, 255, 255, 0.55);
      }
      table.items th:last-child { border-right: none; }
      table.items th:first-child { padding-left: 12px; }
      table.items th:last-child { padding-right: 12px; }
      table.items td {
        padding: ${itemPadY}px ${itemPadX}px;
        border-top: none;
        border-bottom: 1px solid #d1d5db;
        border-left: none;
        border-right: 1px solid #d1d5db;
        vertical-align: top;
        font-size: ${productSize}px;
      }
      table.items td:last-child { border-right: none; }
      table.items th.col-code,
      table.items td.col-code {
        white-space: nowrap;
        width: 1%;
        padding-left: 6px;
        padding-right: 6px;
      }
      table.items th.col-qty,
      table.items td.col-qty,
      table.items th.col-num,
      table.items td.col-num {
        white-space: nowrap;
        width: 1%;
        padding-left: 4px;
        padding-right: 4px;
      }
      .item-code {
        font-weight: 700;
        color: #111827;
        font-size: ${Math.max(6, productSize - 1)}px;
        white-space: nowrap;
      }
      .item-name { font-weight: 700; color: #111827; }
      table.items td:first-child { padding-left: 12px; }
      table.items td:last-child { padding-right: 12px; }
      table.items tbody tr:nth-child(even) td { background: #fafafa; }
      table.items .item-acc td { font-size: ${accessorySize}px; }
      table.items .item-acc td .muted { font-size: ${Math.max(6, accessorySize - 1)}px; }
      table.items .item-acc td:first-child {
        padding-left: 36px;
        color: #4b5563;
      }
      table.items tbody tr.item-acc td,
      table.items tbody tr.item-acc.item-sale td,
      table.items tbody tr:nth-child(even).item-acc td {
        background: #fff;
      }
      .acc-indent { display: inline-block; min-width: 1.25em; }
      .section-row td {
        font-weight: 700;
        font-size: ${typography.base_size - 1}px;
        background: #f3f4f6;
        color: #374151;
        padding: ${sectionPadY}px 12px;
        border-top: none;
        border-bottom: 1px solid #d1d5db;
        border-left: none;
        border-right: none;
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
        padding: ${sectionPadY}px 12px;
        border-top: none;
        border-bottom: 1px solid #d1d5db;
        border-left: none;
        border-right: 1px solid #d1d5db;
      }
      .section-subtotal td:last-child { border-right: none; }
      .subtotal-row-rent td { background: #f9fafb; color: #374151; }
      .subtotal-row-sale td { background: #fffbeb; color: #374151; }
      .subtotal-row-sale td:last-child { color: #b45309; }
      .item-sale td { background: #f0f7ff; }
      table.items tbody tr.item-acc td { background: #fff; }

      .bill-bottom {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 4px;
        margin-top: 2px;
        ${thermal ? 'flex-direction: column;' : ''}
      }
      .bill-bottom-notes {
        flex: 1;
        min-width: 0;
      }
      .bill-bottom-notes .section-label { margin-bottom: 2px; }
      .bill-bottom-notes .notes-block + .notes-block { margin-top: 10px; }
      .notes-card {
        display: inline-block;
        max-width: 100%;
        min-width: 200px;
        border: 1px solid #9ca3af;
        border-radius: 4px;
        padding: 8px 10px;
        background: #fff;
      }
      .totals-wrap {
        display: flex;
        justify-content: flex-end;
        flex-shrink: 0;
        ${thermal ? 'width: 100%;' : ''}
      }
      table.totals {
        width: ${thermal ? '100%' : 'min(280px, 100%)'};
        border-collapse: collapse;
        border: 1px solid ${colors.border};
        border-radius: 4px;
        overflow: hidden;
        font-size: ${typography.base_size}px;
        line-height: 1.2;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      table.totals td { padding: 3px 12px; border-bottom: 1px solid ${colors.border}; }
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
        padding: 5px 12px;
      }
      table.totals .balance td { font-weight: 700; color: ${brand}; page-break-after: avoid; break-after: avoid; }
      table.totals .payable td {
        background: #111827;
        color: #fff;
        font-weight: 700;
        font-size: ${typography.base_size + 1}px;
        padding: 5px 12px;
        border-bottom: none;
        page-break-before: avoid;
        break-before: avoid;
        page-break-inside: avoid;
        break-inside: avoid;
      }
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
        padding: 8px 12px;
        margin-top: 8px;
        background: #fafafa;
      }
      .terms-card .section-label { margin-bottom: 3px; }
      .foot {
        margin-top: 8px;
        padding-top: 6px;
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
      .sig-row { display: flex; justify-content: space-between; gap: 32px; margin-top: 16px; padding: 0 4px; }
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
        table.items .item-acc td { font-size: ${Math.max(6, accessorySize - 1)}px; }
        .bill-header { flex-direction: column; }
        .bill-header-doc { text-align: left; }
        .meta-box .bill-barcode { margin-left: 0; margin-right: auto; max-width: 100%; }
        .sig-row { display: block; }
        .sig { margin-top: 14px; }
        table.items .item-acc td:first-child { padding-left: 20px; }
      `
          : ''
      }
      @media print {
        .no-print { display: none; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        table.items th { border-right: 1px solid rgba(255, 255, 255, 0.7) !important; }
        table.items th:last-child { border-right: none !important; }
        table.items td { border-right: 1px solid #d1d5db !important; border-bottom: 1px solid #d1d5db !important; }
        table.items td:last-child { border-right: none !important; }
        table.items tbody tr.item-acc td { background: #fff !important; }
        table.totals { page-break-inside: avoid; break-inside: avoid; }
        table.totals tr.balance { page-break-after: avoid; break-after: avoid; }
        table.totals tr.payable {
          page-break-before: avoid;
          break-before: avoid;
          page-break-inside: avoid;
          break-inside: avoid;
        }
      }
    </style>
  `;
}

function billBarcodeHtml(tpl, order) {
  if (!tpl.header_config?.show_barcode) return '';
  const orderNo = String(order?.order_number || order?.bill_no || '').trim();
  return renderBillBarcodeMarkup(orderNo, {
    thermal: isThermal(tpl.paper_size),
    displayValue: false,
  });
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

  if (thermal) {
    return `
      <div style="text-align:center;margin-bottom:4px">
        ${logoHtml}
        <div class="shop-name" style="font-size:15px">${esc(shop.name)}</div>
        ${contactHtml}
        <div class="doc-title" style="font-size:13px;margin-top:4px">${docTitle}</div>
        ${orderNo ? `<div class="muted">#${orderNo}</div>` : ''}
      </div>
      <div class="brand-rule" style="margin-bottom:6px"></div>
    `;
  }

  if (!logoHtml) return '';

  return `
    <header class="bill-header">
      <div class="bill-header-brand">${logoHtml}</div>
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

function orderPhone2Name(order) {
  return String(
    order.customer?.phone2_name || order.customer_phone2_name || order.contact2_name || ''
  ).trim();
}

function orderCustomerPhoneLines(order) {
  const phone1 = String(
    order.customer?.phone1 || order.customer_phone || order.pickup_number || ''
  ).trim();
  const phone2 = String(order.customer?.phone2 || order.customer_phone2 || '').trim();
  const phone2Name = orderPhone2Name(order);
  const lines = [];
  const seen = new Set();
  const keyOf = (value) => String(value).replace(/\D/g, '') || value;
  if (phone1) {
    lines.push({ number: phone1, name: '' });
    seen.add(keyOf(phone1));
  }
  if (phone2 && !seen.has(keyOf(phone2))) {
    lines.push({ number: phone2, name: phone2Name });
  }
  return lines.slice(0, 2);
}

function formatBillPhoneLine(line) {
  const number = esc(line.number);
  const name = String(line.name || '').trim();
  if (!name) return number;
  return `${number} (${esc(name)})`;
}

/** Per-order remarks entered on the booking form (not shop-wide bill notes). */
function orderCustomerRemarks(order) {
  return String(order.customer_notes || '').trim();
}

function customerField(label, valueHtml) {
  if (!valueHtml) return '';
  return `<div class="customer-field"><span class="field-label">${esc(label)}</span><span class="field-value">${valueHtml}</span></div>`;
}

function orderReferenceName(order) {
  return String(order?.reference_name || '').trim();
}

function showBillReference(tpl, order) {
  return tpl.bill_info_config.show_reference !== false && orderReferenceName(order);
}

function showBillRemarks(tpl, order) {
  return tpl.bill_info_config.show_booking_notes !== false && orderCustomerRemarks(order);
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
  const orderNo = String(order?.order_number || '').trim();
  if (!bill_info_config.show_customer && !showPickupReturn && !showOrderDate && !showAddress && !orderNo) {
    return '';
  }
  const thermal = isThermal(paper_size);
  const phones = orderCustomerPhoneLines(order);
  const name = orderCustomerName(order);
  const phoneHtml = phones.length ? phones.map((line) => formatBillPhoneLine(line)).join('<br>') : '';
  const pickupReturnFields = showPickupReturn
    ? `<div class="pickup-return-box">${customerField('Pickup:', order.pickup_date ? esc(formatDate(order.pickup_date)) : '—')}${customerField('Return:', order.return_date ? esc(formatDate(order.return_date)) : '—')}</div>`
    : '';

  const customerCol = bill_info_config.show_customer
    ? `
      <div class="info-col">
        ${customerField('Name:', name ? `<span class="customer-name">${esc(name)}</span>` : '—')}
        ${showAddress ? customerField('Address:', esc(orderCustomerAddress(order))) : ''}
        ${customerField('Phone no:', phoneHtml)}
        ${pickupReturnFields}
      </div>
    `
    : [
        showAddress
          ? `<div class="info-col"><div class="section-label">Address</div><div class="customer-line">${esc(orderCustomerAddress(order))}</div></div>`
          : '',
        pickupReturnFields
          ? `<div class="info-col">${pickupReturnFields}</div>`
          : '',
      ]
        .filter(Boolean)
        .join('');

  const bookingDate = order?.booking_date ? formatDate(order.booking_date) : '';
  const dateLabel =
    String(renderOptions.orderDateLabel || (showPickupReturn ? 'Booking date' : 'Date')).trim() ||
    'Date';
  const barcodeHtml = billBarcodeHtml(tpl, order);
  const metaRows = [];
  if (barcodeHtml) {
    metaRows.push(barcodeHtml);
  }
  if (orderNo) {
    metaRows.push(`
      <div class="meta-row">
        <div class="meta-label">Invoice no.</div>
        <div class="meta-value brand">${esc(orderNo)}</div>
      </div>
    `);
  }
  if (bookingDate && (showPickupReturn || showOrderDate)) {
    metaRows.push(`
      <div class="meta-row">
        <div class="meta-label">${esc(dateLabel)}</div>
        <div class="meta-value">${bookingDate}</div>
      </div>
    `);
  }
  const metaBoxes =
    metaRows.length > 0 ? [`<div class="meta-box">${metaRows.join('')}</div>`] : [];
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

function itemNameCell(line, { isAccessory, isSale, parentProduct }) {
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
    return `<span class="acc-indent"></span>${parentPart}${catPart}${esc(line.name_snapshot)} ${accTag}${saleTag}`;
  }
  return `<span class="item-name">${esc(line.name_snapshot)}</span>${saleTag}`;
}

function itemsBlock(tpl, order) {
  const cfg = tpl.items_config;
  const rows = [];
  const headers = [];
  headers.push('<th class="col-item">Item</th>');
  if (cfg.show_code) headers.push('<th class="col-code">Item Code</th>');
  if (cfg.show_qty) headers.push('<th class="right col-qty">Qty</th>');
  headers.push('<th class="right col-num">Price</th>');
  if (cfg.show_discount) headers.push('<th class="right col-num">Disc</th>');
  if (cfg.show_tax) headers.push('<th class="right col-num">Tax</th>');
  headers.push('<th class="right col-num">Total</th>');
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
  const rentQty =
    sumPrintedQty(parts.rentItems) +
    (cfg.show_accessories
      ? sumAccessoryMapQty(parts.rentAccessoriesByItem) + sumPrintedQty(parts.rentExternal)
      : 0);
  const saleQty =
    sumPrintedQty(parts.saleItems) +
    sumPrintedQty((parts.saleDetachedFromProducts || []).map((row) => row.accessory)) +
    (cfg.show_accessories
      ? sumAccessoryMapQty(parts.saleAccessoriesByItem) + sumPrintedQty(parts.saleExternal)
      : 0);

  const pushLineRow = (line, { isAccessory, isSale, parentProduct }) => {
    const cells = [];
    cells.push(`<td>${itemNameCell(line, { isAccessory, isSale, parentProduct })}</td>`);
    if (cfg.show_code) {
      const code = esc(line.code_snapshot || '—');
      cells.push(`<td class="col-code"><span class="item-code">${code}</span></td>`);
    }
    if (cfg.show_qty) cells.push(`<td class="right col-qty">${line.qty}</td>`);
    cells.push(`<td class="right col-num">${formatBillAmount(line.price)}</td>`);
    if (cfg.show_discount)
      cells.push(`<td class="right col-num">${formatBillAmount(line.discount)}</td>`);
    if (cfg.show_tax) cells.push(`<td class="right col-num">${formatBillAmount(line.tax)}</td>`);
    cells.push(`<td class="right col-num">${formatBillAmount(line.total)}</td>`);
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

  const pushSubtotalRow = (label, amount, qty, kind) => {
    const kindClass = kind === 'sale' ? 'subtotal-row-sale' : 'subtotal-row-rent';
    const labelColSpan = cfg.show_code ? 2 : 1;
    const cells = [`<td colspan="${labelColSpan}">${esc(label)}</td>`];
    if (cfg.show_qty) cells.push(`<td class="right col-qty subtotal-qty">${formatBillQty(qty)}</td>`);
    cells.push('<td class="right col-num"></td>');
    if (cfg.show_discount) cells.push('<td class="col-num"></td>');
    if (cfg.show_tax) cells.push('<td class="col-num"></td>');
    cells.push(`<td class="right col-num">${formatBillAmount(amount)}</td>`);
    rows.push(`<tr class="section-subtotal ${kindClass}">${cells.join('')}</tr>`);
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
    pushSubtotalRow('Rent subtotal', rentSubtotal, rentQty, 'rent');
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
      pushSubtotalRow('Sale subtotal', saleSubtotal, saleQty, 'sale');
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
    ? `<tr class="rent-subtotal"><td>Rent subtotal</td><td class="right">${formatBillAmount(rentSubtotal)}</td></tr>
        <tr class="sale-subtotal"><td>Sale subtotal</td><td class="right">${formatBillAmount(saleSubtotal)}</td></tr>`
    : '';

  const creditDetailRow =
    pay.hasCredit && pay.creditNoteRefs.length
      ? `<tr class="credit-applied-detail"><td colspan="2">${esc(pay.creditNoteRefs.join(', '))}</td></tr>`
      : '';

  const paymentRows = pay.hasCredit
    ? `<tr class="credit-applied"><td>Credit note applied</td><td class="right">${formatBillAmount(pay.creditNoteApplied)}</td></tr>
        ${creditDetailRow}
        ${pay.cashPaid > 0 ? `<tr><td>Paid (cash)</td><td class="right">${formatBillAmount(pay.cashPaid)}</td></tr>` : ''}
        <tr class="balance"><td>You give</td><td class="right">${formatBillAmount(pay.balance)}</td></tr>`
    : `<tr><td>Paid</td><td class="right">${formatBillAmount(order.paid_amount)}</td></tr>
        <tr class="balance"><td>Balance due</td><td class="right">${formatBillAmount(order.balance)}</td></tr>`;

  const discountAmount = orderBillDiscount(order);
  const taxAmount = orderBillTax(order);
  const securityAmount = orderBillSecurity(order);
  const billBalance = pay.hasCredit ? pay.balance : orderBillBalance(order);
  const payableAmount = orderPayableAmount(order, billBalance);
  const notesInner = [
    showBillRemarks(tpl, order)
      ? `<div class="notes-block"><div class="section-label">Remarks</div><div class="notes-box remarks-highlight">${esc(orderCustomerRemarks(order))}</div></div>`
      : '',
    showBillReference(tpl, order)
      ? `<div class="notes-block"><div class="section-label">Reference</div><div class="detail-value">${esc(orderReferenceName(order))}</div></div>`
      : '',
    securityAmount
      ? `<div class="notes-block"><div class="section-label">Security</div><div class="detail-value">${formatBillAmount(securityAmount)}</div></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div class="bill-bottom">
      <div class="bill-bottom-notes">
        ${notesInner ? `<div class="notes-card">${notesInner}</div>` : ''}
      </div>
      <div class="totals-wrap">
        <table class="totals">
          ${splitRows}
          <tr><td>Subtotal</td><td class="right">${formatBillAmount(order.subtotal || order.total_amount)}</td></tr>
          ${
            discountAmount
              ? `<tr class="bill-discount"><td>Discount</td><td class="right">${formatBillAmount(discountAmount)}</td></tr>`
              : ''
          }
          ${
            taxAmount
              ? `<tr><td>Tax</td><td class="right">${formatBillAmount(taxAmount)}</td></tr>`
              : ''
          }
          <tr class="grand-total"><td>Grand total</td><td class="right">${formatBillAmount(order.total_amount)}</td></tr>
          ${paymentRows}
          <tr class="payable"><td>Payable amount</td><td class="right">${formatBillAmount(payableAmount)}</td></tr>
        </table>
      </div>
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

function manualBillBody({ tpl, billOrder, order, shopInfo, renderOptions }) {
  const source = String(tpl.custom_content?.text || DEFAULT_MANUAL_BILL_CONTENT);
  const blocks = {
    header: headerBlock(tpl, shopInfo, order),
    customer: customerBlock(tpl, order, renderOptions),
    items: itemsBlock(tpl, billOrder),
    totals: totalsBlock(tpl, billOrder),
    footer: footerBlock(tpl, renderOptions),
    notes: '',
  };
  const scalarTokens = {
    shop_name: shopInfo.name,
    bill_number: order?.order_number || order?.bill_no || '',
    customer_name: order?.pickup_name || order?.customer_name || '',
    pickup_date: order?.pickup_date ? formatDate(order.pickup_date) : '',
    return_date: order?.return_date ? formatDate(order.return_date) : '',
    total: formatBillAmount(
      billOrder?.total_amount ?? billOrder?.grand_total ?? billOrder?.total
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
  billNotesHtml: _billNotesHtml = '',
  renderOptions = {},
}) {
  const billOrder = prepareOrderForBill(order);
  const tpl = applyBillPrintDensity(mergeTemplate(template), billOrder);
  const shopInfo = {
    name: shop?.name || '',
    address: shop?.address || '',
    phone: shop?.phone || '',
  };
  const docTitle =
    title || [shopInfo.name, order?.order_number].filter(Boolean).join(' — ') || 'Invoice';

  const body = tpl.custom_content?.enabled
    ? manualBillBody({ tpl, billOrder, order, shopInfo, renderOptions })
    : `
      ${headerBlock(tpl, shopInfo, order)}
      ${customerBlock(tpl, order, renderOptions)}
      ${itemsBlock(tpl, billOrder)}
      ${totalsBlock(tpl, billOrder)}
      ${footerBlock(tpl, renderOptions)}
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
