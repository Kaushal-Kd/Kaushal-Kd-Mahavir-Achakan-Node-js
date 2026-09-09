import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  earliestNextBookingPickupIsoFromAlerts,
  formatBookingDateTime,
  formatCurrency,
  formatDate,
} from '@wrs/shared';
import { ITEM_TO_COLLECT_PDF_EXPORT_COLUMNS } from '../../lib/itemToCollectPdfExport.js';
import { CheckSquare, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useApplyDashboardListDateFilters } from '../../hooks/useDashboardListDateDefaults.js';
import { useItemStageListSelection } from '../../hooks/useItemStageListSelection.js';
import { submitChecklistCommand, usePendingChecklistCommands } from '../../hooks/api/useChecklistCommand.js';
import { useItemStageSalesmanOptions } from '../../hooks/useItemStageSalesmanOptions.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import {
  buildItemStageAllNotesColumn,
  buildItemStageProductNotesColumn,
} from '../../components/reports/ItemStageNotesColumns.jsx';
import ItemStageExportLayoutDialog from '../../components/reports/ItemStageExportLayoutDialog.jsx';
import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import ItemStageSalesmanFilter from '../../components/reports/ItemStageSalesmanFilter.jsx';
import {
  ITEM_STAGE_LIST_DEFAULT_HIDDEN,
  buildItemCurrentStatusColumn,
  buildItemStageSalesmanColumn,
  isItemLineSelectable,
  itemLineCheckboxDisabledTitle,
} from '../../lib/itemStageListTable.js';
import { runItemStageTableExport, runItemStageTablePrint } from '../../lib/itemStageListExport.js';
import { useSearchParams } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import { categoriesApi } from '../../lib/api/categories.js';
import { itemsToCollectApi } from '../../lib/api/itemsToCollect.js';
import { fetchAllCollectLines } from '../../lib/itemToCollectExpand.js';
import { fetchProductWiseSlipTargets } from '../../lib/itemToCollectSlip.js';
import { buildCustomerAddressColumn } from '../../lib/listOrderColumns.jsx';
import { buildBookingDateTimeColumn } from '../../lib/listTimestampColumns.js';
import { saveItemToCollectCommands } from '../../lib/orderChecklistSave.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';
import { syncService } from '../../services/syncService.js';
import { BookingListNextBookingAlert } from '../booking/ChecklistNextBookingAlert.jsx';
import { orderHasNextBookingAlert } from '../booking/checklistNextBookingAlertUtils.js';

const SEARCH_ID = 'item-to-collect-search';

/** @param {Map<string, { id: string, order_id: string }>} selectedLines */
function groupSelectedByOrder(selectedLines) {
  const byOrder = new Map();
  for (const line of selectedLines.values()) {
    const oid = String(line.order_id);
    if (!byOrder.has(oid)) byOrder.set(oid, []);
    byOrder.get(oid).push(line.id);
  }
  return byOrder;
}

