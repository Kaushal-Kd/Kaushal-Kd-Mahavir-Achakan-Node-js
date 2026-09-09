import { formatCurrency } from '@wrs/shared';

import { renderAndPrint } from '../../utils/printBill.js';

import {
  formatLaundrySlipDate,
  formatLaundrySlipDateTime,
  formatUrgentCodeLabel,
  calculateVendorOutstandingAmounts,
  groupProductsByCategory,
  groupProductsByPriority,
  normalizeLaundrySlipInput,
  splitEntriesIntoColumns,
  sumAccessoryRows,
  sumCategoryPricingRows,
} from './laundrySlipData.js';

export {
  formatLaundrySlipDate,
  formatLaundrySlipDateTime,
  formatUrgentCodeLabel,
  groupProductsByCategory,
  groupProductsByPriority,
  normalizeLaundrySlipInput,
  splitEntriesIntoColumns,
  sumAccessoryRows,
  sumCategoryPricingRows,
} from './laundrySlipData.js';

const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low', 'No Schedule'];
const CATEGORY_TABLES_PER_ROW = 6;

const SLIP_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 12px; }
  h2 { margin: 0 0 8px; font-size: 16px; }
  h3 { margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { margin-bottom: 10px; line-height: 1.5; }
  .meta b { font-weight: 600; }
  /* Table layout (not CSS grid) — html2canvas overlaps grid cells in PDF export */
  table.category-grid {
    width: 100%;
    border-collapse: separate;
    border-spacing: 4px;
    table-layout: fixed;
    margin-bottom: 4px;
  }
  table.category-grid td.grid-cell {
    width: 16.666%;
    vertical-align: top;
    padding: 0;
  }
  .mini-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }
  .mini-table th {
    background: #f3f4f6;
    border: 1px solid #111;
    padding: 4px 3px;
    text-align: center;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.35;
    word-break: break-word;
  }
  .mini-table td {
    border: 1px solid #111;
    padding: 4px 3px;
    text-align: center;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 9px;
    line-height: 1.5;
    word-break: break-all;
    vertical-align: middle;
    height: 18px;
  }
  .mini-table tr {
    page-break-inside: avoid;
  }
  .mini-table td:empty {
    border-color: #ddd;
    color: transparent;
    height: 18px;
  }
  .mini-table td.code-urgent {
    font-weight: 700;
  }
  .mini-table td.code-high {
    font-weight: 700;
    border-style: dashed;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .mini-table th.th-urgent::after {
    content: ' ***';
    font-weight: 700;
  }
  .mini-table th.th-high {
    border-style: dashed;
  }
  .mini-table th.th-high::after {
    content: ' ›';
    font-weight: 700;
  }
  .slip-legend {
    margin: 0 0 8px;
    padding: 4px 6px;
    border: 1px solid #111;
    font-size: 9px;
    line-height: 1.4;
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
  }
  .slip-legend span {
    font-family: Consolas, 'Courier New', monospace;
  }
  .slip-legend .sample-urgent {
    font-weight: 700;
  }
  .slip-legend .sample-high {
    font-weight: 700;
    border: 1px dashed #111;
    text-decoration: underline;
    padding: 0 3px;
  }
  .pricing-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  .pricing-table th,
  .pricing-table td {
    border: 1px solid #111;
    padding: 4px 6px;
  }
  .pricing-table th {
    background: #f3f4f6;
    text-align: left;
  }
  .pricing-table td.num { text-align: right; }
  .totals {
    margin-top: 10px;
    padding: 8px 10px;
    border: 1px solid #111;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 320px;
    margin-left: auto;
  }
  .totals .row { display: flex; justify-content: space-between; gap: 12px; }
  .totals .row strong { font-weight: 700; }
  .totals .payable {
    border-top: 1px solid #ccc;
    padding-top: 6px;
    margin-top: 4px;
    font-size: 12px;
  }
  .vendor-outstanding {
    margin-top: 14px;
    page-break-inside: avoid;
  }
  .vendor-outstanding-note {
    margin: 0 0 6px;
    font-size: 10px;
    color: #374151;
  }
  .vendor-outstanding-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
  }
  .vendor-outstanding-table th,
  .vendor-outstanding-table td {
    border: 1px solid #111;
    padding: 4px 6px;
  }
  .vendor-outstanding-table th {
    background: #f3f4f6;
    text-align: left;
    font-size: 10px;
  }
  .vendor-outstanding-table td.num { text-align: right; }
  .vendor-outstanding-table tr.current-bill td {
    background: #eff6ff;
    font-weight: 600;
  }
  .vendor-outstanding-table tr.total-row td {
    background: #fafafa;
    font-weight: 700;
    border-top: 2px solid #111;
  }
  .priority-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .priority-line {
    margin: 0 0 6px;
    line-height: 1.45;
    font-size: 11px;
  }
  .priority-label {
    font-weight: 700;
    text-transform: lowercase;
  }
  .priority-codes {
    font-family: Consolas, 'Courier New', monospace;
    font-size: 10px;
  }
  .mini-table tfoot td.mini-total {
    font-weight: 700;
    background: #f3f4f6;
    border: 1px solid #111;
    text-align: center;
    font-size: 9px;
  }
  .pricing-table tfoot td {
    font-weight: 700;
    background: #f3f4f6;
  }
  .slip-remarks {
    margin-top: 12px;
    font-size: 11px;
    line-height: 1.5;
  }
  @media print {
    @page { margin: 8mm; }
    body { padding: 0; }
    table.category-grid > tbody > tr { break-inside: avoid; page-break-inside: avoid; }
    .mini-table, .pricing-table, .vendor-outstanding, .totals {
      break-inside: avoid;
      page-break-inside: avoid;
    }
  }
