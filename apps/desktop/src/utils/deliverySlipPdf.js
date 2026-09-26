import { jsPDF } from 'jspdf';

import {
  buildAccessoryTokenSlipFields,
  buildProductTokenSlipFields,
  resolveSlipProductCode,
} from '../lib/deliverySlipFormat.js';
import { barcodeToDataUrl } from './barcodePdf.js';
import { pdfSafeText } from './tablePdf.js';

const BLACK = [0, 0, 0];
const BARCODE_GAP = 1.2;
/** Extra space (mm) between bold label and value — label width is measured in bold. */
const LABEL_VALUE_GAP = 1.4;

/**
 * Physical sticker is 75 mm wide × 50 mm tall on a 4 in TSC TE244.
 * The print page is a square 4×4 so Chrome/TSC does not rotate it.
 * The 75 mm sticker is centered on that 4 in path (13.3 mm gutter) and
 * inset for the print head — a 50 mm-wide page sits too far left and
 * the first letters print off the label.
 */
export const TOKEN_LABEL_SIZE_MM = Object.freeze({ widthMm: 75, heightMm: 50 });
export const TOKEN_PRINT_PAGE_MM = Object.freeze({ widthMm: 101.6, heightMm: 101.6 });

/**
 * Where the 75×50 token is drawn on the 4×4 page.
 * @param {ReturnType<typeof normalizeTokenLayout>} layout
 */
export function tokenContentOrigin(layout) {
  const pageW = Number(layout?.pageWidthMm) || TOKEN_PRINT_PAGE_MM.widthMm;
  const labelW = Number(layout?.widthMm) || TOKEN_LABEL_SIZE_MM.widthMm;
  const boxW = Math.min(labelW, pageW);
  const gutterMm = Math.max(0, (pageW - boxW) / 2);
  const headInset = Number(layout?.leftMarginMm) || DEFAULT_TOKEN_LAYOUT.leftMarginMm;
  const rightInset = Number(layout?.rightMarginMm) || DEFAULT_TOKEN_LAYOUT.rightMarginMm;
  const top = Number(layout?.topMarginMm) || DEFAULT_TOKEN_LAYOUT.topMarginMm;
  const x = gutterMm + headInset;
  const widthMm = Math.min(boxW - headInset - rightInset, pageW - x - rightInset);
  return {
    x: Number(x.toFixed(2)),
    y: top,
    widthMm: Number(Math.max(24, widthMm).toFixed(2)),
    gutterMm: Number(gutterMm.toFixed(2)),
  };
}

const DEFAULT_TOKEN_LAYOUT = Object.freeze({
  widthMm: TOKEN_LABEL_SIZE_MM.widthMm,
  heightMm: TOKEN_LABEL_SIZE_MM.heightMm,
  pageWidthMm: TOKEN_PRINT_PAGE_MM.widthMm,
  pageHeightMm: TOKEN_PRINT_PAGE_MM.heightMm,
  minHeightMm: 0,
  fontSize: 7,
  pageMarginMm: 2,
  leftMarginMm: 9,
  rightMarginMm: 2,
  topMarginMm: 10,
  bottomMarginMm: 2,
  slipPaddingMm: 1.6,
  barcodeMaxWidthMm: 40,
  barcodeMaxHeightMm: 7,
});

function pageSizeForLabelPrinter(widthMm, heightMm) {
  const shortSide = Math.min(widthMm, heightMm);
  const longSide = Math.max(widthMm, heightMm);
  if (shortSide >= 45 && shortSide <= 55 && longSide >= 70 && longSide <= 80) {
    return { widthMm: longSide, heightMm: shortSide };
  }
  return { widthMm, heightMm };
}

function clampedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function looksLikeLegacyA4Token(settings = {}) {
  const width = Number(settings.widthMm);
  const height = Number(settings.heightMm);
  const margin = Number(settings.pageMarginMm);
  const legacyWidth = !Number.isFinite(width) || width >= 90;
  const missingHeight = !Number.isFinite(height) || height <= 0;
  const legacyMargin = !Number.isFinite(margin) || margin >= 8;
  return legacyWidth && missingHeight && legacyMargin;
}

export function normalizeTokenLayout(settings = {}) {
  const legacy = looksLikeLegacyA4Token(settings);
  const fontSize = clampedNumber(
    settings.fontSize,
    DEFAULT_TOKEN_LAYOUT.fontSize,
    5.5,
    12
  );
  const rawSize = pageSizeForLabelPrinter(
    legacy
      ? TOKEN_LABEL_SIZE_MM.widthMm
      : clampedNumber(settings.widthMm, DEFAULT_TOKEN_LAYOUT.widthMm, 40, 80),
    legacy
      ? TOKEN_LABEL_SIZE_MM.heightMm
      : clampedNumber(settings.heightMm, DEFAULT_TOKEN_LAYOUT.heightMm, 40, 80)
  );
  return {
    widthMm: rawSize.widthMm,
    heightMm: rawSize.heightMm,
    pageWidthMm: DEFAULT_TOKEN_LAYOUT.pageWidthMm,
    pageHeightMm: DEFAULT_TOKEN_LAYOUT.pageHeightMm,
    minHeightMm: 0,
    fontSize,
    lineHeightMm: Math.max(2.8, Number((fontSize * 0.48).toFixed(3))),
    pageMarginMm: DEFAULT_TOKEN_LAYOUT.pageMarginMm,
    leftMarginMm: DEFAULT_TOKEN_LAYOUT.leftMarginMm,
    rightMarginMm: DEFAULT_TOKEN_LAYOUT.rightMarginMm,
    topMarginMm: DEFAULT_TOKEN_LAYOUT.topMarginMm,
    bottomMarginMm: DEFAULT_TOKEN_LAYOUT.bottomMarginMm,
    slipPaddingMm: clampedNumber(
      settings.slipPaddingMm,
      DEFAULT_TOKEN_LAYOUT.slipPaddingMm,
      1.2,
      4
    ),
    barcodeMaxWidthMm: DEFAULT_TOKEN_LAYOUT.barcodeMaxWidthMm,
    barcodeMaxHeightMm: DEFAULT_TOKEN_LAYOUT.barcodeMaxHeightMm,
  };
}

/**
 * @param {object} target
 * @returns {boolean}
 */
function isAccessorySlip(target) {
  return target?.slipKind === 'accessory';
}

/**
 * @param {object} target
 * @returns {Array<{ label: string, value?: string, wrap?: boolean, richSegments?: Array<{ category: string, name: string }> }>}
 */
function buildTokenSlipFields(target) {
  return isAccessorySlip(target)
    ? buildAccessoryTokenSlipFields(target)
    : buildProductTokenSlipFields(target);
}

/**
 * Relative width (mm) of "Label:" in bold plus gap — add slip field `x` for absolute value X.
 * @param {jsPDF} doc
 * @param {string} label
 * @returns {number}
 */
function labelValueOffset(doc, label, layout) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(layout.fontSize);
  return doc.getTextWidth(`${label}:`) + LABEL_VALUE_GAP;
}

/**
 * @param {jsPDF} doc
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapPlain(doc, text, maxWidth) {
  const t = pdfSafeText(text);
  if (!t) return [];
  return doc.splitTextToSize(t, maxWidth);
}

/**
 * Flatten accessory segments into drawable parts for line wrapping.
 * @param {Array<{ category: string, name: string }>} segments
 * @returns {Array<{ text: string, bold: boolean }>}
 */
function flattenAccessorySegments(segments) {
  const list = Array.isArray(segments) ? segments : [];
  /** @type {Array<{ text: string, bold: boolean }>} */
  const parts = [];
  list.forEach((seg, idx) => {
    if (idx > 0) parts.push({ text: ', ', bold: false });
    if (seg.category) parts.push({ text: seg.category, bold: true });
    if (seg.name) parts.push({ text: ` ${seg.name}`, bold: false });
  });
  return parts;
}

