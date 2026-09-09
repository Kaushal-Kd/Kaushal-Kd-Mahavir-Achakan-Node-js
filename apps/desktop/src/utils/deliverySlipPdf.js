import { jsPDF } from 'jspdf';

import {
  buildAccessoryTokenSlipFields,
  buildProductTokenSlipFields,
  resolveSlipProductCode,
} from '../lib/deliverySlipFormat.js';
import { barcodeToDataUrl } from './barcodePdf.js';
import { pdfSafeText, printJsPdfDoc } from './tablePdf.js';

const BLACK = [0, 0, 0];
const MARGIN = 10;
const SLIP_PAD = 4;
const FONT_SIZE = 9;
const LINE_H = 5;
const GAP_ROW = 6;
const COL_GAP = 5;
const SLIPS_PER_ROW = 2;
const BARCODE_LABEL_H = LINE_H;
const BARCODE_MAX_WIDTH_MM = 42;
const BARCODE_MAX_HEIGHT_MM = 14;
const BARCODE_GAP = 2;
/** Extra space (mm) between bold label and value — label width is measured in bold. */
const LABEL_VALUE_GAP = 2;

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
  return isAccessorySlip(target) ? buildAccessoryTokenSlipFields(target) : buildProductTokenSlipFields(target);
}

/**
 * Relative width (mm) of "Label:" in bold plus gap — add slip field `x` for absolute value X.
 * @param {jsPDF} doc
 * @param {string} label
 * @returns {number}
 */
function labelValueOffset(doc, label) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_SIZE);
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
function measureRichPartsHeight(doc, parts, maxWidth) {
  if (!parts.length) return LINE_H;
  doc.setFontSize(FONT_SIZE);
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
  return lines * LINE_H;
}

/**
 * @param {jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} maxWidth
 * @param {Array<{ text: string, bold: boolean }>} parts
 * @returns {number}
 */
function drawRichParts(doc, x, y, maxWidth, parts) {
  if (!parts.length) {
    doc.setFont('helvetica', 'normal');
    doc.text('—', x, y);
    return y + LINE_H;
  }

  doc.setFontSize(FONT_SIZE);
  doc.setTextColor(...BLACK);
  let cursorX = x;
  let cursorY = y;

  for (const part of parts) {
    doc.setFont('helvetica', part.bold ? 'bold' : 'normal');
    const w = doc.getTextWidth(part.text);
    if (cursorX > x && cursorX + w > x + maxWidth) {
      cursorY += LINE_H;
      cursorX = x;
    }
    doc.text(part.text, cursorX, cursorY);
    cursorX += w;
  }

  return cursorY + LINE_H;
}

/**
 * @param {jsPDF} doc
 * @param {Array<{ label: string, value?: string, wrap?: boolean, richSegments?: Array<{ category: string, name: string }> }>} fields
 * @param {number} innerWidth
 * @returns {number}
 */
function measureFieldsHeight(doc, fields, innerWidth) {
  let h = 0;
  for (const field of fields) {
    doc.setFontSize(FONT_SIZE);
    const valueX = labelValueOffset(doc, field.label);
    const maxW = innerWidth - valueX;

    if (field.richSegments) {
      const parts = flattenAccessorySegments(field.richSegments);
      h += measureRichPartsHeight(doc, parts, maxW);
      continue;
    }

    const maxFieldW = field.wrap ? maxW : innerWidth;
    const lines = field.wrap
      ? wrapPlain(doc, field.value || '—', maxFieldW).length || 1
      : 1;
    h += lines * LINE_H;
  }
  return h;
}

/**
 * @param {object} target
 * @param {{ dataUrl: string, widthPx: number, heightPx: number } | null} barcode
 * @param {number} innerWidth
 * @returns {number}
 */