const ItemToCollectList = () => {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pickupFrom, setPickupFrom] = useState(() => searchParams.get('from') || '');
  const [pickupTo, setPickupTo] = useState(() => searchParams.get('to') || '');

  useApplyDashboardListDateFilters({
    preset: 'item_to_collect',
    setDateFrom: setPickupFrom,
    setDateTo: setPickupTo,
    syncUrl: true,
  });
  const [salesPersonIds, setSalesPersonIds] = useState([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [printSlip, setPrintSlip] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogAction, setExportDialogAction] = useState('download');
  const [markConfirmOpen, setMarkConfirmOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignSalesmanId, setReassignSalesmanId] = useState('');

  const filterParams = useMemo(
    () => ({
      sort: 'o.pickup_date,o.bill_no',
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(pickupFrom ? { pickup_from: pickupFrom } : {}),
      ...(pickupTo ? { pickup_to: pickupTo } : {}),
      ...(salesPersonIds.length ? { sales_person_ids: salesPersonIds.join(',') } : {}),
    }),
    [search, categoryId, pickupFrom, pickupTo, salesPersonIds]
  );

  const { options: salesmanFilterOptions, loading: salesmanOptionsLoading } =
    useItemStageSalesmanOptions();

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      ...filterParams,
    }),
    [page, perPage, filterParams]
  );

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['items-to-collect', listParams],
    queryFn: () => itemsToCollectApi.listLines(listParams),
  });

  const rows = data?.data ?? [];
  const totalCount = Number(data?.meta?.total ?? 0);
  const pendingChecklistEntries = usePendingChecklistCommands();
  const pendingOrderIds = useMemo(() => new Set(pendingChecklistEntries.map((entry) => String(entry.entityId))), [pendingChecklistEntries]);
  const isSelectable = useCallback((row) => isItemLineSelectable(row) && !pendingOrderIds.has(String(row.order_id)), [pendingOrderIds]);

  const {
    selectedLines,
    selectedCount,
    selectAllBusy,
    hasSelectableOnPage,
    selectableOnPageCount,
    headerCheckboxChecked,
    somePageSelected,
    showSelectAllMatchingBanner,
    toggleLineSelection,
    handleSelectAllHeaderChange,
    selectAllMatchingFilters,
    clearSelection,
    selectedPreview,
    isRowSelected,
    isRowCheckboxDisabled,
  } = useItemStageListSelection({
    listApi: { list: itemsToCollectApi.listLines },
    filterParams,
    pageRows: rows,
    totalCount,
    isRowSelectable: isSelectable,
  });
  const selectedHasPending = [...selectedLines.values()].some((line) => pendingOrderIds.has(String(line.order_id)));

  const guardExport = (action) => {
    if (totalCount === 0) {
      toast.warning(
        action === 'print' ? 'No product lines to print' : 'No product lines to export'
      );
      return false;
    }
    return true;
  };

  const resolveExportLineRows = async () => {
    const lineRows = await fetchAllCollectLines(filterParams);
    if (!lineRows.length) {
      toast.warning('No product lines to export');
      return [];
    }
    return lineRows;
  };

  const runPrintSlips = async (mode = 'download') => {
    if (!guardExport('print')) return;
    const stamp = `${pickupFrom || 'all'}_${pickupTo || 'all'}`;
    setExportBusy(true);
    try {
      const lineRows = await resolveExportLineRows();
      if (!lineRows.length) return;
      const slipTargets = await fetchProductWiseSlipTargets(lineRows);
      if (!slipTargets.length) {
        toast.warning('No slips to export');
        return;
      }
      if (mode === 'print') {
        const { printDeliverySlipPdf } = await import('../../utils/deliverySlipPdf.js');
        await printDeliverySlipPdf(slipTargets, 'Item to Collect — Print slips');
        toast.success('Opening product-wise print slips…');
      } else {
        const { downloadDeliverySlipPdf } = await import('../../utils/deliverySlipPdf.js');
        await downloadDeliverySlipPdf(
          `item_to_collect_slips_${stamp}_product_wise.pdf`,
          slipTargets
        );
        toast.success('Product-wise print slips downloaded');
      }
    } catch (err) {
      toast.error(
        err?.message ||
          (mode === 'print' ? 'Could not print slips' : 'Could not export print slips')
      );
    } finally {
      setExportBusy(false);
    }
  };

  const openExportLayoutDialog = (action) => {
    if (!guardExport(action)) return;
    setExportDialogAction(action);
    setExportDialogOpen(true);
  };

  const handlePrint = () => {
    if (printSlip) {
      runPrintSlips('print');
      return;
    }
    openExportLayoutDialog('print');
  };

  const openExportDialog = () => {
    if (!guardExport('export')) return;
    if (printSlip) {
      runPrintSlips('download');
      return;
    }
    openExportLayoutDialog('download');
  };

  const runTableExport = async (layout) => {
    const stamp = `${pickupFrom || 'all'}_${pickupTo || 'all'}`;
    const filterNote = ` · ${totalCount} product line(s) matching filters${search.trim() ? ` · Search: ${search.trim()}` : ''}`;
    const layoutSuffix = layout === 'salesman-wise' ? '_salesman_wise' : '';

    setExportBusy(true);
    try {
      const lineRows = await resolveExportLineRows();
      if (!lineRows.length) return;
      const pdfPayload = {
        layout,
        columns: ITEM_TO_COLLECT_PDF_EXPORT_COLUMNS,
        rows: lineRows,
        pdfOptions: {
          title: 'Item to Collect',
          subtitle: `Pickup ${pickupFrom || '—'} to ${pickupTo || '—'}${filterNote}`,
        },
      };
      if (exportDialogAction === 'print') {
        await runItemStageTablePrint(pdfPayload);
      } else {
        await runItemStageTableExport({
          format: 'pdf',
          ...pdfPayload,
          filename: `item_to_collect_${stamp}${layoutSuffix}.pdf`,
        });
        toast.success('PDF downloaded');
      }
      setExportDialogOpen(false);
    } catch (err) {
      toast.error(err?.message || 'Could not export');
    } finally {
      setExportBusy(false);
    }
  };

  const markItemToCollectMut = useMutation({
    mutationFn: () => saveItemToCollectCommands({ selectedLines, pendingEntries: pendingChecklistEntries, submit: submitChecklistCommand }),
    onSuccess: async ({ savedLineCount, queuedLineCount }) => {
      setMarkConfirmOpen(false);
      clearSelection();
      await invalidateOrderDomain(queryClient);
      toast.success(queuedLineCount
        ? `${savedLineCount} line(s) saved; ${queuedLineCount} line(s) queued. Review Pending sync before editing those bookings again.`
        : `Marked ${savedLineCount} line(s) as item to collect`);
    },
    onError: (e) =>
      toast.error(e.response?.data?.error?.message || e?.message || 'Failed to update checklist'),
  });

  const reassignMut = useMutation({
    mutationFn: async () => {
      if (!reassignSalesmanId) throw new Error('Select a salesman');
      if (selectedHasPending) throw new Error('Review the selected booking in Pending sync before transferring its work.');
      const byOrder = groupSelectedByOrder(selectedLines);
      let queued = 0;
      for (const [orderId, itemIds] of byOrder) {
        const orderNumber = selectedPreview.find((row) => row.order_id === orderId)?.order_number;
        const result = await syncService.submitOrQueueSalesmanReassignment(
          orderId,
          { order_item_ids: itemIds, sales_person_id: reassignSalesmanId },
          { orderNumber }
        );
        if (result.queued) queued += 1;
      }
      return { lineCount: selectedLines.size, queued };
    },
    onSuccess: async ({ lineCount, queued }) => {
      setReassignOpen(false);
      setReassignSalesmanId('');
      clearSelection();
      await invalidateOrderDomain(queryClient);
      toast.success(
        queued > 0
          ? `Salesman transfer queued for ${lineCount} line(s)`
          : `Transferred ${lineCount} line(s) to the selected salesman`
      );
    },
    onError: (error) =>
      toast.error(
        error?.response?.data?.error?.message || error?.message || 'Could not transfer work'
      ),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'product'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const categoryOptions = useMemo(() => {
    const rows = categoriesData?.data ?? categoriesData ?? [];
    const list = Array.isArray(rows) ? rows : [];
    return [
      { value: '', label: 'All categories' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.id })),
    ];
  }, [categoriesData]);

  const handleMarkItemToCollect = () => {
    if (selectedHasPending) {
      toast.warning('A selected booking has a pending checklist save. Review Pending sync first.');
      return;
    }
    if (selectedCount === 0) {
      toast.warning('Select at least one product line');
      return;
    }
    setMarkConfirmOpen(true);
  };

  const confirmMarkItemToCollect = () => {
    markItemToCollectMut.mutate();
  };

  const addressColumn = buildCustomerAddressColumn();

  const allColumns = [
    {
      key: 'select',
      locked: true,
      header: (
        <input
          type="checkbox"
          checked={headerCheckboxChecked}
          disabled={selectAllBusy || totalCount === 0 || !hasSelectableOnPage}
          ref={(el) => {
            if (el) el.indeterminate = somePageSelected && !headerCheckboxChecked;
          }}
          onChange={handleSelectAllHeaderChange}
          className="h-3.5 w-3.5 rounded border-gray-300 accent-brand"
          aria-label="Select all lines matching current filters"
        />
      ),
      width: 40,
      className: 'align-middle',
      render: (r) => {
        const pending = pendingOrderIds.has(String(r.order_id));
        const selectable = isSelectable(r);
        const disabled = isRowCheckboxDisabled(r) || !selectable;
        const selected = !disabled && isRowSelected(r);
        return (
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={selected}
              disabled={disabled}
              onClick={(e) => e.stopPropagation()}
              onChange={() => {
                if (disabled || !isSelectable(r)) return;
                toggleLineSelection(r);
              }}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-brand disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                pending ? 'Checklist save pending. Review Pending sync before editing this booking.' : disabled
                  ? itemLineCheckboxDisabledTitle(r)
                  : selected
                    ? 'Deselect line'
                    : 'Select line'
              }
              aria-label={
                pending ? 'Checklist save pending' : disabled
                  ? itemLineCheckboxDisabledTitle(r)
                  : selected
                    ? 'Deselect line'
                    : 'Select line'
              }
            />
          </div>
        );
      },
    },
    {
      key: 'collect_status',
      locked: true,
      columnPickerLabel: 'Collect status',
      header: 'Collect',
      className: 'text-xs whitespace-nowrap',
      render: () => (
        <Badge tone="yellow" className="whitespace-nowrap shrink-0">
          Pending
        </Badge>
      ),
    },
    buildItemCurrentStatusColumn(),
    {
      key: 'main_image',
      header: '',
      columnPickerLabel: 'Image',
      locked: true,
      className: 'text-xs w-12',
      render: (r) => (
        <SmartImage
          src={r.main_image || ''}
          alt={r.product_name || 'Product'}
          className="w-10 h-10 rounded border border-gray-200 bg-white object-contain shrink-0"
        />
      ),
    },
    {
      key: 'product_code',
      header: 'Code',
      locked: true,
      className: 'text-xs font-mono whitespace-nowrap',
      render: (r) => r.product_code || '—',
    },
    {
      key: 'product_name',
      header: 'Product',
      locked: true,
      className: 'text-xs',
      render: (r) => <span className="text-gray-900">{r.product_name || '—'}</span>,
    },
    {
      key: 'order_number',
      header: 'Booking No.',
      className: 'text-xs whitespace-nowrap',
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-gray-900">
          <BookingBillLink orderId={r.order_id}>{r.order_number || '—'}</BookingBillLink>
          {orderHasNextBookingAlert(r) ? (
            <BookingListNextBookingAlert alerts={r.next_booking_alerts} />
          ) : null}
        </span>
      ),
    },
    {
      key: 'customer_name',
      header: 'Customer Name',
      className: 'text-xs',
      render: (r) => (
        <span className="text-gray-900 font-medium">{r.customer_name || r.pickup_name || '—'}</span>
      ),
    },
    buildItemStageSalesmanColumn(),
    {
      key: 'customer_notes',
      columnPickerLabel: 'Bill remarks',
      header: 'Bill remarks',
      className: 'text-xs max-w-[14rem]',
      render: (r) => {
        const t = String(r.customer_notes || '').trim();
        return t ? (
          <span className="text-gray-900 truncate block" title={t}>
            {t}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        );
      },
    },
    buildItemStageProductNotesColumn(),
    buildItemStageAllNotesColumn(),
    {
      key: 'customer_phone',
      header: 'Customer No.',
      className: 'text-xs',
      render: (r) => (
        <span className="font-mono text-xs">{r.customer_phone || r.pickup_number || '—'}</span>
      ),
    },
    addressColumn,
    {
      key: 'reference_name',
      header: 'Reference',
      className: 'text-xs',
      render: (r) => {
        const t = String(r.reference_name || '').trim();
        return t ? (
          <span className="text-gray-900 truncate max-w-[10rem] block" title={t}>
            {t}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        );
      },
    },
    {
      key: 'delivery_datetime',
      header: 'Delivery',
      className: 'text-xs whitespace-nowrap tabular-nums',
      render: (r) => formatBookingDateTime(r.pickup_date, r.delivery_time) || '—',
    },
    {
      key: 'return_datetime',
      header: 'Return',
      className: 'text-xs whitespace-nowrap tabular-nums',
      render: (r) => formatBookingDateTime(r.return_date, r.return_time) || '—',
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      className: 'text-xs tabular-nums',
      render: (r) => {
        const n = Number(r.qty ?? 0);
        return Number.isFinite(n) ? n : 0;
      },
    },
    {
      key: 'rent',
      header: 'Rent',
      align: 'right',
      className: 'text-xs tabular-nums',
      render: (r) => formatCurrency(Number(r.rent ?? 0)),
    },
    {
      key: 'paid_amount',
      header: 'Advanced',
      align: 'right',
      className: 'text-xs tabular-nums',
      render: (r) => formatCurrency(r.paid_amount),
    },
    {
      key: 'security',
      header: 'Security',
      className: 'text-xs',
      render: (r) => {
        const expected = Number(r.deposit_amount || 0);
        const isReturned = !!r.deposit_returned;
        const isPaid = !!r.paid_security_amt || !!r.deposit_received;
        if (expected <= 0) return <span className="text-gray-500">No deposit</span>;
        return (
          <div className="flex items-center gap-1">
            <span className="font-medium">{formatCurrency(expected)}</span>
            <Badge tone={isReturned ? 'gray' : isPaid ? 'green' : 'yellow'}>
              {isReturned ? 'Returned' : isPaid ? 'Paid' : 'Unpaid'}
            </Badge>
          </div>
        );
      },
    },
    {
      key: 'nearest_next_booking',
      header: 'Next booking',
      className: 'text-xs whitespace-nowrap',
      render: (r) => {
        const iso = earliestNextBookingPickupIsoFromAlerts(r.next_booking_alerts);
        if (!iso) return <span className="text-gray-400">—</span>;
        return <span className="text-red-700 font-medium tabular-nums">{formatDate(iso)}</span>;
      },
    },
    buildBookingDateTimeColumn(),
  ];

  const { visibleColumns, pickerProps } = useDataTableColumns('items-to-collect', allColumns, {
    defaultHidden: ITEM_STAGE_LIST_DEFAULT_HIDDEN,
  });

  return (
    <>
      <PageHeader
        title="Item to Collect"
        description="Product lines on booked orders that are still pending collection on the checklist"
      />
      {pendingChecklistEntries.length > 0 ? (
        <div role="status" className="mb-3 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          {pendingChecklistEntries.length} booking checklist save(s) pending. Those bookings cannot be selected until synced or reviewed in Pending sync.
        </div>
      ) : null}

      <div className="card relative z-20 p-2 mb-3 overflow-visible space-y-2">
        <div className="flex flex-wrap items-start gap-1.5">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
            <div className="w-44 shrink-0 min-w-0">
              <label htmlFor={SEARCH_ID} className="sr-only">
                Search
              </label>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  id={SEARCH_ID}
                  type="search"
                  className="input w-full pl-8 text-xs py-1.5"
                  placeholder="Bill, customer, product code…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
            <div className="w-32 shrink-0 min-w-0">
              <Select
                label=""
                value={categoryId}
                onChange={(e) => {
                  setPage(1);
                  setCategoryId(e.target.value);
                }}
                options={categoryOptions}
              />
            </div>
            <ItemStageSalesmanFilter
              options={salesmanFilterOptions}
              selectedIds={salesPersonIds}
              onChange={(ids) => {
                setSalesPersonIds(ids);
                setPage(1);
              }}
              loading={salesmanOptionsLoading}
            />
            <div className="w-28 shrink-0 min-w-0">
              <label htmlFor="item-to-collect-from" className="sr-only">
                Pickup from
              </label>
              <Input
                id="item-to-collect-from"
                label=""
                type="date"
                placeholder="Pickup from"
                className="w-full min-w-0"
                inputClassName="text-xs py-1.5 pr-8"
                value={pickupFrom}
                max={pickupTo || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setPickupFrom(next);
                  setPage(1);
                  if (pickupTo && next && pickupTo < next) setPickupTo('');
                }}
              />
            </div>
            <div className="w-28 shrink-0 min-w-0">
              <label htmlFor="item-to-collect-to" className="sr-only">
                Pickup to
              </label>
              <Input
                id="item-to-collect-to"
                label=""
                type="date"
                placeholder="Pickup to"
                panelAlign="end"
                className="w-full min-w-0"
                inputClassName="text-xs py-1.5 pr-8"
                value={pickupTo}
                min={pickupFrom || undefined}
                onChange={(e) => {
                  setPickupTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-200 bg-white text-[11px] text-gray-700 cursor-pointer hover:bg-gray-50 select-none shrink-0">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand"
                checked={printSlip}
                onChange={(e) => setPrintSlip(e.target.checked)}
              />
              Print slip
            </label>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 border-l border-gray-100 pl-1.5 relative z-20 overflow-visible">
            <TableColumnPicker {...pickerProps} menuAlign="end" />
            <ListPdfToolbarButtons
              className="shrink-0"
              busy={exportBusy}
              disabled={isLoading || isFetching || totalCount === 0}
              onPrint={handlePrint}
              onExport={openExportDialog}
            />
          </div>
        </div>
        {selectedCount > 0 || showSelectAllMatchingBanner ? (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
            {selectedCount > 0 ? (
              <span className="text-xs text-gray-600">{selectedCount} selected</span>
            ) : null}
            {showSelectAllMatchingBanner ? (
              <span className="text-xs text-gray-700">
                All {selectableOnPageCount} available on this page are selected.{' '}
                <button
                  type="button"
                  className="text-brand font-medium hover:underline disabled:opacity-50"
                  disabled={selectAllBusy}
                  onClick={() => void selectAllMatchingFilters()}
                >
                  Select all available lines matching filters
                </button>
              </span>
            ) : null}
            {selectedCount > 0 ? (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  icon={CheckSquare}
                  disabled={markItemToCollectMut.isPending || reassignMut.isPending || selectedHasPending}
                  onClick={handleMarkItemToCollect}
                >
                  Mark item to collect
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={markItemToCollectMut.isPending || reassignMut.isPending || selectedHasPending}
                  onClick={() => setReassignOpen(true)}
                >
                  Transfer salesman
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={markItemToCollectMut.isPending || reassignMut.isPending}
                  onClick={clearSelection}
                >
                  Clear selection
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={isLoading || isFetching}
        rowKey="id"
        emptyTitle="No product lines to collect"
        emptyMessage="All product lines are collected, or try another search or wider filters."
        visibleCount={rows.length}
        totalCount={data?.meta?.total ?? 0}
        page={data?.meta?.page ?? page}
        totalPages={data?.meta?.total_pages ?? 1}
        countLabel="products"
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        disablePrevious={page <= 1}
        disableNext={page >= (data?.meta?.total_pages ?? 1)}
        perPage={perPage}
        onPerPageChange={(n) => {
          setPage(1);
          setPerPage(n);
        }}
      />

      <ConfirmDialog
        isOpen={markConfirmOpen}
        onClose={() => !markItemToCollectMut.isPending && setMarkConfirmOpen(false)}
        onConfirm={confirmMarkItemToCollect}
        title="Mark item to collect?"
        message={
          <div className="space-y-2">
            <p className="text-sm text-gray-700">
              {selectedCount === 1
                ? 'Mark this product line as collected on the checklist? It will be removed after the save is confirmed; offline changes remain pending.'
                : `Mark ${selectedCount} product lines as collected on the checklist? Each booking saves atomically. Offline changes remain pending until confirmed.`}
            </p>
            {selectedPreview.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50 divide-y divide-gray-100 text-xs">
                {selectedPreview.slice(0, 12).map((r) => (
                  <li key={r.id} className="px-2 py-1.5 text-gray-800">
                    <span className="font-mono text-gray-600">{r.product_code || '—'}</span>
                    {' · '}
                    <span className="font-medium">{r.product_name || '—'}</span>
                    {r.order_number ? (
                      <span className="text-gray-500"> ({r.order_number})</span>
                    ) : null}
                  </li>
                ))}
                {selectedCount > selectedPreview.length ? (
                  <li className="px-2 py-1.5 text-gray-500 italic">
                    + {selectedCount - selectedPreview.length} more
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
        }
        confirmLabel="Mark collected"
        cancelLabel="Cancel"
        loading={markItemToCollectMut.isPending}
      />

      <ConfirmDialog
        isOpen={reassignOpen}
        onClose={() => !reassignMut.isPending && setReassignOpen(false)}
        onConfirm={() => reassignMut.mutate()}
        title="Transfer selected work"
        message={
          <div className="space-y-2">
            <p>
              Assign {selectedCount} selected product line(s) to another salesman. The booking
              salesman will not change.
            </p>
            <Select
              label="Salesman"
              value={reassignSalesmanId}
              onChange={(event) => setReassignSalesmanId(event.target.value)}
              options={[
                { value: '', label: 'Select salesman' },
                ...salesmanFilterOptions.filter((option) => option.value !== 'none'),
              ]}
            />
          </div>
        }
        confirmLabel="Transfer"
        loading={reassignMut.isPending}
      />

      <ItemStageExportLayoutDialog
        isOpen={exportDialogOpen}
        onClose={() => !exportBusy && setExportDialogOpen(false)}
        onConfirm={runTableExport}
        loading={exportBusy}
        action={exportDialogAction}
      />
    </>
  );
};

export default ItemToCollectList;
