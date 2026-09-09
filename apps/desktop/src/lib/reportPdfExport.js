import { toast } from '../stores/uiStore.js';

export const EXPORT_PER_PAGE = 500;

/**
 * @param {object} params
 * @returns {object}
 */
export function omitPagination(params = {}) {
  const next = { ...params };
  delete next.page;
  delete next.per_page;
  return next;
}

/**
 * @param {(params: object) => Promise<{ data?: object[], meta?: { total_pages?: number } }>} listFn
 * @param {object} baseParams
 * @returns {Promise<object[]>}
 */
export async function fetchAllPages(listFn, baseParams = {}) {
  const acc = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await listFn({ ...baseParams, page, per_page: EXPORT_PER_PAGE });
    acc.push(...(res?.data || []));
    totalPages = Number(res?.meta?.total_pages) || 1;
    page += 1;
  } while (page <= totalPages);
  return acc;
}

/**
 * Reports API shape: { data: { rows, meta } }
 * @param {(params: object) => Promise<{ data?: { rows?: object[], meta?: { total_pages?: number } } }>} reportFn
 * @param {object} baseParams
 */
export async function fetchAllReportRows(reportFn, baseParams = {}) {
  const acc = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await reportFn({ ...baseParams, page, per_page: EXPORT_PER_PAGE });
    const payload = res?.data;
    acc.push(...(payload?.rows ?? []));
    totalPages = Number(payload?.meta?.total_pages) || 1;
    page += 1;
  } while (page <= totalPages);
  return acc;
}

/**
 * @param {{
 *   filename: string,
 *   title: string,
 *   subtitle?: string,
 *   columns: Array<{ key: string, header?: string, get?: (row: object) => unknown }>,
 *   rows: object[],
 * }} opts
 */
export async function runTablePdfExport(opts) {
  const { filename, title, subtitle, columns, rows } = opts;
  if (!rows?.length) {
    toast.warning('No data to export');
    return;
  }
  const { downloadTablePdf } = await import('../utils/tablePdf.js');
  downloadTablePdf(filename, columns, rows, { title, subtitle });
  toast.success('PDF downloaded');
}

/**
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   columns: Array<{ key: string, header?: string, get?: (row: object) => unknown }>,
 *   rows: object[],
 * }} opts
 */
export async function runTablePdfPrint(opts) {
  const { title, subtitle, columns, rows } = opts;
  if (!rows?.length) {
    toast.warning('No data to print');
    return;
  }
  const { printTablePdf } = await import('../utils/tablePdf.js');
  printTablePdf(columns, rows, { title, subtitle });
}

/**
 * Fetch all pages using the same filter params as the on-screen list (no pagination).
 * @param {{
 *   listFn: (params: object) => Promise<{ data?: object[], meta?: { total_pages?: number } }>,
 *   listParams?: object,
 *   columns: Array<{ key: string, header?: string, get?: (row: object) => unknown }>,
 *   title: string,
 *   filename: string,
 *   subtitle?: string,
 * }} opts
 */
export async function exportFilteredListPdf(opts) {
  const { listFn, listParams = {}, columns, title, filename, subtitle } = opts;
  const rows = await fetchAllPages(listFn, omitPagination(listParams));
  await runTablePdfExport({ filename, title, subtitle, columns, rows });
}

/**
 * @param {{
 *   listFn: (params: object) => Promise<{ data?: object[], meta?: { total_pages?: number } }>,
 *   listParams?: object,
 *   columns: Array<{ key: string, header?: string, get?: (row: object) => unknown }>,
 *   title: string,
 *   subtitle?: string,
 * }} opts
 */
export async function exportFilteredListPrint(opts) {
  const { listFn, listParams = {}, columns, title, subtitle } = opts;
  const rows = await fetchAllPages(listFn, omitPagination(listParams));
  await runTablePdfPrint({ title, subtitle, columns, rows });
}

/**
 * @param {{
 *   filename: string,
 *   title: string,
 *   subtitle?: string,
 *   columns: Array<{ key: string, header?: string, get?: (row: object) => unknown }>,
 *   groups: Array<{ label?: string|null, rows: object[] }>,
 * }} opts
 */
export async function runGroupedPdfExport(opts) {
  const { filename, title, subtitle, columns, groups } = opts;
  const totalRows = (groups || []).reduce((n, g) => n + (g.rows?.length || 0), 0);
  if (!totalRows) {
    toast.warning('No data to export');
    return;
  }
  const { downloadGroupedTablePdf } = await import('../utils/tablePdf.js');
  downloadGroupedTablePdf(filename, columns, groups, { title, subtitle });
  toast.success('PDF downloaded');
}

/**
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   columns: Array<{ key: string, header?: string, get?: (row: object) => unknown }>,
 *   groups: Array<{ label?: string|null, rows: object[] }>,
 * }} opts
 */
export async function runGroupedPdfPrint(opts) {
  const { title, subtitle, columns, groups } = opts;
  const totalRows = (groups || []).reduce((n, g) => n + (g.rows?.length || 0), 0);
  if (!totalRows) {
    toast.warning('No data to print');
    return;
  }
  const { printGroupedTablePdf } = await import('../utils/tablePdf.js');
  printGroupedTablePdf(columns, groups, { title, subtitle });
}

/**
 * @param {() => Promise<void>} fn
 */
export async function withExportPdfBusy(setBusy, fn) {
  setBusy(true);
  try {
    await fn();
  } catch (err) {
    toast.error(err?.message || 'Could not export PDF');
  } finally {
    setBusy(false);
  }
}

/**
 * @param {() => Promise<void>} fn
 */
export async function withListPdfBusy(setBusy, fn) {
  setBusy(true);
  try {
    await fn();
  } catch (err) {
    toast.error(err?.message || 'Could not print');
  } finally {
    setBusy(false);
  }
}
