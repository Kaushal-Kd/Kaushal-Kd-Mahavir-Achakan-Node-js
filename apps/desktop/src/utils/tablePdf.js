import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { drawPdfRichLinesInCell } from './pdfRichText.js';

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

/** Strip symbols/fonts that break jsPDF built-in fonts (e.g. ₹ → spacing glitches). */
export function pdfSafeText(value) {
  return String(value ?? '')
    .replace(/\u20B9/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

/**
 * @param {Array<{ width?: number, richGet?: (row: object) => unknown }>} columns
 * @returns {Record<number, { cellWidth: number }>}
 */
function buildColumnStyles(columns) {
  /** @type {Record<number, { cellWidth: number }>} */
  const columnStyles = {};
  columns.forEach((c, i) => {
    const w = Number(c.width);
    if (Number.isFinite(w) && w > 0) {
      columnStyles[i] = { cellWidth: w };
    }
  });
  return columnStyles;
}

/**
 * @param {Array<{ key: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown }>} columns
 * @param {Set<number>} richColIndexes
 * @param {object} row
 * @param {number} colIndex
 * @returns {string}
 */
function cellBodyText(columns, richColIndexes, row, colIndex) {
  const c = columns[colIndex];
  if (richColIndexes.has(colIndex) && typeof c.richGet === 'function') {
    const richLines = c.richGet(row);
    if (Array.isArray(richLines) && richLines.length) {
      // Plain text drives row height; rich text is drawn over the cell in didDrawCell.
      const plain = c.get ? c.get(row) : row[c.key];
      if (plain === null || plain === undefined) return '';
      return pdfSafeText(plain);
    }
  }
  const raw = c.get ? c.get(row) : row[c.key];
  if (raw === null || raw === undefined) return '';
  return pdfSafeText(raw);
}

/**
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {object[]} rows
 * @param {Set<number>} richColIndexes
 * @returns {string[][]}
 */
function buildTableBody(columns, rows, richColIndexes) {
  return (rows || []).map((row) =>
    columns.map((_, colIndex) => cellBodyText(columns, richColIndexes, row, colIndex))
  );
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} params
 */
function attachRichCellDrawing(doc, params) {
  const { columns, richColIndexes, getRowAt } = params;
  return (data) => {
    if (data.section !== 'body' || !richColIndexes.has(data.column.index)) return;
    const row = getRowAt(data.row.index);
    const col = columns[data.column.index];
    if (!row || typeof col?.richGet !== 'function') return;
    const richLines = col.richGet(row);
    if (!Array.isArray(richLines) || !richLines.length) return;
    doc.setFillColor(...WHITE);
    doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');
    drawPdfRichLinesInCell(doc, data.cell, richLines);
  };
}

/**
 * Ensure rich-text cells are tall enough for every line (product + accessories).
 * @param {Array<{ richGet?: (row: object) => unknown }>} columns
 * @param {Set<number>} richColIndexes
 * @param {(rowIndex: number) => object|undefined} getRowAt
 */
function attachRichCellMinHeight(columns, richColIndexes, getRowAt) {
  return (data) => {
    if (data.section !== 'body' || !richColIndexes.has(data.column.index)) return;
    const row = getRowAt(data.row.index);
    const col = columns[data.column.index];
    if (!row || typeof col?.richGet !== 'function') return;
    const richLines = col.richGet(row);
    const lineCount = Array.isArray(richLines) ? richLines.length : 0;
    if (lineCount <= 1) return;
    const minHeight = Math.max(Number(data.cell.height) || 0, lineCount * 4.2 + 3);
    data.cell.styles.minCellHeight = minHeight;
  };
}

/**
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @returns {Set<number>}
 */
function richColumnIndexes(columns) {
  return new Set(
    columns.map((c, i) => (typeof c.richGet === 'function' ? i : -1)).filter((i) => i >= 0)
  );
}

function pdfOrientation(columns) {
  return columns.length > 7 ? 'landscape' : 'portrait';
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {{ title?: string, subtitle?: string }} options
 * @param {number} margin
 * @returns {number}
 */
function drawPdfHeader(doc, options, margin) {
  let startY = margin;
  doc.setTextColor(...BLACK);
  if (options.title) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(pdfSafeText(options.title), margin, startY);
    startY += 6;
  }
  if (options.subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfSafeText(options.subtitle), margin, startY);
    startY += 5;
  }
  return startY;
}

/**
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {object[]} rows
 * @param {{ title?: string, subtitle?: string }} [options]
 * @returns {import('jspdf').jsPDF}
 */
export function buildTablePdfDoc(columns, rows, options = {}) {
  const doc = new jsPDF({
    orientation: pdfOrientation(columns),
    unit: 'mm',
    format: 'a4',
  });

  const margin = 10;
  const startY = drawPdfHeader(doc, options, margin);

  const head = [columns.map((c) => pdfSafeText(c.header || c.key))];
  const richColIndexes = richColumnIndexes(columns);
  const list = rows || [];
  const body = buildTableBody(columns, list, richColIndexes);
  const columnStyles = buildColumnStyles(columns);
  const line = { lineWidth: 0.2, lineColor: BLACK };

  autoTable(doc, {
    startY,
    ...(options.rowPageBreak === 'avoid' ? { rowPageBreak: 'avoid' } : {}),
    head,
    body,
    theme: 'grid',
    margin: { left: margin, right: margin },
    ...(Object.keys(columnStyles).length ? { columnStyles } : {}),
    styles: {
      fontSize: 8,
      textColor: BLACK,
      fillColor: WHITE,
      cellPadding: 2,
      overflow: 'linebreak',
      valign: 'top',
      ...line,
    },
    headStyles: {
      fillColor: WHITE,
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'left',
      ...line,
    },
    bodyStyles: {
      fillColor: WHITE,
      textColor: BLACK,
      ...line,
    },
    alternateRowStyles: {},
    didParseCell: attachRichCellMinHeight(columns, richColIndexes, (rowIndex) => list[rowIndex]),
    didDrawCell: attachRichCellDrawing(doc, {
      columns,
      richColIndexes,
      getRowAt: (rowIndex) => list[rowIndex],
    }),
  });

  return doc;
}

/**
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {Array<{ label?: string|null, rows: object[] }>} groups
 * @param {{ title?: string, subtitle?: string }} [options]
 * @returns {import('jspdf').jsPDF}
 */
export function buildGroupedTablePdfDoc(columns, groups, options = {}) {
  const doc = new jsPDF({
    orientation: pdfOrientation(columns),
    unit: 'mm',
    format: 'a4',
  });

  const margin = 10;
  const pageH = doc.internal.pageSize.getHeight();
  let startY = drawPdfHeader(doc, options, margin);

  const head = [columns.map((c) => pdfSafeText(c.header || c.key))];
  const richColIndexes = richColumnIndexes(columns);
  const columnStyles = buildColumnStyles(columns);
  const line = { lineWidth: 0.2, lineColor: BLACK };
  const list = groups || [];

  for (let gi = 0; gi < list.length; gi += 1) {
    const { label, rows: groupRows } = list[gi];
    if (label) {
      if (gi > 0 && startY > pageH - 40) {
        doc.addPage();
        startY = margin;
      }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(pdfSafeText(`Salesman: ${label}`), margin, startY);
      startY += 5;
    }

    const body = buildTableBody(columns, groupRows || [], richColIndexes);

    autoTable(doc, {
      startY,
      ...(options.rowPageBreak === 'avoid' ? { rowPageBreak: 'avoid' } : {}),
      head,
      body,
      theme: 'grid',
      margin: { left: margin, right: margin },
      ...(Object.keys(columnStyles).length ? { columnStyles } : {}),
      styles: {
        fontSize: 8,
        textColor: BLACK,
        fillColor: WHITE,
        cellPadding: 2,
        overflow: 'linebreak',
        valign: 'top',
        ...line,
      },
      headStyles: {
        fillColor: WHITE,
        textColor: BLACK,
        fontStyle: 'bold',
        halign: 'left',
        ...line,
      },
      bodyStyles: {
        fillColor: WHITE,
        textColor: BLACK,
        ...line,
      },
      alternateRowStyles: {},
      didParseCell: attachRichCellMinHeight(columns, richColIndexes, (rowIndex) =>
        (groupRows || [])[rowIndex]
      ),
      didDrawCell: attachRichCellDrawing(doc, {
        columns,
        richColIndexes,
        getRowAt: (rowIndex) => (groupRows || [])[rowIndex],
      }),
    });

    startY = (doc.lastAutoTable?.finalY ?? startY) + 8;
  }

  return doc;
}

/**
 * Open the system print dialog for a jsPDF document.
 * @param {import('jspdf').jsPDF} doc
 * @param {string} [title]
 */
export function printJsPdfDoc(doc, title = 'Report') {
  doc.autoPrint();
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:0;height:0;border:0;visibility:hidden;pointer-events:none';
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
        document.body.removeChild(iframe);
      } catch {
        /* noop */
      }
    }, 800);
  };

  let printed = false;
  const triggerPrintOnce = () => {
    if (printed) return;
    printed = true;
    try {
      const win = iframe.contentWindow;
      if (win) {
        try {
          win.document.title = title;
        } catch {
          /* noop */
        }
        win.focus();
        win.print();
      }
    } catch {
      cleanup();
    }
  };

  if (typeof iframe.contentWindow?.addEventListener === 'function') {
    iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true });
  } else {
    setTimeout(cleanup, 2000);
  }

  const schedulePrint = () => setTimeout(triggerPrintOnce, 200);
  iframe.addEventListener('load', schedulePrint, { once: true });
  setTimeout(schedulePrint, 600);
}

