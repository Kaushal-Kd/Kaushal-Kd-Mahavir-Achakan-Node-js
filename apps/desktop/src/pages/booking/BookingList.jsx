import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatCurrency,
  formatDate,
  formatOrderTime,
  formatOrderTime12,
  ORDER_STATUS_LABELS,
} from '@wrs/shared';
import { ACTIONS, MODULES, hasPermission } from '@wrs/shared';
import {
  ClipboardCheck,
  Download,
  FileText,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Tags,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

import AdminPasswordModal from '../../components/booking/AdminPasswordModal.jsx';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import NextBookingColumnCell from '../../components/booking/NextBookingColumnCell.jsx';
import BookingDraftActions from '../../components/booking/BookingDraftActions.jsx';
import BookingLogsActionButton from '../../components/booking/BookingLogsActionButton.jsx';
import BookingLogsModal from '../../components/booking/BookingLogsModal.jsx';
import DeleteBookingModal from '../../components/booking/DeleteBookingModal.jsx';
import PrintTokenTypeModal from '../../components/booking/PrintTokenTypeModal.jsx';
import CompactOrderFilters from '../../components/list/CompactOrderFilters.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import {
  buildAccessoryQtyColumn,
  buildCustomerAddressColumn,
  buildPendingAmountColumn,
  buildProductQtyColumn,
} from '../../lib/listOrderColumns.jsx';
import {
  buildBookingDateTimeColumn,
  buildDeliveredReturnedColumns,
} from '../../lib/listTimestampColumns.js';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { authApi } from '../../lib/api/auth.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { ordersApi } from '../../lib/api/orders.js';
import {
  printBookingAccessoryTokens,
  printBookingProductTokens,
} from '../../lib/bookingTokenPrint.js';
import { getRowStageSelectOptions, stageFromOrderStatus } from '../../lib/orderListStage.js';
import { bookingListMobileCard } from '../../lib/listMobileCards.jsx';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';
import { toast } from '../../stores/uiStore.js';
import { downloadBill, printBill } from '../../utils/printBill.js';
import CancelSummaryModal from './CancelSummaryModal.jsx';
import { BookingListNextBookingAlert } from './ChecklistNextBookingAlert.jsx';
import {
  checklistRowWarningClass,
  orderHasNextBookingAlert,
} from './checklistNextBookingAlertUtils.js';
import DeliverySettlementModal from './DeliverySettlementModal.jsx';
import ItemsChecklistModal from './ItemsChecklistModal.jsx';
import ReturnSettlementModal from './ReturnSettlementModal.jsx';
import SettlementModal from './SettlementModal.jsx';
import TransactionsModal from './TransactionsModal.jsx';

