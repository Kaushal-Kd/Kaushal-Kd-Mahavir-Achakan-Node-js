import { formatCurrency } from '@wrs/shared';

import {
  formatLaundrySlipDate,
  formatLaundrySlipDateTime,
  formatUrgentCodeLabel,
  calculateVendorOutstandingAmounts,
} from '../pages/laundry/laundrySlipData.js';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import {
  groupProductsByCategory,
  groupProductsByPriority,
  normalizeLaundrySlipInput,
  paginateLaundryCodeGroups,
  splitEntriesIntoColumns,
  sumAccessoryRows,
  sumCategoryPricingRows,
} from '../pages/laundry/laundrySlipData.js';
import { pdfSafeText } from './tablePdf.js';

const BLACK = [0, 0, 0];
const GRAY_BG = [243, 244, 246];
const WHITE = [255, 255, 255];

const MARGIN = 10;
const CATEGORY_TABLES_PER_ROW = 6;
const COL_GAP = 2;
const ROW_GAP = 3;
const BOX_PAD = 1;
const TITLE_HEADER_H = 6;
const TOTAL_FOOTER_H = 5;
const CODE_CELL_H = 5;
const CODE_CELL_GAP = 1;
const SECTION_GAP = 5;
const LABEL_VALUE_GAP = 2;

const FONT_TITLE = 14;
const FONT_SECTION = 10;
const FONT_NORMAL = 9;
const FONT_SMALL = 8;
const FONT_CODE = 7;

const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low', 'No Schedule'];

function normalizePriority(value) {
  const p = String(value || '').trim();
  return PRIORITY_ORDER.includes(p) ? p : 'No Schedule';
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} y
 * @param {number} needed
 * @returns {number}
 */
function ensureSpace(doc, y, needed) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed <= pageH - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

/**
 * @param {{ code: string, priority?: string }} entry
 * @returns {string}
 */
function formatCodeLabel(entry) {
  const code = pdfSafeText(entry?.code || '—');
  const priority = normalizePriority(entry?.priority);
  if (priority === 'Urgent') return formatUrgentCodeLabel(code);
  if (priority === 'High') return `> ${code}`;
  return code;
}

/**
 * @param {Array<{ code: string, priority?: string }>} entries
 * @returns {number}
 */
function measureCodeGridHeight(entries) {
  if (!entries.length) return CODE_CELL_H;
  const columns = splitEntriesIntoColumns(entries);
  const rowCount = Math.max(...columns.map((col) => col.length), 1);
  return rowCount * CODE_CELL_H + Math.max(0, rowCount - 1) * CODE_CELL_GAP;
}

/**
 * @param {Array<{ code: string, priority?: string }>} entries
 * @returns {number}
 */
function measureCategoryBoxHeight(entries) {
  return BOX_PAD * 2 + TITLE_HEADER_H + measureCodeGridHeight(entries) + TOTAL_FOOTER_H;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} priority
 */
function strokeBox(doc, x, y, w, h, priority = 'Medium') {
  doc.setDrawColor(...BLACK);
  if (priority === 'High') {
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.5, 1.5], 0);
    doc.rect(x, y, w, h);
    doc.setLineDashPattern([], 0);
    return;
  }
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([], 0);
  doc.rect(x, y, w, h);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {string} title
 * @param {string} [headerPriority]
 */
