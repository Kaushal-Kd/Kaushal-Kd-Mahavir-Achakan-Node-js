import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACTIONS,
  earliestNextBookingPickupIsoFromAlerts,
  formatCurrency,
  formatDate,
  formatOrderTime,
  formatOrderTime12,
  MODULES,
  hasPermission,
  returnListDefaultStatusesCsv,
  toLocalISODate,
} from '@wrs/shared';
import {
  ClipboardCheck,
  Download,
  FileText,
  Printer,
  ScrollText,
  Search,
  Wallet,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import NextBookingColumnCell from '../../components/booking/NextBookingColumnCell.jsx';
import BookingLogsModal from '../../components/booking/BookingLogsModal.jsx';
import CompactOrderFilters from '../../components/list/CompactOrderFilters.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import {
  useApplyDashboardListDateFilters,
  useDashboardListDateDefaults,
} from '../../hooks/useDashboardListDateDefaults.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import {
  buildAccessoryQtyColumn,
  buildCustomerAddressColumn,
  buildPendingAmountColumn,
  buildProductQtyColumn,
  resolveOrderPendingAmount,
} from '../../lib/listOrderColumns.jsx';
import {
  buildDeliveredReturnedColumns,
  formatTimestampDateTime,
  orderDeliveredAt,
  orderReturnedAt,
} from '../../lib/listTimestampColumns.js';
import { ordersApi } from '../../lib/api/orders.js';
import { getRowStageSelectOptions, stageFromOrderStatus } from '../../lib/orderListStage.js';
import { buildOrdersListSortParam, ORDER_LIST_SORT_FIELDS } from '../../lib/listOrderSort.js';
import {
  fetchAllPages,
  omitPagination,
  runTablePdfExport,
  withExportPdfBusy,
} from '../../lib/reportPdfExport.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import {
  expandOrdersToProductWiseRows,
  filterProductWiseRows,
} from '../../lib/listProductWiseRows.js';
import { isDrillToday, syncDateParam } from '../../lib/orderListDrillDown.js';
import { useAuthStore } from '../../stores/authStore.js';
import { toast } from '../../stores/uiStore.js';
import { downloadBill, printBill } from '../../utils/printBill.js';
import CancelSummaryModal from '../booking/CancelSummaryModal.jsx';
import { BookingListNextBookingAlert } from '../booking/ChecklistNextBookingAlert.jsx';
import {
  checklistRowWarningClass,
  orderHasNextBookingAlert,
} from '../booking/checklistNextBookingAlertUtils.js';
import DeliverySettlementModal from '../booking/DeliverySettlementModal.jsx';
import ItemsChecklistModal from '../booking/ItemsChecklistModal.jsx';
import LineTypeTag from '../booking/LineTypeTag.jsx';
import ReturnSettlementModal from '../booking/ReturnSettlementModal.jsx';
import SettlementModal from '../booking/SettlementModal.jsx';
import TransactionsModal from '../booking/TransactionsModal.jsx';

const CHECKLIST_STAGE_OPTIONS = [
  { value: 'booked', label: 'Booked' },
  { value: 'item_to_collect', label: 'Item to collect' },
  { value: 'prepared', label: 'In Preparation' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'received', label: 'Received' },
];
const CHECKLIST_CANCEL_OPTION = { value: 'cancel', label: 'Cancel' };
const CANCELLED_ROW_STAGE_OPTION = { value: 'cancelled', label: 'Cancelled' };

function stageLabelForExport(status) {
  const stage = stageFromOrderStatus(status);
  if (stage === 'cancelled') return 'Cancelled';
  return CHECKLIST_STAGE_OPTIONS.find((opt) => opt.value === stage)?.label || stage || '';
}

/** Row tint for completed returns without changing chronological order. */
function returnedRowClass(row) {
  if (stageFromOrderStatus(row?.status) !== 'received') return '';
  return 'bg-gray-100 hover:bg-gray-100/80';
}