function measureBarcodeBlockHeight(target, barcode, innerWidth) {
  if (isAccessorySlip(target)) return 0;
  let h = BARCODE_LABEL_H;
  if (!barcode?.dataUrl) return h + LINE_H;
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
function measureSlipHeight(doc, target, innerWidth, barcode) {
  const fields = buildTokenSlipFields(target);
  return (
    SLIP_PAD * 2 +
    2 +
    measureFieldsHeight(doc, fields, innerWidth) +
    measureBarcodeBlockHeight(target, barcode, innerWidth)
  );
}

/**
 * @param {jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} innerWidth
 * @param {Array<{ label: string, value?: string, wrap?: boolean, richSegments?: Array<{ category: string, name: string }> }>} fields
 */
function drawFields(doc, x, y, innerWidth, fields) {
  doc.setFontSize(FONT_SIZE);
  doc.setTextColor(...BLACK);

  for (const field of fields) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${field.label}:`, x, y);
    const labelW = labelValueOffset(doc, field.label);
    const valueX = x + labelW;
    const valueMaxW = innerWidth - labelW;

    if (field.richSegments) {
      const parts = flattenAccessorySegments(field.richSegments);
      y = drawRichParts(doc, valueX, y, valueMaxW, parts);
      continue;
    }

    doc.setFont('helvetica', 'normal');
    const display = field.value || '—';

    if (field.wrap) {
      const valueLines = wrapPlain(doc, display, valueMaxW);
      if (!valueLines.length) {
        doc.text('—', valueX, y);
        y += LINE_H;
      } else {
        valueLines.forEach((line) => {
          doc.text(line, valueX, y);
          y += LINE_H;
        });
      }
    } else {
      doc.text(display, valueX, y);
      y += LINE_H;
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
function drawBarcodeBlock(doc, x, y, innerWidth, barcode) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(FONT_SIZE);
  doc.text('PRODUCT BARCODE:', x, y);
  y += BARCODE_LABEL_H;

  if (!barcode?.dataUrl) {
    doc.setFont('helvetica', 'normal');
    doc.text('—', x, y);
    return y + LINE_H;
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
function drawSlip(doc, target, barcode, x, startY, slipWidth) {
  const innerWidth = slipWidth - SLIP_PAD * 2;
  const slipHeight = measureSlipHeight(doc, target, innerWidth, barcode);
  const fields = buildTokenSlipFields(target);

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.25);
  doc.rect(x, startY, slipWidth, slipHeight);

  let y = startY + SLIP_PAD + 3;
  y = drawFields(doc, x + SLIP_PAD, y, innerWidth, fields);
  if (!isAccessorySlip(target)) {
    drawBarcodeBlock(doc, x + SLIP_PAD, y, innerWidth, barcode);
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
function buildDeliverySlipPdfDocFromPrepared(prepared) {
  if (!prepared.length) return null;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const slipWidth = (pageW - MARGIN * 2 - COL_GAP) / SLIPS_PER_ROW;
  const innerWidth = slipWidth - SLIP_PAD * 2;

  let y = MARGIN;

  for (let i = 0; i < prepared.length; i += SLIPS_PER_ROW) {
    const rowSlips = prepared.slice(i, i + SLIPS_PER_ROW);
    const heights = rowSlips.map(({ target, barcode }) =>
      measureSlipHeight(doc, target, innerWidth, barcode)
    );
    const rowH = Math.max(...heights, 0) + GAP_ROW;

    if (y + rowH > pageH - MARGIN && y > MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    rowSlips.forEach(({ target, barcode }, col) => {
      const x = MARGIN + col * (slipWidth + COL_GAP);
      drawSlip(doc, target, barcode, x, y, slipWidth);
    });

    y += rowH;
  }

  return doc;
}

/**
 * @param {object[]} orders — per-product slip targets
 * @returns {Promise<import('jspdf').jsPDF | null>}
 */
export async function buildDeliverySlipPdfDoc(orders) {
  const prepared = await prepareSlipRows(orders);
  return buildDeliverySlipPdfDocFromPrepared(prepared);
}

/**
 * @param {object} target — accessory token slip target
 * @returns {Promise<import('jspdf').jsPDF | null>}
 */
export async function buildAccessoryTokenSlipPdfDoc(target) {
  if (!target) return null;
  return buildDeliverySlipPdfDocFromPrepared([{ target, barcode: null }]);
}

/**
 * @param {string} filename
 * @param {object[]} orders — per-product slip targets
 */
export async function downloadDeliverySlipPdf(filename, orders) {
  const doc = await buildDeliverySlipPdfDoc(orders);
  if (!doc) return;

  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeName);
}

/**
 * @param {string} filename
 * @param {object} target — accessory token slip target from buildAccessoryTokenSlipTarget
 */
export async function downloadAccessoryTokenSlipPdf(filename, target) {
  const doc = await buildAccessoryTokenSlipPdfDoc(target);
  if (!doc) return;

  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeName);
}

/**
 * @param {object[]} orders — per-product slip targets
 * @param {string} [title]
 */
export async function printDeliverySlipPdf(orders, title = 'Print slips') {
  const doc = await buildDeliverySlipPdfDoc(orders);
  if (!doc) return;
  printJsPdfDoc(doc, title);
}

/**
 * @param {object} target — accessory token slip target from buildAccessoryTokenSlipTarget
 * @param {string} [title]
 */
export async function printAccessoryTokenSlipPdf(target, title = 'Accessory token') {
  const doc = await buildAccessoryTokenSlipPdfDoc(target);
  if (!doc) return;
  printJsPdfDoc(doc, title);
}