function drawBoxTitle(doc, x, y, w, title, headerPriority = 'Medium') {
  doc.setFillColor(...GRAY_BG);
  doc.rect(x, y, w, TITLE_HEADER_H, 'F');
  strokeBox(doc, x, y, w, TITLE_HEADER_H, headerPriority);
  doc.setFontSize(FONT_SMALL);
  doc.setTextColor(...BLACK);
  const suffix = headerPriority === 'Urgent' ? ' ***' : headerPriority === 'High' ? ' >' : '';
  const label = pdfSafeText(`${title}${suffix}`);
  if (headerPriority === 'Urgent') doc.setFont('courier', 'bold');
  else if (headerPriority === 'High') doc.setFont('courier', 'bold');
  else doc.setFont('courier', 'bold');
  doc.setFontSize(
    Math.min(FONT_SMALL, (FONT_SMALL * (w - 2)) / Math.max(1, doc.getTextWidth(label)))
  );
  doc.text(label, x + w / 2, y + TITLE_HEADER_H / 2 + 0.8, { align: 'center' });
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {Array<{ code: string, priority?: string }>} entries
 * @returns {number} box height
 */
function drawCategoryBox(doc, x, y, w, title, entries, headerPriority = 'Medium') {
  const boxH = measureCategoryBoxHeight(entries);
  drawBoxTitle(doc, x, y, w, title, headerPriority);

  const innerX = x + BOX_PAD;
  const innerY = y + TITLE_HEADER_H + BOX_PAD;
  const innerW = w - BOX_PAD * 2;

  if (!entries.length) {
    const cellY = innerY;
    strokeBox(doc, innerX, cellY, innerW, CODE_CELL_H, 'Medium');
    doc.setFontSize(FONT_CODE);
    doc.setFont('courier', 'normal');
    doc.text('—', innerX + innerW / 2, cellY + CODE_CELL_H / 2 + 0.6, { align: 'center' });
  } else {
    const columns = splitEntriesIntoColumns(entries);
    const colCount = columns.length;
    const subColW = (innerW - (colCount - 1) * CODE_CELL_GAP) / colCount;
    const rowCount = Math.max(...columns.map((col) => col.length), 1);

    for (let r = 0; r < rowCount; r += 1) {
      const cellY = innerY + r * (CODE_CELL_H + CODE_CELL_GAP);
      for (let c = 0; c < colCount; c += 1) {
        const entry = columns[c][r];
        const cellX = innerX + c * (subColW + CODE_CELL_GAP);
        const priority = entry ? normalizePriority(entry.priority) : 'Medium';
        strokeBox(doc, cellX, cellY, subColW, CODE_CELL_H, priority);
        if (entry) {
          doc.setFontSize(FONT_CODE);
          if (priority === 'Urgent') doc.setFont('courier', 'bold');
          else if (priority === 'High') doc.setFont('courier', 'bold');
          else doc.setFont('courier', 'normal');
          const label = formatCodeLabel(entry);
          const lines = doc.splitTextToSize(label, subColW - 1);
          doc.text(lines[0] || label, cellX + subColW / 2, cellY + CODE_CELL_H / 2 + 0.6, {
            align: 'center',
          });
        }
      }
    }
  }

  const footerY = y + boxH - TOTAL_FOOTER_H;
  doc.setFillColor(...GRAY_BG);
  doc.rect(x, footerY, w, TOTAL_FOOTER_H, 'F');
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([], 0);
  doc.rect(x, footerY, w, TOTAL_FOOTER_H);
  doc.setFontSize(FONT_SMALL);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text(`Total: ${entries.length}`, x + w / 2, footerY + TOTAL_FOOTER_H / 2 + 0.8, {
    align: 'center',
  });

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([], 0);
  doc.rect(x, y, w, boxH);

  return boxH;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} startY
 * @param {Array<{ label: string, entries: Array<{ code: string, priority?: string }> }>} groups
 * @returns {number}
 */
function drawCategoryGrid(doc, startY, groups) {
  groups = paginateLaundryCodeGroups(groups);
  if (!groups.length) {
    doc.setFontSize(FONT_SMALL);
    doc.setFont('helvetica', 'italic');
    doc.text('No items.', MARGIN, startY + 4);
    return startY + 6;
  }

  const pageW = doc.internal.pageSize.getWidth();
  const usableW = pageW - MARGIN * 2;
  const cellW = (usableW - (CATEGORY_TABLES_PER_ROW - 1) * COL_GAP) / CATEGORY_TABLES_PER_ROW;
  if (needsWideCodeTable(doc, groups, cellW)) return drawWideCodeTable(doc, startY, groups);

  let y = startY;

  for (let i = 0; i < groups.length; i += CATEGORY_TABLES_PER_ROW) {
    const chunk = groups.slice(i, i + CATEGORY_TABLES_PER_ROW);
    const heights = chunk.map((g) => measureCategoryBoxHeight(g.entries));
    const rowH = Math.max(...heights, measureCategoryBoxHeight([]));

    y = ensureSpace(doc, y, rowH + ROW_GAP);

    for (let j = 0; j < chunk.length; j += 1) {
      const g = chunk[j];
      const x = MARGIN + j * (cellW + COL_GAP);
      drawCategoryBox(doc, x, y, cellW, g.label, g.entries);
    }

    y += rowH + ROW_GAP;
  }

  return y;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} startY
 * @param {Array<{ priority: string, codes: string[] }>} groups
 * @returns {number}
 */
function drawPriorityGrid(doc, startY, groups) {
  if (!groups.length) return startY;
  groups = paginateLaundryCodeGroups(
    groups.map((group) => ({
      ...group,
      label: group.priority,
      entries: group.codes.map((code) => ({ code, priority: group.priority })),
    }))
  ).map((group) => ({ ...group, codes: group.entries.map((entry) => entry.code) }));

  const pageW = doc.internal.pageSize.getWidth();
  const usableW = pageW - MARGIN * 2;
  const cellW = (usableW - (CATEGORY_TABLES_PER_ROW - 1) * COL_GAP) / CATEGORY_TABLES_PER_ROW;
  if (needsWideCodeTable(doc, groups, cellW)) return drawWideCodeTable(doc, startY, groups);

  let y = startY;

  for (let i = 0; i < groups.length; i += CATEGORY_TABLES_PER_ROW) {
    const chunk = groups.slice(i, i + CATEGORY_TABLES_PER_ROW);
    const entriesByGroup = chunk.map((g) =>
      g.codes.map((code) => ({ code, priority: g.priority }))
    );
    const heights = entriesByGroup.map((entries) => measureCategoryBoxHeight(entries));
    const rowH = Math.max(...heights, measureCategoryBoxHeight([]));

    y = ensureSpace(doc, y, rowH + ROW_GAP);

    for (let j = 0; j < chunk.length; j += 1) {
      const g = chunk[j];
      const x = MARGIN + j * (cellW + COL_GAP);
      const entries = g.codes.map((code) => ({ code, priority: g.priority }));
      drawCategoryBox(doc, x, y, cellW, g.label, entries, g.priority);
    }

    y += rowH + ROW_GAP;
  }

  return y;
}

/** Full-width wrapping keeps long category names/codes complete instead of dropping code suffixes. */
function needsWideCodeTable(doc, groups, width) {
  return groups.some((group) => {
    doc.setFont('courier', 'bold');
    doc.setFontSize(FONT_SMALL);
    if (doc.getTextWidth(pdfSafeText(group.label)) > ((width - 2) * FONT_SMALL) / 6) return true;
    doc.setFontSize(FONT_CODE);
    return group.entries.some(
      (entry) => doc.getTextWidth(formatCodeLabel(entry)) > width - BOX_PAD * 2 - 1
    );
  });
}

function drawWideCodeTable(doc, y, groups) {
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
    head: [['Category / priority', 'Product code', 'Priority']],
    body: groups.flatMap((group) =>
      group.entries.map((entry) => [
        pdfSafeText(group.label),
        pdfSafeText(entry.code),
        pdfSafeText(entry.priority || 'Medium'),
      ])
    ),
    theme: 'grid',
    rowPageBreak: 'avoid',
    styles: { fontSize: FONT_NORMAL, cellPadding: 2, textColor: BLACK, overflow: 'linebreak' },
    headStyles: { fillColor: GRAY_BG, textColor: BLACK },
    columnStyles: { 0: { cellWidth: 65 }, 1: { cellWidth: 95 } },
  });
  return doc.lastAutoTable.finalY + ROW_GAP;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {string} label
 * @param {string} value
 * @param {number} x
 * @param {number} y
 */
