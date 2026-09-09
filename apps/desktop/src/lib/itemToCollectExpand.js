import { itemsToCollectApi } from './api/itemsToCollect.js';

/** Must match itemsToCollectQuerySchema per_page max (200). */
const EXPORT_FETCH_PER_PAGE = 200;

/**
 * All product lines matching Item to Collect list filters (PDF / print slips).
 * Enrichment must stay enabled so export columns (current status, availability) match the on-screen list.
 *
 * @param {Record<string, unknown>} filterParams
 */
export async function fetchAllCollectLines(filterParams) {
  let page = 1;
  let expectedTotal = 0;
  let totalPages = 1;
  const byId = new Map();

  while (page <= totalPages) {
    const res = await itemsToCollectApi.listLines({
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
