/**
 * Map a paginated list API response into DataTable footer props.
 * @param {{ data?: object[], meta?: { page?: number, total?: number, total_pages?: number } }} res
 * @param {string} [countLabel]
 */
export function tableCountFromListResponse(res, countLabel = 'records') {
  const meta = res?.meta;
  const visibleCount = res?.data?.length ?? 0;
  const totalCount = meta?.total ?? visibleCount;
  return {
    visibleCount,
    totalCount,
    page: meta?.page ?? 1,
    totalPages: meta?.total_pages ?? 1,
    countLabel,
  };
}

/**
 * Client-side slice for report tables that load all rows at once.
 * @param {Array<unknown>} rows
 * @param {number} page 1-based
 * @param {number} perPage
 */
export function paginateClientRows(rows, page, perPage) {
  const list = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, Number(perPage) || 20);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    rows: list.slice(start, start + size),
    page: safePage,
    total,
    totalPages,
    visibleCount: Math.min(size, total - start),
  };
}
