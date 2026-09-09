import { useCallback, useEffect, useMemo, useState } from 'react';

import { toast } from '../stores/uiStore.js';

/** Rows per page when loading data for export/print (skips heavy enrich on server). */
const EXPORT_FETCH_PER_PAGE = 500;

/** @param {object} row */
function lineId(row) {
  return String(row?.id ?? '');
}

/**
 * @param {object} row
 * @returns {{ id: string, order_id: string }}
 */
function linePick(row) {
  return { id: lineId(row), order_id: row.order_id,
    product_id: row.product_id, replacement_version: row.replacement_version,
    checklist_state_token: row.checklist_state_token };
}

/**
 * @param {{ list: (params: object) => Promise<{ data?: object[], meta?: object }> }} listApi
 * @param {Record<string, unknown>} filterParams
 * @param {{ skipEnrich?: boolean }} [opts]
 */
async function fetchAllRows(listApi, filterParams, opts = {}) {
  let page = 1;
  let expectedTotal = 0;
  let totalPages = 1;
  const byId = new Map();

  while (page <= totalPages) {
    const res = await listApi.list({
      ...filterParams,
      page,
      per_page: EXPORT_FETCH_PER_PAGE,
      ...(opts.skipEnrich ? { skip_enrich: true } : {}),
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
      const id = lineId(row);
      if (id) byId.set(id, row);
    }

    if (!chunk.length) break;
    if (expectedTotal > 0 && byId.size >= expectedTotal) break;
    page += 1;
  }

  return { rows: [...byId.values()], expectedTotal };
}

/**
 * Selection for item-stage lists. "Select all matching filters" is instant (virtual);
 * row data is loaded only when exporting or printing slips.
 *
 * @param {{
 *   listApi: { list: (params: object) => Promise<{ data?: object[], meta?: { total?: number, total_pages?: number } }> },
 *   filterParams: Record<string, unknown>,
 *   pageRows: object[],
 *   totalCount: number,
 *   isRowSelectable?: (row: object) => boolean,
 *   pickRow?: (row: object) => { id: string, order_id: string },
 *   bulkExcludeKey?: 'exclude_item_ids' | 'exclude_order_ids',
 * }} options
 */
export function useItemStageListSelection({
  listApi,
  filterParams,
  pageRows,
  totalCount,
  isRowSelectable,
  pickRow,
  bulkExcludeKey = 'exclude_item_ids',
}) {
  const pickRowFn = pickRow ?? linePick;
  const [selectedLines, setSelectedLines] = useState(() => new Map());
  /** When set, every filtered row is selected except excludedIds. */
  const [selectAllFiltered, setSelectAllFiltered] = useState(null);
  const [exportFetchBusy, setExportFetchBusy] = useState(false);

  const filterKey = useMemo(() => JSON.stringify(filterParams), [filterParams]);

  const isSelectAllFiltered =
    Boolean(selectAllFiltered) && selectAllFiltered.filterKey === filterKey;

  const pageSelectableRows = useMemo(() => {
    if (!isRowSelectable) return pageRows;
    return pageRows.filter(isRowSelectable);
  }, [pageRows, isRowSelectable]);

  useEffect(() => {
    setSelectedLines(new Map());
    setSelectAllFiltered(null);
  }, [filterKey]);

  const isRowSelected = useCallback(
    (row) => {
      const id = lineId(row);
      if (!id) return false;
      if (isSelectAllFiltered) return !selectAllFiltered.excludedIds.has(id);
      return selectedLines.has(id);
    },
    [isSelectAllFiltered, selectAllFiltered, selectedLines]
  );

  const selectedCount = useMemo(() => {
    if (isSelectAllFiltered) {
      return Math.max(0, totalCount - selectAllFiltered.excludedIds.size);
    }
    return selectedLines.size;
  }, [isSelectAllFiltered, selectAllFiltered, totalCount, selectedLines]);

  const allPageSelected =
    pageSelectableRows.length > 0 && pageSelectableRows.every((r) => isRowSelected(r));
  const somePageSelected = pageSelectableRows.some((r) => isRowSelected(r));

  const allFilteredSelected =
    isSelectAllFiltered && selectAllFiltered.excludedIds.size === 0 && totalCount > 0;

  const showSelectAllMatchingBanner =
    totalCount > pageRows.length &&
    allPageSelected &&
    !allFilteredSelected &&
    !exportFetchBusy &&
    pageSelectableRows.length > 0;

  const toggleLineSelection = useCallback(
    (row) => {
      const id = lineId(row);
      if (!id) return;

      if (isRowSelectable && !isRowSelectable(row)) {
        toast.warning('Only products with status Available can be selected');
        return;
      }

      if (isSelectAllFiltered) {
        setSelectAllFiltered((prev) => {
          if (!prev || prev.filterKey !== filterKey) return prev;
          const excludedIds = new Set(prev.excludedIds);
          if (excludedIds.has(id)) excludedIds.delete(id);
          else excludedIds.add(id);
          return { ...prev, excludedIds };
        });
        return;
      }

      setSelectedLines((prev) => {
        const next = new Map(prev);
        if (next.has(id)) next.delete(id);
        else next.set(id, pickRowFn(row));
        return next;
      });
    },
    [isSelectAllFiltered, filterKey, isRowSelectable, pickRowFn]
  );

  const toggleAllPageLines = useCallback(
    (checked) => {
      setSelectAllFiltered(null);
      setSelectedLines((prev) => {
        const next = new Map(prev);
        const rowsToToggle = isRowSelectable ? pageSelectableRows : pageRows;
        for (const row of rowsToToggle) {
          const id = lineId(row);
          if (!id) continue;
          if (checked) next.set(id, pickRowFn(row));
          else next.delete(id);
        }
        return next;
      });
    },
    [pageRows, pageSelectableRows, isRowSelectable, pickRowFn]
  );

  const selectAllMatchingFilters = useCallback(async () => {
    if (totalCount <= 0) {
      toast.warning('No rows match the current filters');
      return;
    }

    if (isRowSelectable) {
      setExportFetchBusy(true);
      try {
        const { rows, expectedTotal } = await fetchAllRows(listApi, filterParams, {
          skipEnrich: false,
        });
        const selectableRows = rows.filter(isRowSelectable);
        if (!selectableRows.length) {
          toast.warning('No available lines match the current filters');
          return;
        }
        if (expectedTotal > 0 && rows.length < expectedTotal) {
          toast.warning(
            `Loaded ${rows.length} of ${expectedTotal} rows — selection may be incomplete. Narrow filters and try again.`
          );
        }
        const next = new Map();
        for (const row of selectableRows) {
          const id = lineId(row);
          if (id) next.set(id, pickRowFn(row));
        }
        setSelectAllFiltered(null);
        setSelectedLines(next);
        toast.success(
          selectableRows.length === 1
            ? '1 available line selected'
            : `${selectableRows.length} available lines selected`
        );
      } catch (err) {
        toast.error(err?.message || 'Could not select matching lines');
      } finally {
        setExportFetchBusy(false);
      }
      return;
    }

    setSelectAllFiltered({ filterKey, excludedIds: new Set() });
    setSelectedLines(new Map());
    toast.success(
      totalCount === 1 ? '1 row selected' : `All ${totalCount} rows selected`
    );
  }, [filterKey, totalCount, isRowSelectable, listApi, filterParams, pickRowFn]);

  const handleSelectAllHeaderChange = useCallback(
    (e) => {
      const wantChecked = e.target.checked;

      if (!wantChecked) {
        if (isSelectAllFiltered) {
          setSelectAllFiltered(null);
          setSelectedLines(new Map());
          return;
        }
        toggleAllPageLines(false);
        return;
      }

      if (pageSelectableRows.length === 0) {
        toast.warning('No available lines on this page to select');
        return;
      }

      if (totalCount > pageRows.length) {
        void selectAllMatchingFilters();
        return;
      }

      toggleAllPageLines(true);
    },
    [
      isSelectAllFiltered,
      toggleAllPageLines,
      totalCount,
      pageRows.length,
      pageSelectableRows.length,
      selectAllMatchingFilters,
    ]
  );

  const headerCheckboxChecked =
    allFilteredSelected ||
    (pageSelectableRows.length > 0 && pageSelectableRows.every((r) => isRowSelected(r)));

  const clearSelection = useCallback(() => {
    setSelectedLines(new Map());
    setSelectAllFiltered(null);
  }, []);

  const resolveExportRows = useCallback(async () => {
    if (selectedCount === 0) return pageRows;

    if (isSelectAllFiltered) {
      if (selectAllFiltered.excludedIds.size === 0) {
        setExportFetchBusy(true);
        try {
          const { rows, expectedTotal } = await fetchAllRows(listApi, filterParams, {
            skipEnrich: true,
          });
          if (expectedTotal > 0 && rows.length < expectedTotal) {
            toast.warning(
              `Loaded ${rows.length} of ${expectedTotal} rows for export — try again or narrow filters.`
            );
          }
          return rows;
        } finally {
          setExportFetchBusy(false);
        }
      }

      setExportFetchBusy(true);
      try {
        const { rows } = await fetchAllRows(listApi, filterParams, { skipEnrich: true });
        const excluded = selectAllFiltered.excludedIds;
        return rows.filter((r) => !excluded.has(lineId(r)));
      } finally {
        setExportFetchBusy(false);
      }
    }

    if (selectedLines.size > 0) {
      const onPage = pageRows.filter((r) => selectedLines.has(lineId(r)));
      if (onPage.length === selectedLines.size) return onPage;

      setExportFetchBusy(true);
      try {
        const { rows } = await fetchAllRows(listApi, filterParams, { skipEnrich: true });
        return rows.filter((r) => selectedLines.has(lineId(r)));
      } finally {
        setExportFetchBusy(false);
      }
    }

    return pageRows;
  }, [
    selectedCount,
    isSelectAllFiltered,
    selectAllFiltered,
    pageRows,
    listApi,
    filterParams,
    selectedLines,
  ]);

  const exportRows = useMemo(() => {
    if (selectedCount === 0) return pageRows;
    if (isSelectAllFiltered) {
      return pageRows.filter((r) => isRowSelected(r));
    }
    return pageRows.filter((r) => selectedLines.has(lineId(r)));
  }, [selectedCount, pageRows, isSelectAllFiltered, isRowSelected, selectedLines]);

  const selectedPreview = useMemo(() => {
    if (isSelectAllFiltered) {
      return pageRows.filter((r) => isRowSelected(r)).slice(0, 12);
    }
    return pageRows.filter((r) => selectedLines.has(lineId(r))).slice(0, 12);
  }, [isSelectAllFiltered, isRowSelected, pageRows, selectedLines]);

  const buildBulkMarkBody = useCallback(
    (field, value) => {
      if (isRowSelectable) return null;
      if (isSelectAllFiltered) {
        return {
          field,
          value,
          ...filterParams,
          ...(selectAllFiltered.excludedIds.size
            ? { [bulkExcludeKey]: [...selectAllFiltered.excludedIds] }
            : {}),
        };
      }
      return null;
    },
    [isSelectAllFiltered, filterParams, selectAllFiltered, isRowSelectable, bulkExcludeKey]
  );

  const isRowCheckboxDisabled = useCallback(
    (row) => Boolean(isRowSelectable && !isRowSelectable(row)),
    [isRowSelectable]
  );

  return {
    selectedLines,
    selectedCount,
    hasSelectableOnPage: pageSelectableRows.length > 0,
    selectableOnPageCount: pageSelectableRows.length,
    selectAllBusy: exportFetchBusy,
    isSelectAllFiltered,
    allFilteredSelected,
    headerCheckboxChecked,
    allPageSelected,
    somePageSelected,
    showSelectAllMatchingBanner,
    totalCount,
    toggleLineSelection,
    handleSelectAllHeaderChange,
    selectAllMatchingFilters,
    clearSelection,
    exportRows,
    resolveExportRows,
    buildBulkMarkBody,
    selectedPreview,
    isRowSelected,
    isRowCheckboxDisabled,
    lineId,
  };
}