`;

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizePriority(value) {
  const p = String(value || '').trim();
  return PRIORITY_ORDER.includes(p) ? p : 'No Schedule';
}

function renderCodeLegend() {
  return `
    <div class="slip-legend">
      <span><span class="sample-urgent">***</span> Urgent (bold)</span>
      <span><span class="sample-high">›</span> High (dashed border, underline)</span>
      <span>Plain = Medium</span>
    </div>
  `;
}

function renderCodeCell(entry) {
  if (!entry?.code) return '<td></td>';
  const code = esc(entry.code);
  const priority = normalizePriority(entry.priority);
  if (priority === 'Urgent') {
    return `<td class="code-urgent">${esc(formatUrgentCodeLabel(entry.code))}</td>`;
  }
  if (priority === 'High') {
    return `<td class="code-high">› ${code}</td>`;
  }
  return `<td>${code}</td>`;
}

function renderCodeOnlyTable(title, entries) {
  const columns = splitEntriesIntoColumns(entries);
  const colCount = columns.length;
  const rowCount = Math.max(...columns.map((col) => col.length), entries.length ? 0 : 1);

  let body = '';
  if (entries.length === 0) {
    body = '<tr><td>—</td></tr>';
  } else {
    for (let r = 0; r < rowCount; r += 1) {
      const cells = columns
        .map((col) => {
          const entry = col[r];
          return entry ? renderCodeCell(entry) : '<td></td>';
        })
        .join('');
      body += `<tr>${cells}</tr>`;
    }
  }

  const headerColspan = entries.length === 0 ? 1 : colCount;
  const totalCount = entries.length;
  return `
    <table class="mini-table">
      <thead><tr><th colspan="${headerColspan}">${esc(title)}</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="${headerColspan}" class="mini-total"><b>Total: ${totalCount}</b></td></tr></tfoot>
    </table>
  `;
}

function sortCodesAsc(codes) {
  return [...codes].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  );
}

function renderPriorityMiniTable(priority, codes) {
  const entries = sortCodesAsc(codes).map((code) => ({ code, priority }));
  const thClass = priority === 'Urgent' ? 'th-urgent' : priority === 'High' ? 'th-high' : '';
  const columns = splitEntriesIntoColumns(entries);
  const colCount = columns.length;
  const rowCount = Math.max(...columns.map((col) => col.length), 1);
  let body = '';
  for (let r = 0; r < rowCount; r += 1) {
    const cells = columns
      .map((col) => {
        const entry = col[r];
        return entry ? renderCodeCell(entry) : '<td></td>';
      })
      .join('');
    body += `<tr>${cells}</tr>`;
  }
  const totalCount = codes.length;
  return `
    <table class="mini-table">
      <thead><tr><th${thClass ? ` class="${thClass}"` : ''} colspan="${colCount}">${esc(priority)}</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="${colCount}" class="mini-total"><b>Total: ${totalCount}</b></td></tr></tfoot>
    </table>
  `;
}

function renderTableGrid(tableHtmlList) {
  if (!tableHtmlList.length) {
    return '<p style="color:#666;font-size:10px;">No items.</p>';
  }
  const rows = [];
  const perRow = CATEGORY_TABLES_PER_ROW;
  for (let i = 0; i < tableHtmlList.length; i += perRow) {
    const chunk = tableHtmlList.slice(i, i + perRow);
    const cells = chunk.map((html) => `<td class="grid-cell">${html}</td>`).join('');
    const empty = Array.from(
      { length: perRow - chunk.length },
      () => '<td class="grid-cell"></td>'
    ).join('');
    rows.push(`<tr>${cells}${empty}</tr>`);
  }
  return `<table class="category-grid"><tbody>${rows.join('')}</tbody></table>`;
}

function buildCategorySection(productRows) {
  const groups = groupProductsByCategory(productRows);
  const tables = groups.map((g) => renderCodeOnlyTable(g.label, g.entries));
  return `
    <h3>Products by category</h3>
    ${renderCodeLegend()}
    ${renderTableGrid(tables)}
  `;
}

function buildPrioritySection(productRows) {
  const groups = groupProductsByPriority(productRows);
  if (groups.length === 0) {
    return '';
  }
  const tables = groups.map((g) => renderPriorityMiniTable(g.priority, g.codes));
  return `
    <h3>Products by priority</h3>
    ${renderTableGrid(tables)}
  `;
}

function buildRemarksFooter(job) {
  const text = job.remarks || '—';
  return `<div class="slip-remarks"><b>Remarks:</b> <b>${esc(text)}</b></div>`;
}

function buildPricingSection(job) {
  const sortedCategories = [...(job.categorySummaries || [])].sort((a, b) =>
    String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' })
  );
  const categoryTotals = sumCategoryPricingRows(sortedCategories);
  const categoryLines = sortedCategories
    .map((row) => {
      const washPrice = Number(row.washPrice || 0);
      const lineTotal = Number(row.qtyTotal || 0) * washPrice;
      return `<tr>
        <td>${esc(row.label || '-')}</td>
        <td class="num">${row.productCount || 0}</td>
        <td class="num">${esc(formatCurrency(washPrice))}</td>
        <td class="num">${esc(formatCurrency(lineTotal))}</td>
      </tr>`;
    })
    .join('');

  const accessoryRows = [...(job.accessoryRows || [])].sort((a, b) =>
    String(a.categoryLabel || a.name || '').localeCompare(
      String(b.categoryLabel || b.name || ''),
      undefined,
      { sensitivity: 'base' }
    )
  );
  const hasAccessories = accessoryRows.length > 0;
  const accessoryTotals = sumAccessoryRows(accessoryRows);
  const accessoryLines = accessoryRows
    .map((row) => {
      const qty = Number(row.qty || 0);
      const rate = Number(row.rate || 0);
      const label = row.categoryLabel || row.name || '-';
      return `<tr>
        <td>${esc(label)}</td>
        <td class="num">${qty}</td>
        <td class="num">${esc(formatCurrency(rate))}</td>
        <td class="num">${esc(formatCurrency(qty * rate))}</td>
      </tr>`;
    })
    .join('');

  const accessoriesBlock = hasAccessories
    ? `
    <p style="margin:10px 0 4px;font-weight:600;">Accessory categories</p>
    <table class="pricing-table">
      <thead>
        <tr>
          <th>Category</th>
          <th style="text-align:right;">Qty</th>
          <th style="text-align:right;">Rate</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${accessoryLines}</tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td class="num">${accessoryTotals.qty}</td>
          <td></td>
          <td class="num">${esc(formatCurrency(accessoryTotals.lineTotal))}</td>
        </tr>
      </tfoot>
    </table>`
    : '';

  const accessoryTotalRow = hasAccessories
    ? `<div class="row"><span>Accessory total</span><strong>${esc(formatCurrency(job.accessoryTotal))}</strong></div>`
    : '';

  return `
    <h3>Pricing</h3>
    <p style="margin:0 0 4px;font-weight:600;">Category wash rates</p>
    <table class="pricing-table">
      <thead>
        <tr>
          <th>Category</th>
          <th style="text-align:right;">Products</th>
          <th style="text-align:right;">Wash price</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${categoryLines || '<tr><td colspan="4">No category rows</td></tr>'}</tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td class="num">${categoryTotals.productCount}</td>
          <td></td>
          <td class="num">${esc(formatCurrency(categoryTotals.lineTotal))}</td>
        </tr>
      </tfoot>
    </table>
    ${accessoriesBlock}
    <div class="totals">
      <div class="row"><span>Product total</span><strong>${esc(formatCurrency(job.productTotal))}</strong></div>
      ${accessoryTotalRow}
      <div class="row"><span>Subtotal</span><strong>${esc(formatCurrency(job.subtotal))}</strong></div>
      <div class="row"><span>Discount</span><strong>${esc(formatCurrency(job.discountAmount))}</strong></div>
      <div class="row payable"><span>Payable amount</span><strong>${esc(formatCurrency(job.payable))}</strong></div>
    </div>
  `;
}

/** @param {{ jobNo?: string, payable?: number, vendorOutstanding?: ReturnType<typeof normalizeLaundrySlipInput>['vendorOutstanding'] }} job */
function buildVendorOutstandingSection(job) {
  const outstanding = job.vendorOutstanding;
  if (!outstanding?.totals?.billCount) return '';

  const { currentBill, oldPending, totalPending } = calculateVendorOutstandingAmounts({
    outstanding,
    currentBillAmount: job.payable,
    currentJobNo: job.jobNo,
  });

  return `
    <div class="vendor-outstanding">
      <h3>Vendor outstanding</h3>
      <div class="totals">
        <div class="row"><span>Current Bill Amount</span><strong>${esc(formatCurrency(currentBill))}</strong></div>
        <div class="row"><span>Old Pending Bill Amount</span><strong>${esc(formatCurrency(oldPending))}</strong></div>
        <div class="row payable"><span>Final Total Pending Amount</span><strong>${esc(formatCurrency(totalPending))}</strong></div>
      </div>
    </div>
  `;
}

/** @param {Record<string, unknown>} input */
export function buildLaundrySlipHtml(input) {
  const job = normalizeLaundrySlipInput(input);
  if (!job) return '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(job.jobNo)}</title>
  <style>${SLIP_STYLES}</style>
</head>
<body class="laundry-slip">
  <h2>Laundry Job Slip</h2>
  <div class="meta">
    <div><b>Job:</b> ${esc(job.jobNo)} &nbsp; <b>Laundry date &amp; time:</b> ${esc(formatLaundrySlipDateTime(job.laundryDate) || formatLaundrySlipDate(job.laundryDate) || '-')} &nbsp; <b>Vendor:</b> ${esc(job.vendor)}</div>
    <div><b>Pickup by:</b> ${esc(job.pickupBy || '-')}</div>
  </div>
  ${buildCategorySection(job.productRows)}
  ${buildPrioritySection(job.productRows)}
  ${buildPricingSection(job)}
  ${buildVendorOutstandingSection(job)}
  ${buildRemarksFooter(job)}
</body>
</html>`;
}

/** @param {Record<string, unknown>} input */
export function printLaundrySlip(input) {
  const job = normalizeLaundrySlipInput(input);
  if (!job) return;
  const html = buildLaundrySlipHtml(input);
  if (!html) return;
  const title = job.jobNo && job.jobNo !== '-' ? `Laundry ${job.jobNo}` : 'Laundry Job Slip';
  renderAndPrint(html, { title });
}

/**
 * Build laundry slip PDF as base64 for WhatsApp attachment.
 * @param {Record<string, unknown>} input — same shape as printLaundrySlip
 * @returns {Promise<{ base64: string, filename: string } | null>}
 */
export async function buildLaundrySlipPdfBase64(input) {
  const job = normalizeLaundrySlipInput(input);
  if (!job) return null;
  const safe = String(job.jobNo || 'slip').replace(/[^\w.-]+/g, '_');
  const [{ blobToBase64 }, { buildLaundrySlipPdfBlob }] = await Promise.all([
    import('../../utils/billPdf.js'),
    import('../../utils/laundrySlipPdf.js'),
  ]);
  const blob = await buildLaundrySlipPdfBlob(input);
  const base64 = await blobToBase64(blob);
  return {
    base64,
    filename: `laundry-${safe}.pdf`,
  };
}
