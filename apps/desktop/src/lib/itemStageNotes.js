/**
 * Shared note formatting for Item to Collect / Prepare lists and PDF export.
 */

/**
 * @param {object} row
 * @returns {Array<{ label: string, remark: string }>}
 */
export function accessoryRemarksPartsFromRow(row) {
  const structured = row?.accessory_remarks_parts;
  if (Array.isArray(structured) && structured.length) {
    return structured
      .map((p) => ({
        label: String(p?.label ?? '').trim(),
        remark: String(p?.remark ?? '').trim(),
      }))
      .filter((p) => p.label || p.remark);
  }
  const text = String(row?.accessory_remarks_text ?? '').trim();
  if (!text) return [];
  return text.split(';').map((chunk) => {
    const t = chunk.trim();
    const colon = t.indexOf(':');
    if (colon < 0) return { label: 'Accessory', remark: t };
    return {
      label: t.slice(0, colon).trim(),
      remark: t.slice(colon + 1).trim(),
    };
  });
}

/**
 * Product catalog remark from Product module (products.notes).
 * @param {object} row
 * @returns {string}
 */
export function formatItemStageProductCatalogNotes(row) {
  return String(row?.product_catalog_notes ?? '').trim();
}

/**
 * Product remarks for list/PDF — catalog remark only (order tailor notes are separate).
 * @param {object} row
 * @returns {string}
 */
export function formatItemStageProductRemarks(row) {
  return formatItemStageProductCatalogNotes(row);
}

/**
 * Product note for PDF export: catalog remark (Product form), then line tailor if empty.
 * @param {object} row
 * @returns {string}
 */
export function formatItemStageProductNoteForPdf(row) {
  const catalog = formatItemStageProductCatalogNotes(row);
  if (catalog) return catalog;
  const tailor = String(row?.tailor_notes ?? '').trim();
  return tailor ? `Tailor: ${tailor}` : '';
}

/**
 * @param {object} row
 * @returns {import('../utils/pdfRichText.js').PdfRichLine[]}
 */
export function buildItemStageAllNotesPdfLines(row) {
  /** @type {import('../utils/pdfRichText.js').PdfRichLine[]} */
  const lines = [];
  const bill = String(row?.customer_notes ?? '').trim();
  if (bill) {
    lines.push({
      segments: [
        { text: 'Bill remarks: ', bold: false },
        { text: bill, bold: false },
      ],
    });
  }
  const delivery = String(row?.delivery_notes ?? '').trim();
  if (delivery) {
    lines.push({
      segments: [
        { text: 'Delivery note: ', bold: false },
        { text: delivery, bold: false },
      ],
    });
  }
  const accessories = accessoryRemarksPartsFromRow(row);
  if (accessories.length) {
    lines.push({ segments: [{ text: 'Accessory:', bold: false }] });
    for (const { label, remark } of accessories) {
      lines.push({
        segments: [
          { text: `${label}: `, bold: true },
          { text: remark, bold: false },
        ],
      });
    }
  }
  return lines;
}

/**
 * Plain-text all notes for table / export.
 * @param {object} row
 * @returns {string}
 */
export function formatItemStageAllNotes(row) {
  const lines = buildItemStageAllNotesPdfLines(row);
  return lines
    .map((line) => line.segments.map((s) => s.text).join(''))
    .join('\n');
}