/**
 * @param {string} filename
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {object[]} rows
 * @param {{ title?: string, subtitle?: string }} [options]
 */
export function downloadTablePdf(filename, columns, rows, options = {}) {
  const doc = buildTablePdfDoc(columns, rows, options);
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeName);
}

/**
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {object[]} rows
 * @param {{ title?: string, subtitle?: string }} [options]
 */
export function printTablePdf(columns, rows, options = {}) {
  const doc = buildTablePdfDoc(columns, rows, options);
  printJsPdfDoc(doc, options.title || 'Report');
}

/**
 * @param {string} filename
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {Array<{ label?: string|null, rows: object[] }>} groups
 * @param {{ title?: string, subtitle?: string }} [options]
 */
export function downloadGroupedTablePdf(filename, columns, groups, options = {}) {
  const doc = buildGroupedTablePdfDoc(columns, groups, options);
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  doc.save(safeName);
}

/**
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown, width?: number }>} columns
 * @param {Array<{ label?: string|null, rows: object[] }>} groups
 * @param {{ title?: string, subtitle?: string }} [options]
 */
export function printGroupedTablePdf(columns, groups, options = {}) {
  const doc = buildGroupedTablePdfDoc(columns, groups, options);
  printJsPdfDoc(doc, options.title || 'Report');
}