function drawMetaPair(doc, label, value, x, y) {
  doc.setFontSize(FONT_NORMAL);
  doc.setFont('helvetica', 'bold');
  doc.text(`${label}:`, x, y);
  const labelW = doc.getTextWidth(`${label}:`) + LABEL_VALUE_GAP;
  doc.setFont('helvetica', 'normal');
  doc.text(pdfSafeText(value || '—'), x + labelW, y);
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} job
 * @returns {number}
 */
function drawHeader(doc, job) {
  let y = MARGIN;

  doc.setFontSize(FONT_TITLE);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text('Laundry Job Slip', MARGIN, y);
  y += 8;

  const pageW = doc.internal.pageSize.getWidth();
  const midX = pageW / 2;

  drawMetaPair(doc, 'Job', job.jobNo, MARGIN, y);
  drawMetaPair(doc, 'Date', formatLaundrySlipDate(job.laundryDate) || '-', midX, y);
  y += 5;
  drawMetaPair(doc, 'Vendor', job.vendor, MARGIN, y);
  y += 5;
  drawMetaPair(doc, 'Pickup by', job.pickupBy || '-', MARGIN, y);
  y += 5;
  drawMetaPair(
    doc,
    'Pickup date & time',
    formatLaundrySlipDateTime(job.pickupAt) || '—',
    MARGIN,
    y
  );
  drawMetaPair(doc, 'Return date & time', formatLaundrySlipDateTime(job.returnAt) || '—', midX, y);
  y += 8;

  return y;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} y
 * @param {string} title
 * @returns {number}
 */
