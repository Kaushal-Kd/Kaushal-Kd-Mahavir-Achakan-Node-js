import { itemsToPrepareApi } from './api/itemsToPrepare.js';

/** Must match itemsToPrepareQuerySchema per_page max (200). */
const EXPORT_FETCH_PER_PAGE = 200;
const ORDER_IDS_CHUNK = 50;

/**
 * All bookings matching Prepare Item list filters (for PDF / print slips).
 *
 * @param {Record<string, unknown>} filterParams
 */
export async function fetchAllBookingsToPrepare(filterParams) {
  let page = 1;
  let expectedTotal = 0;
  let totalPages = 1;
  const byId = new Map();

  while (page <= totalPages) {
    const res = await itemsToPrepareApi.list({
      ...filterParams,
      page,
      per_page: EXPORT_FETCH_PER_PAGE,
    });
    const chunk = res?.data ?? [];
    const meta = res?.meta ?? {};

    if (page === 1) {
      expectedTotal = Number(meta.total) || 0;
      const fromMeta = Number(meta.total_pages);
      totalPages =
        fromMeta > 0 ? fromMeta : Math.max(1, Math.ceil(expectedTotal / EXPORT_FETCH_PER_PAGE) || 1);
    }

    for (const row of chunk) {
      const id = String(row?.id ?? '');
      if (id) byId.set(id, row);
    }

    if (!chunk.length) break;
    if (expectedTotal > 0 && byId.size >= expectedTotal) break;
    page += 1;
  }

  return [...byId.values()];
}

/**
 * Product lines for bookings (PDF / print slips).
 * @param {object[]} bookingRows
 * @param {Record<string, unknown>} filterParams
 * @param {{ allLines?: boolean }} [opts]
 */
export async function fetchPrepareLinesForBookings(bookingRows, filterParams, opts = {}) {
  const list = Array.isArray(bookingRows) ? bookingRows : [];
  const orderIds = [
    ...new Set(list.map((r) => String(r.order_id || r.id || '').trim()).filter(Boolean)),
  ];
  if (!orderIds.length) return [];

  const byLineId = new Map();
  const exportFilters = opts.allLines
    ? (({ collect_status, ...rest }) => rest)(filterParams)
    : filterParams;
  for (let i = 0; i < orderIds.length; i += ORDER_IDS_CHUNK) {
    const chunk = orderIds.slice(i, i + ORDER_IDS_CHUNK);
    let page = 1;
    let totalPages = 1;
    do {
      const res = await itemsToPrepareApi.listLines({
        ...exportFilters,
        order_ids: chunk.join(','),
        page,
        per_page: 200,
        sort: 'oi.display_order',
        ...(opts.allLines ? { all_lines: 1 } : {}),
      });
      for (const row of res?.data ?? []) {
        const id = String(row?.id ?? '');
        if (id) byLineId.set(id, row);
      }
      if (page === 1) {
        totalPages = Number(res?.meta?.total_pages) || 1;
      }
      page += 1;
    } while (page <= totalPages);
  }
  return [...byLineId.values()];
}
