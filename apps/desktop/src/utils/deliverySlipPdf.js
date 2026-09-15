import { jsPDF } from 'jspdf';

import {
  buildAccessoryTokenSlipFields,
  buildProductTokenSlipFields,
  resolveSlipProductCode,
} from '../lib/deliverySlipFormat.js';
import { barcodeToDataUrl } from './barcodePdf.js';
import { pdfSafeText, printJsPdfDoc } from './tablePdf.js';

const BLACK = [0, 0, 0];
const GAP_ROW = 6;
const COL_GAP = 5;
const BARCODE_MAX_WIDTH_MM = 42;
const BARCODE_MAX_HEIGHT_MM = 14;
const BARCODE_GAP = 2;
/** Extra space (mm) between bold label and value — label width is measured in bold. */
const LABEL_VALUE_GAP = 2;

const DEFAULT_TOKEN_LAYOUT = Object.freeze({
  widthMm: 92,
  minHeightMm: 0,
  fontSize: 9,
  pageMarginMm: 10,
  slipPaddingMm: 4,
});

function clampedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeTokenLayout(settings = {}) {
  const fontSize = clampedNumber(settings.fontSize, DEFAULT_TOKEN_LAYOUT.fontSize, 6, 18);
  return {
    widthMm: clampedNumber(settings.widthMm, DEFAULT_TOKEN_LAYOUT.widthMm, 50, 190),
    minHeightMm: clampedNumber(settings.minHeightMm, DEFAULT_TOKEN_LAYOUT.minHeightMm, 0, 280),
    fontSize,
    lineHeightMm: Math.max(3.5, Number((fontSize * 0.56).toFixed(3))),
    pageMarginMm: clampedNumber(settings.pageMarginMm, DEFAULT_TOKEN_LAYOUT.pageMarginMm, 3, 25),
    slipPaddingMm: clampedNumber(settings.slipPaddingMm, DEFAULT_TOKEN_LAYOUT.slipPaddingMm, 2, 10),
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
  let imgW = Math.min(BARCODE_MAX_WIDTH_MM, innerWidth);
  let imgH = imgW / aspect;
  if (imgH > BARCODE_MAX_HEIGHT_MM) {
    imgH = BARCODE_MAX_HEIGHT_MM;
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
  let imgW = Math.min(BARCODE_MAX_WIDTH_MM, innerWidth);
  let imgH = imgW / aspect;
  if (imgH > BARCODE_MAX_HEIGHT_MM) {
    imgH = BARCODE_MAX_HEIGHT_MM;
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
  const measuredHeight = measureSlipHeight(doc, target, innerWidth, barcode, layout);
  const slipHeight = Math.max(measuredHeight, layout.minHeightMm);
  const fields = buildTokenSlipFields(target);

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.25);
  doc.rect(x, startY, slipWidth, slipHeight);

  let y = startY + layout.slipPaddingMm + 3;
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
function buildDeliverySlipPdfDocFromPrepared(prepared, settings = {}) {
  if (!prepared.length) return null;

  const layout = normalizeTokenLayout(settings);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const usableWidth = pageW - layout.pageMarginMm * 2;
  const slipsPerRow = Math.max(
    1,
    Math.min(3, Math.floor((usableWidth + COL_GAP) / (layout.widthMm + COL_GAP))) || 1
  );
  const slipWidth = Math.min(layout.widthMm, usableWidth);
  const innerWidth = slipWidth - layout.slipPaddingMm * 2;

  let y = layout.pageMarginMm;

  for (let i = 0; i < prepared.length; i += slipsPerRow) {
    const rowSlips = prepared.slice(i, i + slipsPerRow);
    const heights = rowSlips.map(({ target, barcode }) =>
      Math.max(measureSlipHeight(doc, target, innerWidth, barcode, layout), layout.minHeightMm)
    );
    const rowH = Math.max(...heights, 0) + GAP_ROW;

    if (y + rowH > pageH - layout.pageMarginMm && y > layout.pageMarginMm) {
      doc.addPage();
      y = layout.pageMarginMm;
    }

    rowSlips.forEach(({ target, barcode }, col) => {
      const x = layout.pageMarginMm + col * (slipWidth + COL_GAP);
      drawSlip(doc, target, barcode, x, y, slipWidth, layout);
    });

    y += rowH;
  }

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

/**
 * @param {object[]} orders — per-product slip targets
 * @param {string} [title]
 */
export async function printDeliverySlipPdf(orders, title = 'Print slips', settings = {}) {
  const doc = await buildDeliverySlipPdfDoc(orders, settings);
  if (!doc) return;
  printJsPdfDoc(doc, title);
}

/**
 * @param {object} target — accessory token slip target from buildAccessoryTokenSlipTarget
 * @param {string} [title]
 */
export async function printAccessoryTokenSlipPdf(target, title = 'Accessory token', settings = {}) {
  const doc = await buildAccessoryTokenSlipPdfDoc(target, settings);
  if (!doc) return;
  printJsPdfDoc(doc, title);
}