function drawSectionTitle(doc, y, title) {
  y = ensureSpace(doc, y, 8);
  doc.setFontSize(FONT_SECTION);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text(title.toUpperCase(), MARGIN, y);
  return y + SECTION_GAP;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {number} y
 * @returns {number}
 */
function drawLegend(doc, y) {
  doc.setFontSize(FONT_SMALL);
  doc.setFont('helvetica', 'normal');
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.2);
  const legendH = 6;
  doc.rect(MARGIN, y - 3.5, doc.internal.pageSize.getWidth() - MARGIN * 2, legendH);
  doc.text('*** Urgent (bold)   > High (dashed border)   Plain = Medium', MARGIN + 2, y + 0.5);
  return y + legendH + 2;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} job
 * @param {number} startY
 * @returns {number}
 */
function drawRemarksFooter(doc, job, startY) {
  const remarks = pdfSafeText(job.remarks || '—');
  let y = ensureSpace(doc, startY + SECTION_GAP, 12);
  y += SECTION_GAP;

  doc.setFontSize(FONT_NORMAL);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLACK);
  doc.text('Remarks:', MARGIN, y);

  const labelW = doc.getTextWidth('Remarks:') + LABEL_VALUE_GAP;
  const maxW = doc.internal.pageSize.getWidth() - MARGIN - labelW - MARGIN;
  const lines = doc.splitTextToSize(remarks, maxW);
  const lineH = 4.5;

  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) {
      y = ensureSpace(doc, y + lineH, lineH);
      y += lineH;
    }
    doc.text(lines[i], MARGIN + labelW, y);
  }

  return y + lineH;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} job
 * @param {number} startY
 * @returns {number}
 */
