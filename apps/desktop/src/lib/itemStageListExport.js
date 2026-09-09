import { downloadCsv } from '../utils/csv.js';

export const ITEM_STAGE_EXPORT_LAYOUT = Object.freeze({
  COMBINED: 'combined',
  SALESMAN_WISE: 'salesman-wise',
});

/** @param {object} row */
export function itemStageSalesPersonLabel(row) {
  return String(row?.sales_person_name ?? '').trim() || 'Unassigned';
}

/** @param {object[]} rows */
export function groupItemStageRowsBySalesman(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const label = itemStageSalesPersonLabel(row);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(row);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([label, groupRows]) => ({ label, rows: groupRows }));
}

/**
 * @param {object[]} rows
 * @param {'combined'|'salesman-wise'} layout
 */
export function buildItemStageExportGroups(rows, layout) {
  if (layout === ITEM_STAGE_EXPORT_LAYOUT.SALESMAN_WISE) {
    return groupItemStageRowsBySalesman(rows);
  }
  return [{ label: null, rows: rows || [] }];
}

/**
 * @param {object} params
 * @param {'pdf'|'excel'} params.format
 * @param {'combined'|'salesman-wise'} params.layout
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown, richGet?: (row: object) => unknown }>} params.columns
 * @param {object[]} params.rows
 * @param {string} params.filename
 * @param {{ title?: string, subtitle?: string }} [params.pdfOptions]
 */
export async function runItemStageTableExport({
  format,
  layout,
  columns,
  rows,
  filename,
  pdfOptions = {},
}) {
  const groups = buildItemStageExportGroups(rows, layout);

  if (format === 'pdf') {
    if (layout === ITEM_STAGE_EXPORT_LAYOUT.SALESMAN_WISE) {
      const { downloadGroupedTablePdf } = await import('../utils/tablePdf.js');
      downloadGroupedTablePdf(filename, columns, groups, pdfOptions);
      return;
    }
    const { downloadTablePdf } = await import('../utils/tablePdf.js');
    downloadTablePdf(filename, columns, rows, pdfOptions);
    return;
  }

  if (layout === ITEM_STAGE_EXPORT_LAYOUT.SALESMAN_WISE) {
    downloadCsvGrouped(filename, columns, groups);
    return;
  }
  downloadCsv(filename, columns, rows);
}

/**
 * @param {object} params — same as runItemStageTableExport
 */
export async function runItemStageTablePrint({
  layout,
  columns,
  rows,
  pdfOptions = {},
}) {
  const groups = buildItemStageExportGroups(rows, layout);

  if (layout === ITEM_STAGE_EXPORT_LAYOUT.SALESMAN_WISE) {
    const { printGroupedTablePdf } = await import('../utils/tablePdf.js');
    printGroupedTablePdf(columns, groups, pdfOptions);
    return;
  }
  const { printTablePdf } = await import('../utils/tablePdf.js');
  printTablePdf(columns, rows, pdfOptions);
}

/**
 * @param {string} filename
 * @param {Array<{ key: string, header?: string, get?: (row: object) => unknown }>} columns
 * @param {Array<{ label: string|null, rows: object[] }>} groups
 */
function downloadCsvGrouped(filename, columns, groups) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = columns.map((c) => esc(c.header || c.key)).join(',');
  const bodyLines = [];

  for (let i = 0; i < groups.length; i += 1) {
    const { label, rows: groupRows } = groups[i];
    if (i > 0) bodyLines.push('');
    if (label) {
      bodyLines.push([esc(`Salesman: ${label}`), ...columns.slice(1).map(() => '')].join(','));
    }
    for (const row of groupRows) {
      bodyLines.push(columns.map((c) => esc(c.get ? c.get(row) : row[c.key])).join(','));
    }
  }

  const csv = `\ufeff${header}\n${bodyLines.join('\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