const STATUS_TONE = {
  booked: 'yellow',
  pending: 'yellow',
  confirmed: 'brand',
  item_to_collect: 'brand',
  in_preparation: 'brand',
  ready_for_delivery: 'brand',
  delivered: 'green',
  partially_returned: 'yellow',
  returned: 'gray',
  cancelled: 'red',
};
const CHECKLIST_STAGE_OPTIONS = [
  { value: '', label: 'Select stage' },
  { value: 'booked', label: 'Booked' },
  { value: 'item_to_collect', label: 'Item to collect' },
  { value: 'prepared', label: 'In Preparation' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'received', label: 'Received' },
];
const CHECKLIST_CANCEL_OPTION = { value: 'cancel', label: 'Cancel' };
const CANCELLED_ROW_STAGE_OPTION = { value: 'cancelled', label: 'Cancelled' };
const CHECKLIST_STAGE_META = {
  item_to_collect: { label: 'Item to collect', tone: 'brand' },
  prepared: { label: 'In Preparation', tone: 'brand' },
  delivered: { label: 'Delivered', tone: 'green' },
  received: { label: 'Received', tone: 'gray' },
};
const BOOKING_STATUS_OPTIONS = [
  { value: 'booked', label: 'Booked' },
  { value: 'item_to_collect', label: 'Item to collect' },
  { value: 'prepared', label: 'In Preparation' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];
const STATUS_QUERY_MAP = {
  booked: { statuses: 'booked,pending,confirmed,draft' },
  item_to_collect: { status: 'item_to_collect' },
  prepared: { statuses: 'in_preparation,ready_for_delivery' },
  delivered: { status: 'delivered' },
  received: { statuses: 'partially_returned,returned,closed' },
  cancelled: { status: 'cancelled' },
};
const SORT_FIELD_OPTIONS = new Set(['created_at', 'booking_date', 'pickup_date', 'return_date']);

/** Columns hidden until user enables them in the column picker (per shop, persisted). */
const BOOKING_LIST_DEFAULT_HIDDEN = [
  'pickup_number',
  'customer_whatsapp',
  'rent_total',
  'security',
  'pickup_date',
  'return_date',
  'delivery_time',
  'return_time',
];

const BookingList = () => {
  const [searchParams] = useSearchParams();
  const initPage = Number(searchParams.get('page') || 1);
  const initDateField = searchParams.get('date_field') || 'booking_date';
  const initSortBy = searchParams.get('sort_by') || 'created_at';
  const initDateFrom = searchParams.get('from') || '';
  const initDateTo = searchParams.get('to') || '';
  const initStatus = searchParams.get('status') || '';
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [page, setPage] = useState(Number.isFinite(initPage) && initPage > 0 ? initPage : 1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [dateField, setDateField] = useState(
    initDateField === 'pickup_date' ||
      initDateField === 'return_date' ||
      initDateField === 'booking_date'
      ? initDateField
      : 'booking_date'
  );
  const [sortBy, setSortBy] = useState(
    SORT_FIELD_OPTIONS.has(initSortBy) ? initSortBy : 'created_at'
  );
  const [dateFrom, setDateFrom] = useState(initDateFrom);
  const [dateTo, setDateTo] = useState(initDateTo);
  const [status, setStatus] = useState(initStatus);
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
  const [tokenPrintTarget, setTokenPrintTarget] = useState(null);
  const [tokenPrintLoading, setTokenPrintLoading] = useState(false);
  const [editUnlockTarget, setEditUnlockTarget] = useState(null);
  const [editUnlockError, setEditUnlockError] = useState('');
  const [reconcileUnlockTarget, setReconcileUnlockTarget] = useState(null);
  const [reconcileUnlockError, setReconcileUnlockError] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const selectedShopId = useShopStore((s) => s.selectedShopId);
  const selectedShopName = useShopStore(
    (s) => s.shops.find((shop) => shop.id === s.selectedShopId)?.shop_name || ''
  );
  const canDeleteBooking = hasPermission(user, MODULES.BOOKING, ACTIONS.DELETE);
  const canViewLogs = hasPermission(user, MODULES.AUDIT_LOGS, ACTIONS.VIEW);

  useEffect(() => {
    const hasUrlFilters =
      searchParams.has('from') ||
      searchParams.has('to') ||
      searchParams.has('date_field') ||
      searchParams.has('status') ||
      searchParams.has('page') ||
      searchParams.has('sort_by');
    if (!hasUrlFilters) return;

    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const df = searchParams.get('date_field') || 'booking_date';
    const statusRaw = searchParams.get('status') || '';
    const pageRaw = Number(searchParams.get('page') || 1);
    const sortRaw = searchParams.get('sort_by') || 'created_at';

    setDateFrom(from);
    setDateTo(to);
    if (df === 'pickup_date' || df === 'return_date' || df === 'booking_date') {
      setDateField(df);
    }
    setStatus(statusRaw);
    if (Number.isFinite(pageRaw) && pageRaw > 0) setPage(pageRaw);
    if (SORT_FIELD_OPTIONS.has(sortRaw)) setSortBy(sortRaw);
  }, [searchParams]);

  const listParams = useMemo(
    () => ({
      search,
      page,
      per_page: perPage,
      sort: `-${sortBy}`,
      sort_by: sortBy,
      date_field: dateField,
      lean: 1,
      with_next_booking_alerts: 1,
      with_audit_summary: 1,
      ...(dateFrom ? { from: dateFrom } : {}),
      ...(dateTo ? { to: dateTo } : {}),
      ...(status && STATUS_QUERY_MAP[status] ? STATUS_QUERY_MAP[status] : {}),
    }),
    [search, page, perPage, sortBy, dateField, dateFrom, dateTo, status]
  );

  const { data, isFetching, isLoading } = useQuery({
    queryKey: ['orders', listParams],
    queryFn: () => ordersApi.list(listParams),
    placeholderData: keepPreviousData,
  });

  const verifyEditMut = useMutation({
    mutationFn: ({ admin_password }) => authApi.verifyShopAdminPassword({ admin_password }),
  });

  const {
    target: deleteTarget,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDeleteModal,
  } = useAdminDelete({
    deleteFn: (order, admin_password) => ordersApi.remove(order.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Booking deleted');
      await invalidateOrderDomain(queryClient);
    },
  });

  const filtersClear =
    !dateFrom && !dateTo && !status && dateField === 'booking_date' && sortBy === 'created_at';

  const clearFilters = () => {
    setSortBy('created_at');
    setDateField('booking_date');
    setDateFrom('');
    setDateTo('');
    setStatus('');
    setPage(1);
  };

  const closeTokenPrintModal = () => {
    if (!tokenPrintLoading) setTokenPrintTarget(null);
  };

  const runTokenPrint = async (kind) => {
    const orderId = tokenPrintTarget?.id;
    if (!orderId) return;
    setTokenPrintLoading(true);
    try {
      const { data: order } = await ordersApi.get(orderId);
      if (kind === 'product') {
        await printBookingProductTokens(order);
      } else {
        await printBookingAccessoryTokens(order);
      }
      setTokenPrintTarget(null);
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not print token');
    } finally {
      setTokenPrintLoading(false);
    }
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        className: 'text-xs',
        render: (r) => {
          const selectedStage = stageFromOrderStatus(r.status);
          const isCancelled = r.status === 'cancelled';
          const stageClass = isCancelled
            ? 'border-red-300 bg-red-50 text-red-700'
            : selectedStage === 'delivered'
              ? 'border-green-300 bg-green-50 text-green-700'
              : selectedStage === 'received'
                ? 'border-gray-300 bg-gray-50 text-gray-700'
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
                  if (next === 'cancel') {
                    setCancelOrderId(r.id);
                    return;
                  }
                  setChecklistOrderId(r.id);
                }}
              >
                {rowOptions.map((opt) => (
                  <option key={opt.value || '_'} value={opt.value}>
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
        columnPickerLabel: 'Booking No.',
        locked: true,
        className: 'text-xs whitespace-nowrap',
        render: (r) => (
          <span className="inline-flex flex-wrap items-center gap-1 font-mono text-xs text-gray-900">
            <BookingBillLink orderId={r.id}>{r.order_number || '—'}</BookingBillLink>
            {orderHasNextBookingAlert(r) ? (
              <BookingListNextBookingAlert
                alerts={r.next_booking_alerts}
                returnTo="/booking"
                returnLabel="Bookings"
              />
            ) : null}
          </span>
        ),
      },
      {
        key: 'linked_custom_order_number',
        header: 'Custom order no.',
        columnPickerLabel: 'Customised booking no.',
        className: 'text-xs font-mono whitespace-nowrap',
        render: (r) => {
          const linked =
            Array.isArray(r.linked_custom_orders) && r.linked_custom_orders.length
              ? r.linked_custom_orders
              : r.linked_custom_order_id && r.linked_custom_order_number
                ? [{ id: r.linked_custom_order_id, order_number: r.linked_custom_order_number }]
                : [];
          if (!linked.length) return <span className="text-gray-400">—</span>;
          return (
            <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
              {linked.map((co, idx) => (
                <span key={co.id} className="inline-flex items-center gap-x-1">
                  {idx > 0 ? <span className="text-gray-400">,</span> : null}
                  <Link
                    to={`/custom-orders/${co.id}/edit`}
                    state={{ viewOnly: true }}
                    className="text-brand hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {co.order_number || '—'}
                  </Link>
                </span>
              ))}
            </span>
          );
        },
      },
      {
        key: 'nearest_next_booking',
        header: 'next booking',
        columnPickerLabel: 'next booking',
        className: 'text-xs whitespace-nowrap',
        render: (r) => (
          <NextBookingColumnCell
            alerts={r.next_booking_alerts}
            returnTo="/booking"
            returnLabel="Bookings"
          />
        ),
      },
      {
        key: 'pickup_name',
        header: 'Name',
        columnPickerLabel: 'Name',
        locked: true,
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
        columnPickerLabel: 'Rent',
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
        columnPickerLabel: 'Advanced',
        align: 'right',
        className: 'text-xs',
        render: (r) => formatCurrency(r.paid_amount),
      },
      buildPendingAmountColumn(),
      {
        key: 'security',
        header: 'Security',
        columnPickerLabel: 'Security',
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
      buildProductQtyColumn(),
      buildAccessoryQtyColumn(),
      buildBookingDateTimeColumn(),
      {
        key: 'pickup_date',
        header: 'Pickup Date',
        columnPickerLabel: 'Pickup Date',
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
      ...buildDeliveredReturnedColumns(),
      {
        key: 'actions',
        header: 'Action',
        locked: true,
        width: 280,
        className: 'whitespace-nowrap text-xs',
        render: (r) => {
          const cancelled = r.status === 'cancelled';
          const busy = printLoadingId === r.id;
          const tokenBusy = tokenPrintLoading && tokenPrintTarget?.id === r.id;
          return (
            <div
              className="inline-flex items-stretch gap-0 whitespace-nowrap [&>*]:m-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              {cancelled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={RotateCcw}
                  iconOnly
                  className="rounded-none bg-brand-light/60 text-brand hover:bg-brand-light"
                  title="Reconcile cancelled booking"
                  aria-label="Reconcile cancelled booking"
                  onClick={() => {
                    setReconcileUnlockError('');
                    setReconcileUnlockTarget(r);
                  }}
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  iconOnly
                  className="rounded-none bg-brand-light/60 text-brand hover:bg-brand-light"
                  title="Edit"
                  aria-label="Edit booking"
                  onClick={() => {
                    if (r.status === 'delivered') {
                      setEditUnlockError('');
                      setEditUnlockTarget(r);
                      return;
                    }
                    navigate(`/booking/${r.id}/edit`);
                  }}
                />
              )}
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
                onClick={() => setChecklistOrderId(r.id)}
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
                  setPrintLoadingId(r.id);
                  try {
                    const { data } = await ordersApi.get(r.id);
                    await printBill(data);
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
                icon={Tags}
                iconOnly
                className="rounded-none bg-brand-light/50 text-brand hover:bg-brand-light"
                title="Print token"
                aria-label="Print token"
                disabled={cancelled || busy || tokenBusy}
                loading={tokenBusy}
                onClick={() => setTokenPrintTarget(r)}
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
                  setPrintLoadingId(r.id);
                  try {
                    const { data } = await ordersApi.get(r.id);
                    await downloadBill(data);
                    toast.success('Invoice downloaded as PDF');
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
                onClick={() => setTransactionsOrderId(r.id)}
              />
              {canViewLogs ? (
                <BookingLogsActionButton
                  orderId={r.id}
                  editCount={Number(r.audit_edit_count || 0)}
                  onOpenLogs={() =>
                    setLogsTarget({ id: r.id, order_number: r.order_number || r.bill_no })
                  }
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
                onClick={() => setSettlementOrderId(r.id)}
              />
              {canDeleteBooking ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  iconOnly
                  className="rounded-none bg-red-50 text-red-600 hover:bg-red-100"
                  title="Delete booking"
                  aria-label="Delete booking"
                  onClick={() => {
                    if (!selectedShopId) {
                      toast.error('Select a shop first');
                      return;
                    }
                    requestDelete(r);
                  }}
                />
              ) : null}
            </div>
          );
        },
      },
    ],
    [
      navigate,
      printLoadingId,
      tokenPrintLoading,
      tokenPrintTarget,
      canDeleteBooking,
      canViewLogs,
      selectedShopId,
    ]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('bookings', allColumns, {
    defaultHidden: BOOKING_LIST_DEFAULT_HIDDEN,
  });

  return (
    <>
      <PageHeader
        title="Bookings"
        description="All rental and sale orders for the selected shop"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BookingDraftActions mode="navigate" />
            <Button
              icon={Plus}
              onClick={() => navigate('/booking/new', { state: { fresh: Date.now() } })}
            >
              New booking
            </Button>
          </div>
        }
      />

      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          className="flex-1 min-w-[8rem] outline-none text-xs"
          placeholder="Search order #, name, phone, whatsapp…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <TableColumnPicker {...pickerProps} />
      </div>

      <CompactOrderFilters
        variant="booking"
        dateField={dateField}
        onDateFieldChange={(v) => {
          setPage(1);
          setDateField(v);
        }}
        sortBy={sortBy}
        onSortByChange={(v) => {
          setPage(1);
          setSortBy(v);
        }}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={(v) => {
          setPage(1);
          setDateFrom(v);
        }}
        onDateToChange={(v) => {
          setPage(1);
          setDateTo(v);
        }}
        status={status}
        onStatusChange={(v) => {
          setPage(1);
          setStatus(v);
        }}
        statusOptions={BOOKING_STATUS_OPTIONS}
        onClear={clearFilters}
        disabledClear={filtersClear}
      />

      {isFetching && data ? (
        <div className="mb-2 text-right text-xs text-gray-500" role="status">
          Refreshing bookings...
        </div>
      ) : null}

      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        loading={isLoading}
        rowKey="id"
        getRowClassName={(row) => checklistRowWarningClass(orderHasNextBookingAlert(row))}
        onRowClick={(r) => navigate(`/booking/${r.id}`)}
        emptyTitle="No bookings yet"
        emptyMessage="Create your first order to get started."
        mobileCardRender={bookingListMobileCard}
        visibleCount={data?.data?.length ?? 0}
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

      <PrintTokenTypeModal
        isOpen={Boolean(tokenPrintTarget)}
        onClose={closeTokenPrintModal}
        onChooseProduct={() => runTokenPrint('product')}
        onChooseAccessories={() => runTokenPrint('accessory')}
        loading={tokenPrintLoading}
        orderLabel={tokenPrintTarget?.order_number || tokenPrintTarget?.bill_no || ''}
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

      <AdminPasswordModal
        isOpen={Boolean(reconcileUnlockTarget)}
        title="Reconcile cancelled booking"
        description="Verify delivery and return dates and product availability before saving. The booking will return to Booked status with checklist stages reset."
        orderLabel={reconcileUnlockTarget?.bill_no || reconcileUnlockTarget?.order_number || ''}
        shopName={selectedShopName}
        errorMessage={reconcileUnlockError}
        loading={verifyEditMut.isPending}
        confirmLabel="Continue to reconcile"
        onClearError={() => setReconcileUnlockError('')}
        onClose={() => {
          if (!verifyEditMut.isPending) {
            setReconcileUnlockTarget(null);
            setReconcileUnlockError('');
          }
        }}
        onConfirm={async (adminPassword) => {
          if (!reconcileUnlockTarget?.id) return;
          setReconcileUnlockError('');
          try {
            await verifyEditMut.mutateAsync({ admin_password: adminPassword });
            const id = reconcileUnlockTarget.id;
            setReconcileUnlockTarget(null);
            navigate(`/booking/${id}/edit`, {
              state: { reconcileUnlock: true, adminPassword },
            });
          } catch (err) {
            setReconcileUnlockError(getApiErrorMessage(err, 'Could not verify password'));
          }
        }}
      />

      <AdminPasswordModal
        isOpen={Boolean(editUnlockTarget)}
        title="Edit delivered booking"
        description="Editing a delivered booking resets checklist stages only for newly added items after you save. Existing delivered items are unchanged. The booking status may move back until new lines are completed. Payments are kept; balance is recalculated from the new total."
        orderLabel={editUnlockTarget?.bill_no || editUnlockTarget?.order_number || ''}
        shopName={selectedShopName}
        errorMessage={editUnlockError}
        loading={verifyEditMut.isPending}
        confirmLabel="Continue to edit"
        onClearError={() => setEditUnlockError('')}
        onClose={() => {
          if (!verifyEditMut.isPending) {
            setEditUnlockTarget(null);
            setEditUnlockError('');
          }
        }}
        onConfirm={async (adminPassword) => {
          if (!editUnlockTarget?.id) return;
          setEditUnlockError('');
          try {
            await verifyEditMut.mutateAsync({ admin_password: adminPassword });
            const id = editUnlockTarget.id;
            setEditUnlockTarget(null);
            navigate(`/booking/${id}/edit`, {
              state: { deliveredEditUnlock: true, adminPassword },
            });
          } catch (err) {
            setEditUnlockError(getApiErrorMessage(err, 'Could not verify password'));
          }
        }}
      />

      <DeleteBookingModal
        isOpen={Boolean(deleteTarget)}
        orderLabel={deleteTarget?.bill_no || deleteTarget?.order_number || ''}
        shopName={selectedShopName}
        errorMessage={deleteError}
        loading={deleteLoading}
        onClearError={clearDeleteError}
        onClose={closeDeleteModal}
        onConfirm={confirmDelete}
      />
    </>
  );
};

export default BookingList;