function drawPricingSection(doc, job, startY) {
  let y = drawSectionTitle(doc, startY, 'Pricing');

  doc.setFontSize(FONT_SMALL);
  doc.setFont('helvetica', 'bold');
  doc.text('Category wash rates', MARGIN, y);
  y += 4;

  const sortedCategories = [...(job.categorySummaries || [])].sort((a, b) =>
    String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' })
  );

  const categoryBody = sortedCategories.map((row) => {
    const washPrice = Number(row.washPrice || 0);
    const lineTotal = Number(row.qtyTotal || 0) * washPrice;
    return [
      pdfSafeText(row.label || '-'),
      String(row.productCount || 0),
      pdfSafeText(formatCurrency(washPrice)),
      pdfSafeText(formatCurrency(lineTotal)),
    ];
  });

  const categoryTotals = sumCategoryPricingRows(sortedCategories);
  const categoryFoot = [
    [
      'Total',
      String(categoryTotals.productCount),
      '',
      pdfSafeText(formatCurrency(categoryTotals.lineTotal)),
    ],
  ];

  const line = { lineWidth: 0.2, lineColor: BLACK };

  y = ensureSpace(doc, y, 20);

  autoTable(doc, {
    startY: y,
    head: [['Category', 'Products', 'Wash price', 'Total']],
    body: categoryBody.length ? categoryBody : [['No category rows', '', '', '']],
    foot: categoryBody.length ? categoryFoot : undefined,
    theme: 'grid',
    margin: { left: MARGIN, right: MARGIN },
    styles: {
      fontSize: FONT_SMALL,
      textColor: BLACK,
      fillColor: WHITE,
      cellPadding: 2.5,
      overflow: 'linebreak',
      valign: 'middle',
      ...line,
    },
    headStyles: {
      fillColor: GRAY_BG,
      textColor: BLACK,
      fontStyle: 'bold',
      halign: 'left',
      ...line,
    },
    footStyles: {
      fillColor: GRAY_BG,
      textColor: BLACK,
      fontStyle: 'bold',
      ...line,
    },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
  });

  y = doc.lastAutoTable.finalY + SECTION_GAP;

  const accessoryRows = [...(job.accessoryRows || [])].sort((a, b) =>
    String(a.categoryLabel || a.name || '').localeCompare(
      String(b.categoryLabel || b.name || ''),
      undefined,
      { sensitivity: 'base' }
    )
  );

  if (accessoryRows.length > 0) {
    y = ensureSpace(doc, y, 12);
    doc.setFontSize(FONT_SMALL);
    doc.setFont('helvetica', 'bold');
    doc.text('Accessory categories', MARGIN, y);
    y += 4;

    const accessoryBody = accessoryRows.map((row) => {
      const qty = Number(row.qty || 0);
      const rate = Number(row.rate || 0);
      const label = row.categoryLabel || row.name || '-';
      return [
        pdfSafeText(label),
        String(qty),
        pdfSafeText(formatCurrency(rate)),
        pdfSafeText(formatCurrency(qty * rate)),
      ];
    });

    const accessoryTotals = sumAccessoryRows(accessoryRows);
    const accessoryFoot = [
      [
        'Total',
        String(accessoryTotals.qty),
        '',
        pdfSafeText(formatCurrency(accessoryTotals.lineTotal)),
      ],
    ];

    autoTable(doc, {
      startY: y,
      head: [['Category', 'Qty', 'Rate', 'Total']],
      body: accessoryBody,
      foot: accessoryFoot,
      theme: 'grid',
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: FONT_SMALL,
        textColor: BLACK,
        fillColor: WHITE,
        cellPadding: 2.5,
        ...line,
      },
      headStyles: {
        fillColor: GRAY_BG,
        textColor: BLACK,
        fontStyle: 'bold',
        ...line,
      },
      footStyles: {
        fillColor: GRAY_BG,
        textColor: BLACK,
        fontStyle: 'bold',
        ...line,
      },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
    });

    y = doc.lastAutoTable.finalY + SECTION_GAP;
  }

  return drawVendorOutstandingSection(doc, job, drawTotalsBox(doc, job, y));
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} job
 * @param {number} startY
 * @returns {number}
 */