/**
 * @param {jsPDF} doc
 * @param {Array<{ text: string, bold: boolean }>} parts
 * @param {number} maxWidth
 * @returns {number}
 */
function measureRichPartsHeight(doc, parts, maxWidth, layout) {
  if (!parts.length) return layout.lineHeightMm;
  doc.setFontSize(layout.fontSize);
  let lines = 1;
  let x = 0;
  for (const part of parts) {
    doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
    const w = doc.getTextWidth(part.text);
    if (x > 0 && x + w > maxWidth) {
      lines += 1;
      x = w;
    } else {
      x += w;
    }
  }
  return lines * layout.lineHeightMm;
}

/**
 * @param {jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} maxWidth
 * @param {Array<{ text: string, bold: boolean }>} parts
 * @returns {number}
 */
function drawRichParts(doc, x, y, maxWidth, parts, layout) {
  if (!parts.length) {
    doc.setFont('helvetica', 'normal');
    doc.text('—', x, y);
    return y + layout.lineHeightMm;
  }

  doc.setFontSize(layout.fontSize);
  doc.setTextColor(...BLACK);
  let cursorX = x;
  let cursorY = y;

  for (const part of parts) {
    doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
    const w = doc.getTextWidth(part.text);
    if (cursorX > x && cursorX + w > x + maxWidth) {
      cursorY += layout.lineHeightMm;
      cursorX = x;
    }
    doc.text(part.text, cursorX, cursorY);
    cursorX += w;
  }

  return cursorY + layout.lineHeightMm;
}

/**
 * @param {jsPDF} doc
 * @param {Array<{ label: string, value?: string, wrap?: boolean, richSegments?: Array<{ category: string, name: string }> }>} fields
 * @param {number} innerWidth
 * @returns {number}
 */
function measureFieldsHeight(doc, fields, innerWidth, layout) {
  let h = 0;
  for (const field of fields) {
    doc.setFontSize(layout.fontSize);
    const valueX = labelValueOffset(doc, field.label, layout);
    const maxW = innerWidth - valueX;

    if (field.richSegments) {
      const parts = flattenAccessorySegments(field.richSegments);
      h += measureRichPartsHeight(doc, parts, maxW, layout);
      continue;
    }

    const maxFieldW = field.wrap ? maxW : innerWidth;
    const lines = field.wrap ? wrapPlain(doc, field.value || '—', maxFieldW).length || 1 : 1;
    h += lines * layout.lineHeightMm;
  }
  return h;
}

/**
 * @param {object} target
 * @param {{ dataUrl: string, widthPx: number, heightPx: number } | null} barcode
 * @param {number} innerWidth
 * @returns {number}
 */
function measureBarcodeBlockHeight(target, barcode, innerWidth, layout) {
  if (isAccessorySlip(target)) return 0;
  let h = layout.lineHeightMm;
  if (!barcode?.dataUrl) return h + layout.lineHeightMm;
  const aspect = barcode.widthPx / barcode.heightPx;
  const maxW = layout.barcodeMaxWidthMm ?? 34;
  const maxH = layout.barcodeMaxHeightMm ?? 8;
  let imgW = Math.min(maxW, innerWidth);
  let imgH = imgW / aspect;
  if (imgH > maxH) {
    imgH = maxH;
    imgW = imgH * aspect;
  }
  h += imgH + BARCODE_GAP;
  return h;
}

/**
 * @param {jsPDF} doc
 * @param {object} target
 * @param {number} innerWidth
 * @param {{ dataUrl: string, widthPx: number, heightPx: number } | null} barcode
 * @returns {number}
 */