/** Pending and completed return rows shown together in chronological order. */
const RETURN_LIST_ELIGIBLE_STATUSES = returnListDefaultStatusesCsv();

const RETURN_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending_return', label: 'Pending return' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'received', label: 'Received' },
];
const STATUS_QUERY_MAP = {
  delivered: { status: 'delivered' },
  received: { statuses: 'partially_returned,returned,closed' },
  /** Dashboard pending-return preset — pending plus fully returned. */
  pending_return: { statuses: returnListDefaultStatusesCsv() },
};

const RETURN_STATUS_FILTER_KEYS = new Set(['', 'delivered', 'received', 'pending_return']);

const RETURN_LIST_DEFAULT_HIDDEN = [
  'pickup_number',
  'customer_whatsapp',
  'delivery_time',
  'return_time',
];

const BUCKET_QUERY_KEYS = new Set(['today', 'upcoming', 'overdue']);

const ReturnList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const todayIso = toLocalISODate();
  const drillToday = isDrillToday(searchParams);
  const bucket = BUCKET_QUERY_KEYS.has(searchParams.get('bucket') || '')
    ? searchParams.get('bucket')
    : '';
  const initStatusRaw = searchParams.get('status') || '';
  const initStatus = RETURN_STATUS_FILTER_KEYS.has(initStatusRaw) ? initStatusRaw : '';
  const [returnFrom, setReturnFrom] = useState(() => {
    const from = searchParams.get('from');
    if (from) return from;
    if (bucket === 'today') return todayIso;
    return '';
  });
  const [returnTo, setReturnTo] = useState(() => {
    const to = searchParams.get('to');
    if (to) return to;
    if (bucket === 'today') return todayIso;
    return '';
  });
  const [statusSel, setStatusSel] = useState(initStatus);
  const initSortBy = searchParams.get('sort_by') || 'return_date';
  const [sortBy, setSortBy] = useState(
    ORDER_LIST_SORT_FIELDS.has(initSortBy) ? initSortBy : 'return_date'
  );

  const dashboardDefaults = useDashboardListDateDefaults('pending_return');

  useApplyDashboardListDateFilters({
    preset: 'pending_return',
    setDateFrom: setReturnFrom,
    setDateTo: setReturnTo,
    syncUrl: true,
  });
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [checklistOrderId, setChecklistOrderId] = useState(null);
  const [cancelOrderId, setCancelOrderId] = useState(null);
  const [settlementOrderId, setSettlementOrderId] = useState(null);
  const [deliverySettlementOrderId, setDeliverySettlementOrderId] = useState(null);
  const [deliveryStageUpdates, setDeliveryStageUpdates] = useState(null);
  const [deliveryStageDraftAfter, setDeliveryStageDraftAfter] = useState(null);
  const [returnSettlementOrderId, setReturnSettlementOrderId] = useState(null);
  const [returnStageUpdates, setReturnStageUpdates] = useState(null);
  const [returnStageDraftAfter, setReturnStageDraftAfter] = useState(null);
  const [returnConditionUpdates, setReturnConditionUpdates] = useState(null);
  const [transactionsOrderId, setTransactionsOrderId] = useState(null);
  const [logsTarget, setLogsTarget] = useState(null);
  const [printLoadingId, setPrintLoadingId] = useState(null);
  const [productWise, setProductWise] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canViewLogs = hasPermission(user, MODULES.AUDIT_LOGS, ACTIONS.VIEW);

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        bucket,
        drillToday,
        returnFrom,
        returnTo,
        search,
        statusSel,
        sortBy,
        perPage,
        productWise,
      }),
    [bucket, drillToday, returnFrom, returnTo, search, statusSel, sortBy, perPage, productWise]
  );
  const prevFilterKeyRef = useRef(filterKey);
  const queryPage = prevFilterKeyRef.current !== filterKey ? 1 : page;

  const awaitingDashboardDefaults =
    dashboardDefaults.ready &&
    !dashboardDefaults.skipDefaults &&
    dashboardDefaults.shouldApplyDates &&
    (!returnFrom || !returnTo);

  const listQueryEnabled = dashboardDefaults.ready && !awaitingDashboardDefaults;

  useEffect(() => {
    const hasUrlFilters =
      searchParams.has('from') ||
      searchParams.has('to') ||
      searchParams.has('status') ||
      searchParams.has('drill') ||
      searchParams.has('bucket');
    if (!hasUrlFilters) return;

    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    setReturnFrom(from);
    setReturnTo(to);
    const statusRaw = searchParams.get('status') || '';
    if (RETURN_STATUS_FILTER_KEYS.has(statusRaw)) {
      setStatusSel(statusRaw);
    }
  }, [searchParams]);

  const handleReturnFromChange = (value) => {
    setPage(1);
    setReturnFrom(value);
    setSearchParams(syncDateParam(searchParams, 'from', value), { replace: true });
  };

  const handleReturnToChange = (value) => {
    setPage(1);
    setReturnTo(value);
    setSearchParams(syncDateParam(searchParams, 'to', value), { replace: true });
  };

  const listParams = useMemo(() => {
    const hasExplicitDates = Boolean(returnFrom || returnTo);
    const p = {
      date_field: 'return_date',
      page: queryPage,
      per_page: perPage,
      lean: 1,
      sort: buildOrdersListSortParam(sortBy, 'return_date'),
      sort_by: sortBy,
      ...(search ? { search } : {}),
      ...(!hasExplicitDates && bucket ? { bucket } : {}),
      ...(returnFrom ? { from: returnFrom } : {}),
      ...(returnTo ? { to: returnTo } : {}),
      ...(productWise ? { with_items: 1 } : {}),
    };
    if (statusSel && STATUS_QUERY_MAP[statusSel]) {
      Object.assign(p, STATUS_QUERY_MAP[statusSel]);
    } else if (!drillToday) {
      Object.assign(p, { statuses: RETURN_LIST_ELIGIBLE_STATUSES });
    }
    return p;
  }, [
    bucket,
    drillToday,
    returnFrom,
    returnTo,
    search,
    statusSel,
    queryPage,
    perPage,
    sortBy,
    productWise,
  ]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['return', listParams],
    queryFn: () => ordersApi.list(listParams),
    enabled: listQueryEnabled,
    placeholderData: undefined,
  });

  const sortedRows = useMemo(() => {
    const rows = Array.isArray(data?.data) ? data.data : [];
    if (!productWise) return rows;
    return filterProductWiseRows(expandOrdersToProductWiseRows(rows), search);
  }, [data?.data, productWise, search]);

  const productLineCount = useMemo(() => {
    if (!productWise) return null;
    return sortedRows.length;
  }, [productWise, sortedRows.length]);

  const refineClear = !returnFrom && !returnTo && !statusSel && sortBy === 'return_date';
  const clearRefine = () => {
    setReturnFrom('');
    setReturnTo('');
    setStatusSel('');
    setSortBy('return_date');
    setPage(1);
  };

  const listMeta = data?.meta;

  useLayoutEffect(() => {
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey;
      setPage(1);
    }
  }, [filterKey]);

  const listLoading =
    !listQueryEnabled ||
    isLoading ||
    (productWise && isFetching) ||
    (isFetching && queryPage !== page);

  const allColumns = [
    {
      key: 'status',
      header: 'Status',
      className: 'text-xs',
      render: (r) => {
        const selectedStage = stageFromOrderStatus(r.status);
        const isCancelled = r.status === 'cancelled';
        const stageClass = isCancelled
          ? 'border-red-300 bg-red-50 text-red-700'
          : selectedStage === 'delivered'
            ? 'border-green-300 bg-green-50 text-green-700'
            : selectedStage === 'received'
              ? 'border-sky-500 bg-sky-100 text-sky-900'
              : selectedStage === 'booked'
                ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
                : 'border-brand/40 bg-brand-light/40 text-brand';
        const rowOptions = getRowStageSelectOptions(selectedStage, {
          stageOptions: CHECKLIST_STAGE_OPTIONS,
          cancelOption: CHECKLIST_CANCEL_OPTION,
          cancelledOption: CANCELLED_ROW_STAGE_OPTION,
        });
        return (
          <div className="flex items-center gap-1.5">
            <select
              className={`rounded px-1 py-0.5 h-7 text-[11px] ${stageClass}`}
              value={selectedStage}
              disabled={isCancelled}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) return;
                const orderId = r.order_id || r.id;
                if (next === 'cancel') {
                  setCancelOrderId(orderId);
                  return;
                }
                setChecklistOrderId(orderId);
              }}
            >
              {rowOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      },
    },
    {
      key: 'order_number',
      header: 'Booking No',
      className: 'text-xs whitespace-nowrap',
      render: (r) => (
        <span className="inline-flex items-center gap-1 font-mono text-xs text-gray-900">
          <BookingBillLink orderId={r.order_id || r.id}>{r.order_number || '—'}</BookingBillLink>
          {orderHasNextBookingAlert(r) ? (
            <BookingListNextBookingAlert
              alerts={r.next_booking_alerts}
              returnTo="/return"
              returnLabel="Returns"
            />
          ) : null}
        </span>
      ),
    },
    ...(productWise
      ? [
          {
            key: 'product_image',
            header: '',
            columnPickerLabel: 'Image',
            locked: true,
            width: 52,
            className: 'text-xs',
            render: (r) => (
              <SmartImage
                src={r.product_image}
                alt={r.product_name || 'Product'}
                className="w-10 h-10 rounded border border-gray-200 bg-white object-contain shrink-0"
              />
            ),
          },
          {
            key: 'product_code',
            header: 'Code',
            locked: true,
            className: 'text-xs whitespace-nowrap',
            render: (r) => (
              <span className="font-mono text-xs text-gray-800">{r.product_code || '—'}</span>
            ),
          },
          {
            key: 'product_name',
            header: 'Product',
            columnPickerLabel: 'Product Name',
            locked: true,
            className: 'text-xs',
            render: (r) => <span className="text-xs text-gray-900">{r.product_name || '—'}</span>,
          },
          {
            key: 'product_type',
            header: 'Type',
            locked: true,
            className: 'text-xs whitespace-nowrap',
            render: (r) => <LineTypeTag type={r.product_type} compact />,
          },
          {
            key: 'product_qty',
            header: 'Qty',
            align: 'right',
            className: 'text-xs',
            render: (r) => <span className="tabular-nums">{Number(r.product_qty || 0)}</span>,
          },
        ]
      : []),
    {
      key: 'nearest_next_booking',
      header: 'next booking',
      columnPickerLabel: 'next booking',
      className: 'text-xs whitespace-nowrap',
      render: (r) => (
        <NextBookingColumnCell
          alerts={r.next_booking_alerts}
          returnTo="/return"
          returnLabel="Returns"
        />
      ),
    },
    {
      key: 'pickup_name',
      header: 'Name',
      className: 'text-xs',
      render: (r) => (
        <span className="text-xs text-gray-900">
          {r.customer_name || r.pickup_name || r.reference_name || '—'}
        </span>
      ),
    },
    {
      key: 'pickup_number',
      header: 'Customer No',
      columnPickerLabel: 'Customer No.',
      render: (r) => (
        <span className="font-mono text-xs">{r.customer_phone || r.pickup_number || '—'}</span>
      ),
    },
    buildCustomerAddressColumn(),
    {
      key: 'customer_whatsapp',
      header: 'WhatsApp',
      columnPickerLabel: 'WhatsApp Number',
      render: (r) => <span className="font-mono text-xs">{r.customer_whatsapp || '—'}</span>,
    },
    {
      key: 'rent_total',
      header: 'Rent',
      align: 'right',
      className: 'text-xs',
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
      className: 'text-xs',
      render: (r) => formatCurrency(r.paid_amount),
    },
    buildPendingAmountColumn(),
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
      key: 'return_remark',
      header: 'Return Remark',
      className: 'text-xs',
      render: (r) => {
        const t = String(r.return_remark || '').trim();
        return <span className="text-xs text-gray-700">{t || '—'}</span>;
      },
    },
    buildProductQtyColumn(),
    buildAccessoryQtyColumn(),
    {
      key: 'booking_date',
      header: 'Booking Date',
      className: 'text-xs',
      render: (r) => formatDate(r.booking_date),
    },
    {
      key: 'booking_time',
      header: 'Booking Time',
      columnPickerLabel: 'Booking Time',
      className: 'text-xs whitespace-nowrap',
      render: (r) => formatOrderTime12(r.booking_time),
    },
    {
      key: 'pickup_date',
      header: 'Pickup Date',
      className: 'text-xs',
      render: (r) => formatDate(r.pickup_date),
    },
    {
      key: 'return_date',
      header: 'Return Date',
      columnPickerLabel: 'Return Date',
      className: 'text-xs',
      render: (r) => formatDate(r.return_date),
    },
    {
      key: 'delivery_time',
      header: 'Delivery Time',
      columnPickerLabel: 'Delivery Time',
      className: 'text-xs whitespace-nowrap',
      render: (r) => formatOrderTime(r.delivery_time),
    },
    {
      key: 'return_time',
      header: 'Return Time',
      columnPickerLabel: 'Return Time',
      className: 'text-xs whitespace-nowrap',
      render: (r) => formatOrderTime(r.return_time),
    },
    ...buildDeliveredReturnedColumns().map((col) =>
      col.key === 'returned_datetime'
        ? { ...col, header: 'Received', columnPickerLabel: 'Received date & time' }
        : col
    ),
    {
      key: 'actions',
      header: 'Action',
      locked: true,
      width: 210,
      className: 'whitespace-nowrap text-xs',
      render: (r) => {
        const cancelled = r.status === 'cancelled';
        const orderId = r.order_id || r.id;
        const busy = printLoadingId === orderId;
        const orderLabel = r.order_number || r.bill_no || '';
        return (
          <div
            className="inline-flex items-stretch gap-0 whitespace-nowrap [&>*]:m-0"
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
              className="rounded-none bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
              title="Items checklist"
              aria-label="Items checklist"
              disabled={cancelled}
              onClick={() => setChecklistOrderId(orderId)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Printer}
              iconOnly
              className="rounded-none bg-green-50 text-green-700 hover:bg-green-100"
              title="Print invoice"
              aria-label="Print invoice"
              loading={busy}
              disabled={busy}
              onClick={async () => {
                setPrintLoadingId(orderId);
                try {
                  const { data: order } = await ordersApi.get(orderId);
                  await printBill(order);
                } catch (err) {
                  toast.error(
                    err?.response?.data?.message || err?.message || 'Could not print invoice'
                  );
                } finally {
                  setPrintLoadingId(null);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Download}
              iconOnly
              className="rounded-none bg-gray-100 text-gray-700 hover:bg-gray-200"
              title="Download invoice"
              aria-label="Download invoice"
              loading={busy}
              disabled={busy}
              onClick={async () => {
                setPrintLoadingId(orderId);
                try {
                  const { data: order } = await ordersApi.get(orderId);
                  await downloadBill(order);
                  toast.success('Invoice downloaded');
                } catch (err) {
                  toast.error(
                    err?.response?.data?.message || err?.message || 'Could not download invoice'
                  );
                } finally {
                  setPrintLoadingId(null);
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={FileText}
              iconOnly
              className="rounded-none bg-gray-50 text-gray-700 hover:bg-gray-100"
              title="Transactions"
              aria-label="Transactions"
              onClick={() => setTransactionsOrderId(orderId)}
            />
            {canViewLogs ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={ScrollText}
                iconOnly
                className="rounded-none bg-brand-light/50 text-brand hover:bg-brand-light"
                title="View change logs"
                aria-label="View booking logs"
                onClick={() => setLogsTarget({ id: orderId, order_number: orderLabel })}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Wallet}
              iconOnly
              className="rounded-none bg-red-50 text-red-700 hover:bg-red-100"
              title="Settlement"
              aria-label="Settlement"
              disabled={cancelled}
              onClick={() => setSettlementOrderId(orderId)}
            />
          </div>
        );
      },
    },
  ];

  const { visibleColumns, pickerProps } = useDataTableColumns('returns', allColumns, {
    defaultHidden: RETURN_LIST_DEFAULT_HIDDEN,
  });

  const exportColumns = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.key !== 'actions')
        .map((c) => ({
          key: c.key,
          header: c.columnPickerLabel || String(c.header || c.key),
          get: (r) => {
            if (c.key === 'order_number') return r.order_number || '';
            if (c.key === 'nearest_next_booking') {
              const iso = earliestNextBookingPickupIsoFromAlerts(r.next_booking_alerts);
              return iso ? formatDate(iso) : '';
            }
            if (c.key === 'pickup_name')
              return r.customer_name || r.pickup_name || r.reference_name || '';
            if (c.key === 'pickup_number') return r.customer_phone || r.pickup_number || '';
            if (c.key === 'customer_whatsapp') return r.customer_whatsapp || '';
            if (c.key === 'customer_address') return r.customer_address || '';
            if (c.key === 'rent_total') {
              const subtotal = Number(r.subtotal ?? 0);
              const discount = Number(r.discount_total ?? 0);
              return formatCurrency(Math.max(0, subtotal - discount));
            }
            if (c.key === 'paid_amount') return formatCurrency(r.paid_amount);
            if (c.key === 'balance') return formatCurrency(resolveOrderPendingAmount(r));
            if (c.key === 'security') {
              const expected = Number(r.deposit_amount || 0);
              const isReturned = !!r.deposit_returned;
              const isPaid = !!r.paid_security_amt || !!r.deposit_received;
              if (expected <= 0) return 'No deposit';
              return `${formatCurrency(expected)} (${isReturned ? 'Returned' : isPaid ? 'Paid' : 'Unpaid'})`;
            }
            if (c.key === 'product_qty') {
              const n = Number(r.product_qty ?? 0);
              return Number.isFinite(n) ? n : 0;
            }
            if (c.key === 'accessory_qty') {
              const n = Number(r.accessory_qty ?? 0);
              return Number.isFinite(n) ? n : 0;
            }
            if (c.key === 'booking_date') return r.booking_date ? formatDate(r.booking_date) : '';
            if (c.key === 'booking_time') return formatOrderTime12(r.booking_time);
            if (c.key === 'pickup_date') return r.pickup_date ? formatDate(r.pickup_date) : '';
            if (c.key === 'return_date') return r.return_date ? formatDate(r.return_date) : '';
            if (c.key === 'delivery_time') return formatOrderTime(r.delivery_time);
            if (c.key === 'return_time') return formatOrderTime(r.return_time);
            if (c.key === 'delivered_datetime') return formatTimestampDateTime(orderDeliveredAt(r));
            if (c.key === 'returned_datetime') return formatTimestampDateTime(orderReturnedAt(r));
            if (c.key === 'status') {
              return stageLabelForExport(r.status);
            }
            if (c.key === 'product_image') return '';
            if (c.key === 'product_code') return r.product_code || '';
            if (c.key === 'product_name') return r.product_name || '';
            if (c.key === 'product_type') {
              return String(r.product_type || 'rent').toLowerCase() === 'sell' ? 'Sell' : 'Rent';
            }
            if (c.key === 'product_qty') return Number(r.product_qty || 0);
            return r[c.key] ?? '';
          },
        })),
    [visibleColumns]
  );

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      const fetched = await fetchAllPages(ordersApi.list, omitPagination(listParams));
      const exportRows = productWise
        ? filterProductWiseRows(expandOrdersToProductWiseRows(fetched), search)
        : fetched;
      const stamp = `${returnFrom || 'all'}_${returnTo || 'all'}`;
      const subtitleParts = [`Return ${returnFrom || '—'} to ${returnTo || '—'}`];
      if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
      if (statusSel) {
        const statusLabel = RETURN_STATUS_OPTIONS.find((o) => o.value === statusSel)?.label;
        if (statusLabel) subtitleParts.push(`Status: ${statusLabel}`);
      }
      subtitleParts.push(`${exportRows.length} record(s)${productWise ? ' · Product wise' : ''}`);
      await runTablePdfExport({
        filename: `returns_${stamp}.pdf`,
        title: 'Returns',
        subtitle: subtitleParts.join(' · '),
        columns: exportColumns,
        rows: exportRows,
      });
    });
  };

  return (
    <>
      <PageHeader
        title="Returns"
        description="Delivered bookings due back, shown earliest first. Completed returns use a gray row highlight."
      />

      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          className="flex-1 min-w-[8rem] outline-none text-xs"
          placeholder={
            productWise
              ? 'Search order #, name, phone, product name, code…'
              : 'Search order #, name, phone, whatsapp…'
          }
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <label className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-200 bg-white text-[11px] text-gray-700 cursor-pointer hover:bg-gray-50 select-none">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-brand"
            checked={productWise}
            onChange={(e) => {
              setProductWise(e.target.checked);
              setPage(1);
            }}
          />
          Product wise
        </label>
        <TableColumnPicker {...pickerProps} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={exportPdf}
          disabled={listLoading || exportBusy}
          loading={exportBusy}
        >
          <Download className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
          Export PDF
        </Button>
      </div>

      <CompactOrderFilters
        variant="return"
        sortBy={sortBy}
        onSortByChange={(v) => {
          setSortBy(v);
          setPage(1);
        }}
        dateFrom={returnFrom}
        dateTo={returnTo}
        onDateFromChange={handleReturnFromChange}
        onDateToChange={handleReturnToChange}
        status={statusSel}
        onStatusChange={(v) => {
          setPage(1);
          setStatusSel(v);
        }}
        statusOptions={RETURN_STATUS_OPTIONS}
        onClear={clearRefine}
        disabledClear={refineClear}
      />

      <DataTable
        columns={visibleColumns}
        rows={sortedRows}
        loading={listLoading}
        rowKey="id"
        getRowClassName={(row) =>
          [returnedRowClass(row), checklistRowWarningClass(orderHasNextBookingAlert(row))]
            .filter(Boolean)
            .join(' ')
        }
        onRowClick={(r) => navigate(`/booking/${r.order_id || r.id}`)}
        emptyTitle="Nothing to return"
        emptyMessage="Nothing to return for the selected filters."
        visibleCount={productWise ? productLineCount : sortedRows.length}
        totalCount={productWise ? productLineCount : (listMeta?.total ?? 0)}
        page={listMeta?.page ?? page}
        totalPages={listMeta?.total_pages ?? 1}
        countLabel={productWise ? 'products' : 'returns'}
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        disablePrevious={page <= 1}
        disableNext={page >= (listMeta?.total_pages ?? 1)}
        perPage={perPage}
        onPerPageChange={(n) => {
          setPage(1);
          setPerPage(n);
        }}
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
          setChecklistOrderId(null);
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
        }}
      />
      <ItemsChecklistModal
        isOpen={Boolean(checklistOrderId)}
        orderId={checklistOrderId}
        onClose={() => setChecklistOrderId(null)}
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
      <TransactionsModal
        isOpen={Boolean(transactionsOrderId)}
        orderId={transactionsOrderId}
        onClose={() => setTransactionsOrderId(null)}
      />

      <BookingLogsModal
        isOpen={Boolean(logsTarget)}
        orderId={logsTarget?.id}
        billNo={logsTarget?.order_number}
        onClose={() => setLogsTarget(null)}
      />

      <CancelSummaryModal
        isOpen={Boolean(cancelOrderId)}
        orderId={cancelOrderId}
        onClose={() => setCancelOrderId(null)}
      />
    </>
  );
};

export default ReturnList;