function drawTotalsBox(doc, job, startY) {
  const pageW = doc.internal.pageSize.getWidth();
  const boxW = 90;
  const boxX = pageW - MARGIN - boxW;
  const rows = [
    ['Product total', formatCurrency(job.productTotal)],
    ...(job.accessoryRows?.length ? [['Accessory total', formatCurrency(job.accessoryTotal)]] : []),
    ['Subtotal', formatCurrency(job.subtotal)],
    ['Discount', formatCurrency(job.discountAmount)],
    ['Payable amount', formatCurrency(job.payable)],
  ];

  const lineH = 5;
  const boxH = rows.length * lineH + 6;
  let y = ensureSpace(doc, startY, boxH + 4);

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.2);
  doc.setFillColor(...GRAY_BG);
  doc.rect(boxX, y, boxW, boxH, 'FD');

  let innerY = y + 5;
  doc.setFontSize(FONT_NORMAL);
  doc.setTextColor(...BLACK);

  for (let i = 0; i < rows.length; i += 1) {
    const [label, amount] = rows[i];
    const isPayable = i === rows.length - 1;
    if (isPayable) {
      doc.setLineWidth(0.15);
      doc.line(boxX + 2, innerY - 3.8, boxX + boxW - 2, innerY - 3.8);
      doc.setFontSize(10);
    } else {
      doc.setFontSize(FONT_NORMAL);
    }
    doc.setFont('helvetica', 'normal');
    doc.text(pdfSafeText(label), boxX + 3, innerY);
    doc.setFont('helvetica', isPayable ? 'bold' : 'normal');
    doc.text(pdfSafeText(amount), boxX + boxW - 3, innerY, { align: 'right' });
    innerY += lineH;
  }

  return y + boxH;
}

/**
 * @param {import('jspdf').jsPDF} doc
 * @param {object} job
 * @param {number} startY
 * @returns {number}
 */
function drawVendorOutstandingSection(doc, job, startY) {
  const outstanding = job.vendorOutstanding;
  if (!outstanding?.totals?.billCount) return startY;

  let y = ensureSpace(doc, startY + SECTION_GAP, 26);
  y = drawSectionTitle(doc, y, 'Vendor outstanding');

  const { currentBill, oldPending, totalPending } = calculateVendorOutstandingAmounts({
    outstanding,
    currentBillAmount: job.payable,
    currentJobNo: job.jobNo,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(FONT_NORMAL);
  doc.setFont('helvetica', 'normal');
  doc.text('Current Bill Amount', MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafeText(formatCurrency(currentBill)), pageWidth - MARGIN, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.text('Old Pending Bill Amount', MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafeText(formatCurrency(oldPending)), pageWidth - MARGIN, y, { align: 'right' });
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.text('Final Total Pending Amount', MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(12, 110, 225);
  doc.text(pdfSafeText(formatCurrency(totalPending)), pageWidth - MARGIN, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  return y + 8;
}

/**
 * Build laundry slip PDF (native jsPDF — for WhatsApp attachment).
 * @param {Record<string, unknown>} jobInput
 * @returns {Promise<Blob>}
 */
export async function buildLaundrySlipPdfBlob(jobInput) {
  const job = normalizeLaundrySlipInput(jobInput);
  if (!job) {
    throw new Error('Invalid laundry job data');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  let y = drawHeader(doc, job);

  y = drawSectionTitle(doc, y, 'Products by category');
  y = drawLegend(doc, y);
  y = drawCategoryGrid(doc, y, groupProductsByCategory(job.productRows));

  const priorityGroups = groupProductsByPriority(job.productRows);
  if (priorityGroups.length > 0) {
    y += SECTION_GAP;
    const firstBoxes = paginateLaundryCodeGroups(
      priorityGroups
        .slice(0, CATEGORY_TABLES_PER_ROW)
        .map((group) => ({ label: group.priority, entries: group.codes }))
    );
    const firstRowHeight = Math.max(
      ...firstBoxes
        .slice(0, CATEGORY_TABLES_PER_ROW)
        .map((group) => measureCategoryBoxHeight(group.entries))
    );
    y = ensureSpace(doc, y, SECTION_GAP + firstRowHeight + ROW_GAP);
    y = drawSectionTitle(doc, y, 'Products by priority');
    y = drawPriorityGrid(doc, y, priorityGroups);
  }

  y += SECTION_GAP;
  y = drawPricingSection(doc, job, y);
  drawRemarksFooter(doc, job, y);

  return doc.output('blob');
}