function measureSlipHeight(doc, target, innerWidth, barcode, layout) {
  const fields = buildTokenSlipFields(target);
  return (
    layout.slipPaddingMm * 2 +
    2 +
    measureFieldsHeight(doc, fields, innerWidth, layout) +
    measureBarcodeBlockHeight(target, barcode, innerWidth, layout)
  );
}

/**
 * @param {jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} innerWidth
 * @param {Array<{ label: string, value?: string, wrap?: boolean, richSegments?: Array<{ category: string, name: string }> }>} fields
 */
function drawFields(doc, x, y, innerWidth, fields, layout) {
  doc.setFontSize(layout.fontSize);
  doc.setTextColor(...BLACK);

  for (const field of fields) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${field.label}:`, x, y);
    const labelW = labelValueOffset(doc, field.label, layout);
    const valueX = x + labelW;
    const valueMaxW = innerWidth - labelW;

    if (field.richSegments) {
      const parts = flattenAccessorySegments(field.richSegments);
      y = drawRichParts(doc, valueX, y, valueMaxW, parts, layout);
      continue;
    }

    doc.setFont('helvetica', 'normal');
    const display = field.value || '—';

    if (field.wrap) {
      const valueLines = wrapPlain(doc, display, valueMaxW);
      if (!valueLines.length) {
        doc.text('—', valueX, y);
        y += layout.lineHeightMm;
      } else {
        valueLines.forEach((line) => {
          doc.text(line, valueX, y);
          y += layout.lineHeightMm;
        });
      }
    } else {
      doc.text(display, valueX, y);
      y += layout.lineHeightMm;
    }
  }

  return y;
}

/**
 * @param {jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} innerWidth
 * @param {{ dataUrl: string, widthPx: number, heightPx: number } | null} barcode
 * @returns {number}
 */
function drawBarcodeBlock(doc, x, y, innerWidth, barcode, layout) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(layout.fontSize);
  doc.text('PRODUCT BARCODE:', x, y);
  y += layout.lineHeightMm;

  if (!barcode?.dataUrl) {
    doc.setFont('helvetica', 'normal');
    doc.text('—', x, y);
    return y + layout.lineHeightMm;
  }

  const aspect = barcode.widthPx / barcode.heightPx;
  const maxW = layout.barcodeMaxWidthMm ?? 34;
  const maxH = layout.barcodeMaxHeightMm ?? 8;
  let imgW = Math.min(maxW, innerWidth);
  let imgH = imgW / aspect;
  if (imgH > maxH) {
    imgH = maxH;
    imgW = imgH * aspect;
  }

  doc.addImage(barcode.dataUrl, 'PNG', x, y, imgW, imgH);
  return y + imgH + BARCODE_GAP;
}

/**
 * @param {jsPDF} doc
 * @param {object} target
 * @param {{ dataUrl: string, widthPx: number, heightPx: number } | null} barcode
 * @param {number} x
 * @param {number} startY
 * @param {number} slipWidth
 * @returns {number} slip height
 */
function drawSlip(doc, target, barcode, x, startY, slipWidth, layout) {
  const innerWidth = slipWidth - layout.slipPaddingMm * 2;
  const maxHeight =
    layout.heightMm - (layout.topMarginMm ?? layout.pageMarginMm) - (layout.bottomMarginMm ?? layout.pageMarginMm);
  const measuredHeight = measureSlipHeight(doc, target, innerWidth, barcode, layout);
  const slipHeight = Math.min(Math.max(measuredHeight, layout.minHeightMm || 0), maxHeight);
  const fields = buildTokenSlipFields(target);

  let y = startY + layout.slipPaddingMm + 1.6;
  y = drawFields(doc, x + layout.slipPaddingMm, y, innerWidth, fields, layout);
  if (!isAccessorySlip(target)) {
    drawBarcodeBlock(doc, x + layout.slipPaddingMm, y, innerWidth, barcode, layout);
  }

  return slipHeight;
}

/**
 * @param {object[]} targets
 * @returns {Promise<Array<{ target: object, barcode: { dataUrl: string, widthPx: number, heightPx: number } | null }>>}
 */
async function prepareSlipRows(targets) {
  const list = Array.isArray(targets) ? targets : [];
  return Promise.all(
    list.map(async (target) => {
      if (isAccessorySlip(target)) {
        return { target, barcode: null };
      }
      const item = Array.isArray(target?.items) ? target.items[0] : null;
      const code = resolveSlipProductCode(item, target);
      const barcode = await barcodeToDataUrl(code);
      return { target, barcode };
    })
  );
}

/**
 * @param {Array<{ target: object, barcode: { dataUrl: string, widthPx: number, heightPx: number } | null }>} prepared
 * @returns {import('jspdf').jsPDF | null}
 */
function shrinkLayoutToFit(doc, target, barcode, layout) {
  const origin = tokenContentOrigin(layout);
  const top = layout.topMarginMm ?? layout.pageMarginMm;
  const bottom = layout.bottomMarginMm ?? layout.pageMarginMm;
  const slipWidth = origin.widthMm;
  const maxHeight = layout.heightMm - top - bottom;
  const innerWidth = slipWidth - layout.slipPaddingMm * 2;
  let fitted = { ...layout };
  for (let step = 0; step < 6; step += 1) {
    const needed = measureSlipHeight(doc, target, innerWidth, barcode, fitted);
    if (needed <= maxHeight) return fitted;
    const nextFont = Math.max(5.5, fitted.fontSize - 0.5);
    fitted = {
      ...fitted,
      fontSize: nextFont,
      lineHeightMm: Math.max(2.6, Number((nextFont * 0.46).toFixed(3))),
      slipPaddingMm: Math.max(1.2, fitted.slipPaddingMm - 0.2),
      barcodeMaxHeightMm: Math.max(6, (fitted.barcodeMaxHeightMm ?? 8) - 0.8),
    };
  }
  return fitted;
}

function buildDeliverySlipPdfDocFromPrepared(prepared, settings = {}) {
  if (!prepared.length) return null;

  const baseLayout = normalizeTokenLayout(settings);
  const pageFormat = [baseLayout.pageWidthMm, baseLayout.pageHeightMm];
  const orientation = baseLayout.pageWidthMm > baseLayout.pageHeightMm ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    unit: 'mm',
    format: pageFormat,
    orientation,
  });

  prepared.forEach(({ target, barcode }, index) => {
    if (index > 0) doc.addPage(pageFormat, orientation);
    const layout = shrinkLayoutToFit(doc, target, barcode, baseLayout);
    const origin = tokenContentOrigin(layout);
    drawSlip(doc, target, barcode, origin.x, origin.y, origin.widthMm, layout);
  });

  return doc;
}

/**
 * @param {object[]} orders — per-product slip targets
 * @returns {Promise<import('jspdf').jsPDF | null>}
 */
export async function buildDeliverySlipPdfDoc(orders, settings = {}) {
  const prepared = await prepareSlipRows(orders);
  return buildDeliverySlipPdfDocFromPrepared(prepared, settings);
}

/**
 * @param {object} target — accessory token slip target
 * @returns {Promise<import('jspdf').jsPDF | null>}
 */
export async function buildAccessoryTokenSlipPdfDoc(target, settings = {}) {
  if (!target) return null;
  return buildDeliverySlipPdfDocFromPrepared([{ target, barcode: null }], settings);
}

/**
 * @param {string} filename
 * @param {object[]} orders — per-product slip targets
 */
export async function downloadDeliverySlipPdf(filename, orders, settings = {}) {
  const doc = await buildDeliverySlipPdfDoc(orders, settings);
  if (!doc) return;

  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeName);
}

/**
 * @param {string} filename
 * @param {object} target — accessory token slip target from buildAccessoryTokenSlipTarget
 */
export async function downloadAccessoryTokenSlipPdf(filename, target, settings = {}) {
  const doc = await buildAccessoryTokenSlipPdfDoc(target, settings);
  if (!doc) return;

  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeName);
}

function escapeTokenHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function accessorySegmentsHtml(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (!list.length) return '—';
  return list
    .map((seg, idx) => {
      const category = seg.category ? `<b>${escapeTokenHtml(seg.category)}</b>` : '';
      const name = seg.name ? ` ${escapeTokenHtml(seg.name)}` : '';
      return `${idx > 0 ? ', ' : ''}${category}${name}`;
    })
    .join('');
}

function tokenSlipSectionHtml(target, barcode) {
  const fields = buildTokenSlipFields(target);
  const rows = fields
    .map((field) => {
      const value = field.richSegments
        ? accessorySegmentsHtml(field.richSegments)
        : escapeTokenHtml(field.value || '—');
      return `<div class="row"><b>${escapeTokenHtml(field.label)}:</b><span>${value}</span></div>`;
    })
    .join('');

  let barcodeBlock = '';
  if (!isAccessorySlip(target)) {
    barcodeBlock = barcode?.dataUrl
      ? `<div class="row"><b>PRODUCT BARCODE:</b></div><img class="bc" src="${barcode.dataUrl}" alt="" />`
      : `<div class="row"><b>PRODUCT BARCODE:</b><span>—</span></div>`;
  }

  return `<section class="token">${rows}${barcodeBlock}</section>`;
}

export function buildTokenPrintHtml(prepared, settings = {}, title = 'Token') {
  const layout = normalizeTokenLayout(settings);
  const origin = tokenContentOrigin(layout);
  const pages = prepared.map(({ target, barcode }) => tokenSlipSectionHtml(target, barcode)).join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeTokenHtml(title)}</title>
<style>
  @page { size: ${layout.pageWidthMm}mm ${layout.pageHeightMm}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  * { box-sizing: border-box; }
  .token {
    width: ${layout.pageWidthMm}mm;
    height: ${layout.pageHeightMm}mm;
    padding: ${origin.y}mm ${layout.rightMarginMm}mm 2mm ${origin.x}mm;
    font-family: Helvetica, Arial, sans-serif;
    font-size: ${layout.fontSize}pt;
    line-height: 1.35;
    color: #000;
    overflow: hidden;
    page-break-after: always;
  }
  .token:last-child { page-break-after: auto; }
  .row { display: flex; gap: 1.4mm; align-items: flex-start; }
  .row b { white-space: nowrap; }
  .bc { display: block; margin-top: 1mm; max-width: 40mm; height: 7mm; object-fit: contain; }
</style>
</head>
<body>${pages}</body>
</html>`;
}

function printTokenHtml(html, title) {
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
      win?.focus();
      win?.print();
    } catch {
      cleanup();
    }
  };

  if (typeof win?.addEventListener === 'function') {
    win.addEventListener('afterprint', cleanup, { once: true });
  }
  const schedulePrint = () => setTimeout(triggerPrintOnce, 350);
  frame.addEventListener('load', schedulePrint, { once: true });
  setTimeout(schedulePrint, 600);
}

/**
 * @param {object[]} orders — per-product slip targets
 * @param {string} [title]
 */
export async function printDeliverySlipPdf(orders, title = 'Print slips', settings = {}) {
  const prepared = await prepareSlipRows(orders);
  if (!prepared.length) return;
  printTokenHtml(buildTokenPrintHtml(prepared, settings, title), title);
}

/**
 * @param {object} target — accessory token slip target from buildAccessoryTokenSlipTarget
 * @param {string} [title]
 */
export async function printAccessoryTokenSlipPdf(target, title = 'Accessory token', settings = {}) {
  if (!target) return;
  printTokenHtml(buildTokenPrintHtml([{ target, barcode: null }], settings, title), title);
}
