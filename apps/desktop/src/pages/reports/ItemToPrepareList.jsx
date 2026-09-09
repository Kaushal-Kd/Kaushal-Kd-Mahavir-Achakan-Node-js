import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  earliestNextBookingPickupIsoFromAlerts,
  formatBookingDateTime,
  formatCurrency,
  formatDate,
  ORDER_STATUS_LABELS,
} from '@wrs/shared';
import {
  ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS,
  ITEM_TO_PREPARE_PRINT_COLUMNS,
  buildPrepareProductExportRows,
} from '../../lib/itemToPreparePdfExport.js';
import { ClipboardCheck, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useApplyDashboardListDateFilters } from '../../hooks/useDashboardListDateDefaults.js';
import { useItemStageSalesmanOptions } from '../../hooks/useItemStageSalesmanOptions.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import ItemStageExportLayoutDialog from '../../components/reports/ItemStageExportLayoutDialog.jsx';
import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import ItemStageSalesmanFilter from '../../components/reports/ItemStageSalesmanFilter.jsx';
import { buildItemStageSalesmanColumn } from '../../lib/itemStageListTable.js';
import { runItemStageTableExport, runItemStageTablePrint } from '../../lib/itemStageListExport.js';
import { useNavigate, useSearchParams } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import { categoriesApi } from '../../lib/api/categories.js';
import { itemsToPrepareApi } from '../../lib/api/itemsToPrepare.js';
import {
  fetchAllBookingsToPrepare,
  fetchPrepareLinesForBookings,
} from '../../lib/itemToPrepareExpand.js';
import { fetchProductWiseSlipTargets } from '../../lib/itemToCollectSlip.js';
import { buildCustomerAddressColumn } from '../../lib/listOrderColumns.jsx';
import { buildBookingDateTimeColumn } from '../../lib/listTimestampColumns.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';
import { BookingListNextBookingAlert } from '../booking/ChecklistNextBookingAlert.jsx';
import { orderHasNextBookingAlert } from '../booking/checklistNextBookingAlertUtils.js';
import DeliverySettlementModal from '../booking/DeliverySettlementModal.jsx';
import ItemsChecklistModal from '../booking/ItemsChecklistModal.jsx';
import ReturnSettlementModal from '../booking/ReturnSettlementModal.jsx';
import SettlementModal from '../booking/SettlementModal.jsx';

const SEARCH_ID = 'item-to-prepare-search';

const COLLECT_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All collect' },
  { value: 'collected', label: 'Collected' },
  { value: 'pending', label: 'Pending collect' },
];

const ITEM_TO_PREPARE_BOOKING_DEFAULT_HIDDEN = [
  'customer_notes',
  'reference_name',
  'customer_phone',
  'customer_address',
  'security',
  'nearest_next_booking',
  'booking_datetime',
];

const ItemToPrepareList = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pickupFrom, setPickupFrom] = useState(() => searchParams.get('from') || '');
  const [pickupTo, setPickupTo] = useState(() => searchParams.get('to') || '');

  useApplyDashboardListDateFilters({
    preset: 'item_to_prepare',
    setDateFrom: setPickupFrom,
    setDateTo: setPickupTo,
    syncUrl: true,
  });
  const [collectStatusFilter, setCollectStatusFilter] = useState('');
  const [salesPersonIds, setSalesPersonIds] = useState([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [printSlip, setPrintSlip] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogAction, setExportDialogAction] = useState('download');
  const [checklistOrderId, setChecklistOrderId] = useState(null);
  const [settlementOrderId, setSettlementOrderId] = useState(null);
  const [deliverySettlementOrderId, setDeliverySettlementOrderId] = useState(null);
  const [deliveryStageUpdates, setDeliveryStageUpdates] = useState(null);
  const [deliveryStageDraftAfter, setDeliveryStageDraftAfter] = useState(null);
  const [returnSettlementOrderId, setReturnSettlementOrderId] = useState(null);
  const [returnStageUpdates, setReturnStageUpdates] = useState(null);
  const [returnStageDraftAfter, setReturnStageDraftAfter] = useState(null);
  const [returnConditionUpdates, setReturnConditionUpdates] = useState(null);

  const refreshPrepareList = () => {
    void queryClient.invalidateQueries({ queryKey: ['items-to-prepare'] });
  };

  const filterParams = useMemo(
    () => ({
      sort: 'o.pickup_date,o.bill_no',
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(pickupFrom ? { pickup_from: pickupFrom } : {}),
      ...(pickupTo ? { pickup_to: pickupTo } : {}),
      ...(collectStatusFilter ? { collect_status: collectStatusFilter } : {}),
      ...(salesPersonIds.length ? { sales_person_ids: salesPersonIds.join(',') } : {}),
    }),
    [search, categoryId, pickupFrom, pickupTo, collectStatusFilter, salesPersonIds]
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
    queryKey: ['items-to-prepare', listParams],
    queryFn: () => itemsToPrepareApi.list(listParams),
  });

  const rows = data?.data ?? [];
  const totalCount = Number(data?.meta?.total ?? 0);

  const resolvePrepareLineRows = async () => {
    const bookings = await fetchAllBookingsToPrepare(filterParams);
    return fetchPrepareLinesForBookings(bookings, filterParams);
  };

  const resolvePrepareBookingExportRows = async () => {
    const bookings = await fetchAllBookingsToPrepare(filterParams);
    const lineRows = await fetchPrepareLinesForBookings(bookings, filterParams, { allLines: true });
    if (!lineRows.length) return [];
    return buildPrepareProductExportRows(bookings, lineRows);
  };

  const guardExport = (action) => {
    if (totalCount === 0) {
      toast.warning(action === 'print' ? 'No bookings to print' : 'No bookings to export');
      return false;
    }
    return true;
  };

  const runPrintSlips = async (mode = 'download') => {
    if (!guardExport('print')) return;
    const stamp = `${pickupFrom || 'all'}_${pickupTo || 'all'}`;
    setExportBusy(true);
    try {
      const lineRows = await resolvePrepareLineRows();
      const slipTargets = await fetchProductWiseSlipTargets(lineRows);
      if (!slipTargets.length) {
        toast.warning('No slips to export');
        return;
      }
      if (mode === 'print') {
        const { printDeliverySlipPdf } = await import('../../utils/deliverySlipPdf.js');
        await printDeliverySlipPdf(slipTargets, 'Prepare Item — Print slips');
        toast.success('Opening product-wise print slips…');
      } else {
        const { downloadDeliverySlipPdf } = await import('../../utils/deliverySlipPdf.js');
        await downloadDeliverySlipPdf(
          `item_to_prepare_slips_${stamp}_product_wise.pdf`,
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
    const filterNote = ` · ${totalCount} booking(s) matching filters${search.trim() ? ` · Search: ${search.trim()}` : ''}`;
    const layoutSuffix = layout === 'salesman-wise' ? '_salesman_wise' : '';

    setExportBusy(true);
    try {
      const exportRows = await resolvePrepareBookingExportRows();
      if (!exportRows.length) {
        toast.warning('No bookings to export');
        return;
      }
      const pdfPayload = {
        layout,
        columns:
          exportDialogAction === 'print'
            ? ITEM_TO_PREPARE_PRINT_COLUMNS
            : ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS,
        rows: exportRows,
        pdfOptions: {
          title: 'Prepare Item',
          rowPageBreak: 'avoid',
          subtitle: `Pickup ${pickupFrom || '—'} to ${pickupTo || '—'}${filterNote}`,
        },
      };
      if (exportDialogAction === 'print') {
        await runItemStageTablePrint(pdfPayload);
      } else {
        await runItemStageTableExport({
          format: 'pdf',
          ...pdfPayload,
          filename: `item_to_prepare_${stamp}${layoutSuffix}.pdf`,
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

  const addressColumn = buildCustomerAddressColumn();

  const allColumns = [
    {
      key: 'actions',
      header: 'Action',
      locked: true,
      width: 48,
      className: 'whitespace-nowrap text-xs align-middle',
      render: (r) => (
        <div
          className="flex justify-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={ClipboardCheck}
            iconOnly
            className="bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
            title="Items checklist"
            aria-label="Items checklist"
            onClick={() => setChecklistOrderId(String(r.id))}
          />
        </div>
      ),
    },
    {
      key: 'order_status',
      locked: true,
      columnPickerLabel: 'Status',
      header: 'Status',
      className: 'text-xs whitespace-nowrap',
      render: (r) => {
        const code = String(r.order_status || 'item_to_collect').trim();
        const label = ORDER_STATUS_LABELS[code] || code || '—';
        return (
          <Badge tone="yellow" className="whitespace-nowrap shrink-0">
            {label}
          </Badge>
        );
      },
    },
    {
      key: 'pending_prepare',
      locked: true,
      columnPickerLabel: 'Pending prepare',
      header: 'Pending',
      align: 'right',
      className: 'text-xs tabular-nums whitespace-nowrap',
      render: (r) => {
        const lines = Number(r.pending_prepare_lines ?? 0);
        const qty = Number(r.pending_prepare_qty ?? 0);
        if (!Number.isFinite(lines) || lines <= 0) return <span className="text-gray-400">—</span>;
        return (
          <span className="text-gray-900" title={`${lines} line(s), ${qty} qty`}>
            {lines} line{lines === 1 ? '' : 's'}
            {Number.isFinite(qty) && qty > 0 ? ` · ${qty} qty` : ''}
          </span>
        );
      },
    },
    {
      key: 'order_number',
      header: 'Booking No.',
      locked: true,
      className: 'text-xs whitespace-nowrap',
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-gray-900">
          <BookingBillLink orderId={r.id}>{r.order_number || '—'}</BookingBillLink>
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
      key: 'rent_total',
      header: 'Rent',
      align: 'right',
      className: 'text-xs tabular-nums',
      render: (r) => {
        const subtotal = Number(r.subtotal ?? 0);
        const discount = Number(r.discount_total ?? 0);
        return formatCurrency(Math.max(0, subtotal - discount));
      },
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

  const { visibleColumns, pickerProps } = useDataTableColumns('items-to-prepare', allColumns, {
    defaultHidden: ITEM_TO_PREPARE_BOOKING_DEFAULT_HIDDEN,
  });

  return (
    <>
      <PageHeader
        title="Prepare Item"
        description="Booked or item-to-collect orders with collected products, plus accessory-only bills, still pending preparation"
      />

      <div className="relative mb-3">
        <label htmlFor={SEARCH_ID} className="sr-only">
          Search
        </label>
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          id={SEARCH_ID}
          type="search"
          className="input w-full pl-9 text-sm py-2"
          placeholder="Search bill, customer, product or accessory…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="card relative z-20 p-2 mb-3 overflow-visible">
        <div className="flex flex-wrap items-start gap-1.5">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5">
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
              <label htmlFor="item-to-prepare-from" className="sr-only">
                Pickup from
              </label>
              <Input
                id="item-to-prepare-from"
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
              <label htmlFor="item-to-prepare-to" className="sr-only">
                Pickup to
              </label>
              <Input
                id="item-to-prepare-to"
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
            <div className="w-36 shrink-0 min-w-0">
              <Select
                label=""
                value={collectStatusFilter}
                onChange={(e) => {
                  setCollectStatusFilter(e.target.value);
                  setPage(1);
                }}
                options={COLLECT_STATUS_FILTER_OPTIONS}
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
      </div>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={isLoading || isFetching}
        rowKey="id"
        onRowClick={(r) => navigate(`/booking/${r.id}`)}
        emptyTitle="No bookings to prepare"
        emptyMessage="No collected-product or accessory-only bookings are pending preparation. Try another search or wider filters."
        visibleCount={rows.length}
        totalCount={data?.meta?.total ?? 0}
        page={data?.meta?.page ?? page}
        totalPages={data?.meta?.total_pages ?? 1}
        countLabel="bookings"
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

      <ItemStageExportLayoutDialog
        isOpen={exportDialogOpen}
        onClose={() => !exportBusy && setExportDialogOpen(false)}
        onConfirm={runTableExport}
        loading={exportBusy}
        action={exportDialogAction}
      />

      <SettlementModal
        isOpen={Boolean(settlementOrderId)}
        orderId={settlementOrderId}
        onClose={() => {
          setSettlementOrderId(null);
          setChecklistOrderId(null);
        }}
      />
      <DeliverySettlementModal
        isOpen={Boolean(deliverySettlementOrderId)}
        orderId={deliverySettlementOrderId}
        stageUpdates={deliveryStageUpdates}
        stageDraftAfter={deliveryStageDraftAfter}
        onClose={() => {
          setDeliverySettlementOrderId(null);
          setDeliveryStageUpdates(null);
          setDeliveryStageDraftAfter(null);
        }}
        onSuccess={() => {
          setDeliverySettlementOrderId(null);
          setDeliveryStageUpdates(null);
          setDeliveryStageDraftAfter(null);
          setChecklistOrderId(null);
          refreshPrepareList();
        }}
      />
      <ReturnSettlementModal
        isOpen={Boolean(returnSettlementOrderId)}
        orderId={returnSettlementOrderId}
        stageUpdates={returnStageUpdates}
        stageDraftAfter={returnStageDraftAfter}
        conditionUpdates={returnConditionUpdates}
        onClose={() => {
          setReturnSettlementOrderId(null);
          setReturnStageUpdates(null);
          setReturnStageDraftAfter(null);
          setReturnConditionUpdates(null);
        }}
        onSuccess={() => {
          setReturnSettlementOrderId(null);
          setReturnStageUpdates(null);
          setReturnStageDraftAfter(null);
          setReturnConditionUpdates(null);
          setChecklistOrderId(null);
          refreshPrepareList();
        }}
      />
      <ItemsChecklistModal
        isOpen={Boolean(checklistOrderId)}
        orderId={checklistOrderId}
        onClose={() => {
          setChecklistOrderId(null);
          refreshPrepareList();
        }}
        onRequireSettlement={(orderId, meta) => {
          if (meta?.settlementKind === 'delivery') {
            setDeliverySettlementOrderId(orderId);
            setDeliveryStageUpdates(meta?.stageUpdates ?? null);
            setDeliveryStageDraftAfter(meta?.stageDraftAfter ?? null);
          } else if (meta?.settlementKind === 'return') {
            setReturnSettlementOrderId(orderId);
            setReturnStageUpdates(meta?.stageUpdates ?? null);
            setReturnStageDraftAfter(meta?.stageDraftAfter ?? null);
            setReturnConditionUpdates(meta?.conditionUpdates ?? null);
          } else {
            setSettlementOrderId(orderId);
          }
        }}
      />
    </>
  );
};

export default ItemToPrepareList;
