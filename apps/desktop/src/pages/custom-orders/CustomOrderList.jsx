import {
  ACTIONS,
  CUSTOM_ORDER_STATUS_LABELS,
  CUSTOM_ORDER_SELECTABLE_STATUS_VALUES,
  formatDate,
  formatBookingDateTime,
  MODULES,
  hasPermission,
  getCustomOrderTrialReminderEntry,
  normalizeCustomOrderRetrials,
  toLocalISODate,
} from '@wrs/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  BookPlus,
  CalendarPlus,
  Edit2,
  Eye,
  FilterX,
  History,
  Package,
  Plus,
  Printer,
  Scissors,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CustomOrderDraftActions from '../../components/custom-orders/CustomOrderDraftActions.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import DatePicker from '../../components/ui/DatePicker.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import CustomOrderRetrialsCell from './CustomOrderRetrialsCell.jsx';
import CustomOrderTrialLogsModal from './CustomOrderTrialLogsModal.jsx';
import CustomOrderProductVerifyModal from './CustomOrderProductVerifyModal.jsx';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { customOrderFieldsApi } from '../../lib/api/customOrderFields.js';
import { customOrdersApi } from '../../lib/api/customOrders.js';
import { useCustomOrdersList, useCustomOrderMutations } from '../../hooks/api/useCustomOrders.js';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import {
  buildMeasurementsSummary,
  shouldOfferBookingAfterComplete,
  startCustomOrderBookingHandoff,
} from '../../lib/customOrderBookingHandoff.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { invalidateCustomOrdersDomain } from '../../lib/queryInvalidation.js';
import { splitColumnGroups } from '../../lib/tableColumnPreferences.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { printCustomOrderBill } from '../../utils/printBill.js';
import { useAuthStore } from '../../stores/authStore.js';
import { toast } from '../../stores/uiStore.js';

const STATUS_TONE = {
  draft: 'gray',
  in_progress: 'brand',
  with_tailor: 'yellow',
  trial: 'brand',
  retrial: 'yellow',
  completed: 'green',
  cancelled: 'red',
};

const STATUS_SELECT_CLASS = {
  draft: 'border-gray-300 bg-gray-50 text-gray-700',
  in_progress: 'border-brand/40 bg-brand-light/40 text-brand',
  with_tailor: 'border-yellow-300 bg-yellow-50 text-yellow-800',
  trial: 'border-brand/40 bg-brand-light text-brand',
  retrial: 'border-yellow-400 bg-yellow-50 text-yellow-900',
  completed: 'border-green-300 bg-green-50 text-green-700',
  cancelled: 'border-red-300 bg-red-50 text-red-700',
};

const statusFilterOptions = [
  { value: '', label: 'All statuses' },
  ...CUSTOM_ORDER_SELECTABLE_STATUS_VALUES.map((v) => ({
    value: v,
    label: CUSTOM_ORDER_STATUS_LABELS[v] || v,
  })),
];

const statusChangeOptions = CUSTOM_ORDER_SELECTABLE_STATUS_VALUES.map((v) => ({
  value: v,
  label: CUSTOM_ORDER_STATUS_LABELS[v] || v,
}));

const emptyRetrialForm = () => ({
  date: toLocalISODate(new Date()),
  notes: '',
});

const emptyTailorForm = () => ({
  tailor_name: '',
  tailor_date: toLocalISODate(new Date()),
});

const emptyTrialForm = () => ({
  date: toLocalISODate(new Date()),
});

function tailorFormFromRow(row) {
  return {
    tailor_name: row?.tailor_name || '',
    tailor_date: row?.tailor_date || toLocalISODate(new Date()),
  };
}

function trialFormFromRow(row) {
  return {
    date: row?.trial_date || toLocalISODate(new Date()),
  };
}

const yn = (v) => (v ? 'Yes' : 'No');

function textCell(value, maxW = 'max-w-[9rem]') {
  const s = value != null && String(value).trim() ? String(value).trim() : null;
  if (!s) return '—';
  return (
    <span className={`block truncate text-xs ${maxW}`} title={s}>
      {s}
    </span>
  );
}

function imageCountCell(images) {
  const n = Array.isArray(images) ? images.length : 0;
  return n ? String(n) : '—';
}

/** Trial column: first trial date, or latest re-trial date when any exist. */
function formatTrialColumnDate(row) {
  const entry = getCustomOrderTrialReminderEntry(row);
  if (!entry?.date) return '—';
  return formatDate(entry.date);
}

const filterSelectClass =
  'border border-gray-200 rounded px-2 h-8 bg-white text-xs min-w-0';
const filterStatusClass = `${filterSelectClass} w-[7.5rem] shrink-0`;
const filterDateFieldClass = `${filterSelectClass} w-[5.75rem] shrink-0`;
const filterDateInputClass = 'h-8 text-xs px-2 py-1';
const filterDatePickerWrapClass = 'w-[7.25rem] shrink-0';

const dateFieldOptions = [
  { value: 'order', label: 'Order' },
  { value: 'delivery', label: 'Delivery' },
];

/** Middle columns shown on first load; all others are hidden until enabled in Columns picker. */
const CUSTOM_ORDER_LIST_DEFAULT_VISIBLE = new Set([
  'order_number',
  'customer_name',
  'order_date',
  'marriage_date',
  'linked_bill_no',
  'status',
]);

const CUSTOM_ORDER_LIST_PREFS_REVISION = 6;

const CustomOrderList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const user = useAuthStore((s) => s.user);
  const canCreate = hasPermission(user, MODULES.CUSTOM_ORDERS, ACTIONS.CREATE);
  const canView = hasPermission(user, MODULES.CUSTOM_ORDERS, ACTIONS.VIEW);
  const canEdit = hasPermission(user, MODULES.CUSTOM_ORDERS, ACTIONS.EDIT);
  const canDelete = hasPermission(user, MODULES.CUSTOM_ORDERS, ACTIONS.DELETE);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [dateField, setDateField] = useState('order');
  const [orderFrom, setOrderFrom] = useState('');
  const [orderTo, setOrderTo] = useState('');
  const [deliveryFrom, setDeliveryFrom] = useState('');
  const [deliveryTo, setDeliveryTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [retrialTarget, setRetrialTarget] = useState(null);
  const [retrialForm, setRetrialForm] = useState(emptyRetrialForm);
  const [trialTarget, setTrialTarget] = useState(null);
  const [trialForm, setTrialForm] = useState(emptyTrialForm);
  const [tailorTarget, setTailorTarget] = useState(null);
  const [tailorForm, setTailorForm] = useState(emptyTailorForm);
  const [bookingPromptOrder, setBookingPromptOrder] = useState(null);
  const [productVerifyOrder, setProductVerifyOrder] = useState(null);
  const [productVerifyWasAlreadyCompleted, setProductVerifyWasAlreadyCompleted] = useState(false);
  const [trialLogsOrder, setTrialLogsOrder] = useState(null);
  const [printLoadingId, setPrintLoadingId] = useState(null);

  const listParams = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: status || undefined,
      order_date_from: orderFrom || undefined,
      order_date_to: orderTo || undefined,
      delivery_date_from: deliveryFrom || undefined,
      delivery_date_to: deliveryTo || undefined,
      page,
      per_page: perPage,
    }),
    [search, status, orderFrom, orderTo, deliveryFrom, deliveryTo, page, perPage]
  );

  const { data, isLoading } = useCustomOrdersList(listParams);
  const { updateMut } = useCustomOrderMutations();

  const cancelDelete = useAdminDelete({
    deleteFn: (row, admin_password) => customOrdersApi.cancel(row.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Order cancelled');
      await invalidateCustomOrdersDomain(queryClient);
    },
  });

  const { data: fieldsData } = useQuery({
    queryKey: ['custom-order-fields'],
    queryFn: () => customOrderFieldsApi.list(),
  });

  const { data: categoriesRes } = useQuery({
    queryKey: ['categories', 'product', 'custom-order-list'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const { data: tailorsRes, isLoading: tailorsLoading } = useQuery({
    queryKey: ['configurations', 'tailors'],
    queryFn: () => configurationsApi.get('tailors'),
  });

  const tailors = tailorsRes?.data?.items || [];

  const fieldDefs = useMemo(() => {
    const arr = fieldsData?.data || [];
    return [...arr]
      .filter((d) => d.is_active !== false)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [fieldsData]);

  const categoryNameById = useMemo(() => {
    const map = new Map();
    for (const c of categoriesRes?.data || []) {
      if (c?.id) map.set(c.id, c.name || '');
    }
    return map;
  }, [categoriesRes]);

  const openRetrialModal = (row) => {
    setRetrialTarget(row);
    setRetrialForm(emptyRetrialForm());
  };

  const openTrialModal = (row) => {
    setTrialTarget(row);
    setTrialForm(trialFormFromRow(row));
  };

  const openProductVerifyModal = (row) => {
    if (!row?.id || row.linked_product_id) return;
    setProductVerifyWasAlreadyCompleted(false);
    setProductVerifyOrder(row);
  };

  const openTailorModal = (row) => {
    setTailorTarget(row);
    setTailorForm(tailorFormFromRow(row));
  };

  const startBookingFromRow = (row) => {
    if (!row?.linked_product_id) {
      toast.warning('Create a product for this order first');
      return;
    }
    if (row.linked_order_id) {
      toast.info('Already linked to a booking');
      return;
    }
    startCustomOrderBookingHandoff(row, navigate, { fieldDefs });
  };

  const dismissBookingPrompt = () => setBookingPromptOrder(null);

  const confirmBookingPrompt = () => {
    if (!bookingPromptOrder) return;
    const summary = buildMeasurementsSummary(bookingPromptOrder, fieldDefs);
    startCustomOrderBookingHandoff(bookingPromptOrder, navigate, { measurementsSummary: summary });
    setBookingPromptOrder(null);
  };

  const handleStatusChange = useCallback(
    (row, nextStatus) => {
      if (!canEdit || row.status === 'cancelled' || !nextStatus || nextStatus === row.status) return;
      if (nextStatus === 'with_tailor') {
        openTailorModal(row);
        return;
      }
      if (nextStatus === 'trial') {
        openTrialModal(row);
        return;
      }
      if (nextStatus === 'retrial') {
        openRetrialModal(row);
        return;
      }
      const wasAlreadyCompleted = row.status === 'completed';
      setStatusUpdatingId(row.id);
      updateMut.mutate(
        { id: row.id, body: { status: nextStatus } },
        {
          onSuccess: (data) => {
            toast.success('Status updated');
            if (shouldOfferBookingAfterComplete(data, wasAlreadyCompleted)) {
              setBookingPromptOrder(data);
            }
          },
          onError: (e) =>
            toast.error(e.response?.data?.error?.message || e?.message || 'Could not update status'),
          onSettled: () => setStatusUpdatingId(null),
        }
      );
    },
    [canEdit, updateMut]
  );

  const handleProductVerifyCreated = (order) => {
    setProductVerifyOrder(null);
    if (shouldOfferBookingAfterComplete(order, productVerifyWasAlreadyCompleted)) {
      setBookingPromptOrder(order);
    }
  };

  const saveRetrial = () => {
    if (!retrialTarget) return;
    if (!retrialForm.date?.trim()) {
      toast.warning('Re-trial date is required');
      return;
    }
    const existing = Array.isArray(retrialTarget.retrials) ? [...retrialTarget.retrials] : [];
    const next = normalizeCustomOrderRetrials([
      ...existing,
      {
        date: retrialForm.date,
        notes: retrialForm.notes?.trim() || null,
      },
    ]);
    updateMut.mutate(
      { id: retrialTarget.id, body: { retrials: next, status: 'retrial' } },
      {
        onSuccess: () => {
          toast.success('Re-trial saved');
          setRetrialTarget(null);
        },
        onError: (e) =>
          toast.error(e.response?.data?.error?.message || e?.message || 'Could not add re-trial'),
      }
    );
  };

  const saveTrial = () => {
    if (!trialTarget) return;
    if (!trialForm.date?.trim()) {
      toast.warning('Trial date is required');
      return;
    }
    updateMut.mutate(
      {
        id: trialTarget.id,
        body: {
          trial_date: trialForm.date,
          status: 'trial',
        },
      },
      {
        onSuccess: () => {
          toast.success('Trial date saved');
          setTrialTarget(null);
        },
        onError: (e) =>
          toast.error(e.response?.data?.error?.message || e?.message || 'Could not save trial'),
      }
    );
  };

  const saveGiveToTailor = () => {
    if (!tailorTarget) return;
    const name = tailorForm.tailor_name?.trim();
    const date = tailorForm.tailor_date?.trim();
    if (!name) {
      toast.warning('Select a tailor');
      return;
    }
    if (!date) {
      toast.warning('Tailor date is required');
      return;
    }
    updateMut.mutate(
      {
        id: tailorTarget.id,
        body: {
          given_to_tailor: true,
          tailor_name: name,
          tailor_date: date,
          status: 'with_tailor',
        },
      },
      {
        onSuccess: () => {
          toast.success('Given to tailor');
          setTailorTarget(null);
        },
        onError: (e) =>
          toast.error(e.response?.data?.error?.message || e?.message || 'Could not update tailor'),
      }
    );
  };

  const filtersClear =
    !search.trim() && !status && !orderFrom && !orderTo && !deliveryFrom && !deliveryTo;

  const clearAllFilters = () => {
    setSearch('');
    setStatus('');
    setOrderFrom('');
    setOrderTo('');
    setDeliveryFrom('');
    setDeliveryTo('');
    setPage(1);
  };

  const resetPage = () => setPage(1);

  const measurementColumns = useMemo(
    () =>
      fieldDefs.map((def) => ({
        key: `meas_${def.id}`,
        header: def.label,
        columnPickerLabel: def.label,
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => {
          const m = r.measurements && typeof r.measurements === 'object' ? r.measurements : {};
          const v = m[def.id];
          if (v == null || !String(v).trim()) return '—';
          const unit = def.unit ? ` ${def.unit}` : '';
          return `${String(v).trim()}${unit}`;
        },
      })),
    [fieldDefs]
  );

  const allColumns = useMemo(
    () => [
      {
        key: 'order_number',
        header: 'Order no.',
        columnPickerLabel: 'Order no.',
        locked: true,
        className: 'font-mono text-xs whitespace-nowrap',
        render: (r) => (
          <span className="font-semibold text-gray-900">{r.order_number || '—'}</span>
        ),
      },
      {
        key: 'customer_name',
        header: 'Customer',
        columnPickerLabel: 'Customer',
        render: (r) => <span className="font-medium">{r.customer_name || '—'}</span>,
      },
      {
        key: 'customer_phone',
        header: 'Phone',
        columnPickerLabel: 'Contact No.1',
        className: 'text-xs font-mono',
        render: (r) => r.customer_phone || '—',
      },
      {
        key: 'customer_phone2',
        header: 'Phone 2',
        columnPickerLabel: 'Contact No.2',
        className: 'text-xs font-mono',
        render: (r) => r.customer_phone2 || '—',
      },
      {
        key: 'customer_phone2_name',
        header: 'Contact 2 name',
        columnPickerLabel: 'Contact No.2 name',
        className: 'text-xs',
        render: (r) => textCell(r.customer_phone2_name),
      },
      {
        key: 'customer_whatsapp',
        header: 'WhatsApp',
        columnPickerLabel: 'WhatsApp',
        className: 'text-xs font-mono',
        render: (r) => r.customer_whatsapp || '—',
      },
      {
        key: 'customer_address',
        header: 'Address',
        columnPickerLabel: 'Address',
        className: 'text-xs',
        render: (r) => textCell(r.customer_address, 'max-w-[12rem]'),
      },
      {
        key: 'order_date',
        header: 'Date of order',
        columnPickerLabel: 'Date of order',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => {
          if (!r.order_date) return '—';
          const label = formatBookingDateTime(r.order_date, r.order_time);
          return label || formatDate(r.order_date) || '—';
        },
      },
      {
        key: 'marriage_date',
        header: 'Marriage date',
        columnPickerLabel: 'Marriage date',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => (r.marriage_date ? formatDate(r.marriage_date) : '—'),
      },
      {
        key: 'delivery_date',
        header: 'Delivery',
        columnPickerLabel: 'Delivery date',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => (r.delivery_date ? formatDate(r.delivery_date) : '—'),
      },
      {
        key: 'return_date',
        header: 'Return',
        columnPickerLabel: 'Return date',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => (r.return_date ? formatDate(r.return_date) : '—'),
      },
      {
        key: 'design_name',
        header: 'Design',
        columnPickerLabel: 'Design name',
        className: 'text-xs',
        render: (r) => textCell(r.design_name),
      },
      {
        key: 'category_name',
        header: 'Category',
        columnPickerLabel: 'Category',
        className: 'text-xs',
        render: (r) => textCell(r.category_id ? categoryNameById.get(r.category_id) : null),
      },
      {
        key: 'product_name',
        header: 'Product',
        columnPickerLabel: 'Product name',
        className: 'text-xs',
        render: (r) => textCell(r.product_name || r.design_name),
      },
      {
        key: 'color',
        header: 'Color',
        columnPickerLabel: 'Color',
        className: 'text-xs',
        render: (r) => textCell(r.color),
      },
      {
        key: 'size',
        header: 'Size',
        columnPickerLabel: 'Size',
        className: 'text-xs',
        render: (r) => textCell(r.size),
      },
      {
        key: 'remarks',
        header: 'Remarks',
        columnPickerLabel: 'Remarks',
        className: 'text-xs',
        render: (r) => textCell(r.remarks, 'max-w-[12rem]'),
      },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        className: 'text-xs',
        render: (r) => {
          const isCancelled = r.status === 'cancelled';
          const statusClass =
            STATUS_SELECT_CLASS[r.status] || 'border-gray-300 bg-gray-50 text-gray-700';
          if (!canEdit || isCancelled || r.status === 'draft') {
            return (
              <Badge tone={STATUS_TONE[r.status] || 'gray'} className="whitespace-nowrap">
                {CUSTOM_ORDER_STATUS_LABELS[r.status] || r.status}
              </Badge>
            );
          }
          return (
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <select
                className={`rounded border px-1 py-0.5 h-7 text-[11px] min-w-[6.5rem] max-w-[9.5rem] ${statusClass}`}
                value={r.status || 'in_progress'}
                disabled={statusUpdatingId === r.id && updateMut.isPending}
                onChange={(e) => handleStatusChange(r, e.target.value)}
                aria-label={`Status for order ${r.order_number || r.id}`}
              >
                {statusChangeOptions.map((opt) => (
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
        key: 'given_to_tailor',
        header: 'To tailor',
        columnPickerLabel: 'Given to tailor',
        className: 'text-xs',
        render: (r) => yn(r.given_to_tailor),
      },
      {
        key: 'tailor_name',
        header: 'Tailor',
        columnPickerLabel: 'Tailor name',
        className: 'text-xs',
        render: (r) => textCell(r.tailor_name),
      },
      {
        key: 'tailor_date',
        header: 'Tailor date',
        columnPickerLabel: 'Tailor date',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => (r.tailor_date ? formatDate(r.tailor_date) : '—'),
      },
      {
        key: 'trial_date',
        header: 'Trial',
        columnPickerLabel: 'Trial date',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => formatTrialColumnDate(r),
      },
      {
        key: 'retrials',
        header: 'Re-trials',
        columnPickerLabel: 'Re-trials',
        className: 'text-xs',
        render: (r) => (
          <CustomOrderRetrialsCell retrials={r.retrials} orderNumber={r.order_number} />
        ),
      },
      {
        key: 'design_images',
        header: 'Design imgs',
        columnPickerLabel: 'Design images',
        className: 'text-xs tabular-nums',
        render: (r) => imageCountCell(r.design_images),
      },
      {
        key: 'trial_images',
        header: 'Trial imgs',
        columnPickerLabel: 'Trial images',
        className: 'text-xs tabular-nums',
        render: (r) => imageCountCell(r.trial_images),
      },
      {
        key: 'generated_product_code',
        header: 'Product code',
        columnPickerLabel: 'Product code',
        className: 'text-xs font-mono whitespace-nowrap',
        render: (r) => r.generated_product_code || '—',
      },
      {
        key: 'linked_bill_no',
        header: 'Booking',
        columnPickerLabel: 'Booking no.',
        className: 'text-xs font-mono whitespace-nowrap',
        render: (r) => {
          if (r.linked_order_id) {
            return (
              <BookingBillLink
                orderId={r.linked_order_id}
                returnTo="/custom-orders"
                returnLabel="Custom orders"
              >
                {r.linked_bill_no || 'Open booking'}
              </BookingBillLink>
            );
          }
          if (
            canEdit &&
            r.linked_product_id &&
            !r.linked_order_id
          ) {
            return (
              <button
                type="button"
                className="text-brand hover:underline text-[11px] font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  startBookingFromRow(r);
                }}
              >
                Create booking
              </button>
            );
          }
          return '—';
        },
      },
      ...measurementColumns,
      {
        key: 'created_at',
        header: 'Created',
        columnPickerLabel: 'Created',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => (r.created_at ? formatDate(r.created_at) : '—'),
      },
      {
        key: 'updated_at',
        header: 'Updated',
        columnPickerLabel: 'Updated',
        className: 'text-xs tabular-nums whitespace-nowrap',
        render: (r) => (r.updated_at ? formatDate(r.updated_at) : '—'),
      },
      {
        key: 'actions',
        header: 'Actions',
        columnPickerLabel: 'Actions',
        locked: true,
        align: 'right',
        width: 376,
        className: 'whitespace-nowrap text-xs',
        render: (r) => {
          const cancelled = r.status === 'cancelled';
          const printBusy = printLoadingId === r.id;
          return (
            <div
              className="inline-flex items-stretch gap-0 whitespace-nowrap [&>*]:m-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              {canView ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Eye}
                  iconOnly
                  className="rounded-none bg-gray-50 text-gray-700 hover:bg-gray-100"
                  title="View"
                  aria-label="View order"
                  onClick={() =>
                    navigate(`/custom-orders/${r.id}/edit`, { state: { viewOnly: true } })
                  }
                />
              ) : null}
              {canView ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Printer}
                  iconOnly
                  className="rounded-none bg-green-50 text-green-700 hover:bg-green-100"
                  title="Print bill"
                  aria-label="Print bill"
                  loading={printBusy}
                  disabled={printBusy}
                  onClick={async () => {
                    setPrintLoadingId(r.id);
                    try {
                      const { data } = await customOrdersApi.get(r.id);
                      await printCustomOrderBill(data, {
                        categoryName: r.category_id
                          ? categoryNameById.get(r.category_id) || ''
                          : '',
                      });
                    } catch (err) {
                      toast.error(
                        err?.response?.data?.message || err?.message || 'Could not print bill'
                      );
                    } finally {
                      setPrintLoadingId(null);
                    }
                  }}
                />
              ) : null}
              {canView ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={History}
                  iconOnly
                  className="rounded-none bg-brand-light/30 text-brand hover:bg-brand-light/60"
                  title="Trial & re-trial log"
                  aria-label="Trial and re-trial log"
                  onClick={() => setTrialLogsOrder(r)}
                />
              ) : null}
              {canEdit && !cancelled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Edit2}
                  iconOnly
                  className="rounded-none bg-brand-light/40 text-brand hover:bg-brand-light"
                  title="Edit"
                  aria-label="Edit order"
                  onClick={() => navigate(`/custom-orders/${r.id}/edit`)}
                />
              ) : null}
              {canEdit &&
              !cancelled &&
              r.linked_product_id &&
              !r.linked_order_id ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={BookPlus}
                  iconOnly
                  className="rounded-none bg-brand-light text-brand hover:bg-brand-light/80"
                  title="Create booking"
                  aria-label="Create booking"
                  onClick={() => startBookingFromRow(r)}
                />
              ) : null}
              {canEdit && !cancelled && r.linked_order_id ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={BookOpen}
                  iconOnly
                  className="rounded-none bg-brand-light text-brand hover:bg-brand-light/80"
                  title="Open booking"
                  aria-label="Open booking"
                  onClick={() => navigate(`/booking/${r.linked_order_id}`)}
                />
              ) : null}
              {canEdit && !cancelled && !r.linked_product_id ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Package}
                  iconOnly
                  className="rounded-none bg-brand-light/40 text-brand hover:bg-brand-light"
                  title="Create product"
                  aria-label="Create product"
                  onClick={() => openProductVerifyModal(r)}
                />
              ) : null}
              {canEdit && !cancelled && !r.given_to_tailor ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Scissors}
                  iconOnly
                  className="rounded-none bg-yellow-50 text-yellow-800 hover:bg-yellow-100"
                  title="Give to tailor"
                  aria-label="Give to tailor"
                  onClick={() => openTailorModal(r)}
                />
              ) : null}
              {canEdit && !cancelled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={CalendarPlus}
                  iconOnly
                  className="rounded-none bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                  title="Add re-trial"
                  aria-label="Add re-trial"
                  onClick={() => openRetrialModal(r)}
                />
              ) : null}
              {canDelete && !cancelled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Trash2}
                  iconOnly
                  className="rounded-none bg-red-50 text-red-600 hover:bg-red-100"
                  title="Cancel order"
                  aria-label="Cancel order"
                  onClick={() => cancelDelete.requestDelete(r)}
                />
              ) : null}
            </div>
          );
        },
      },
    ],
    [
      navigate,
      canView,
      canEdit,
      canDelete,
      cancelDelete.requestDelete,
      handleStatusChange,
      statusUpdatingId,
      updateMut.isPending,
      categoryNameById,
      measurementColumns,
      printLoadingId,
    ]
  );

  const defaultHiddenKeys = useMemo(() => {
    const { middle } = splitColumnGroups(allColumns);
    return middle.map((c) => c.key).filter((k) => !CUSTOM_ORDER_LIST_DEFAULT_VISIBLE.has(k));
  }, [allColumns]);

  const { visibleColumns, pickerProps } = useDataTableColumns('custom-orders', allColumns, {
    defaultHidden: defaultHiddenKeys,
    prefsRevision: CUSTOM_ORDER_LIST_PREFS_REVISION,
  });

  return (
    <>
      <PageHeader
        title="Custom Orders"
        description="Customized product / tailoring orders with measurements and trial tracking"
        actions={
          canCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              <CustomOrderDraftActions mode="navigate" />
              <Button
                icon={Plus}
                onClick={() => navigate('/custom-orders/new', { state: { fresh: Date.now() } })}
              >
                New custom order
              </Button>
            </div>
          ) : null
        }
      />

      <div className="card w-full min-w-0 p-2 mb-2 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 w-full min-w-0">
          <div className="flex items-center gap-1.5 flex-1 min-w-[10rem] max-w-xs">
            <Search size={15} className="text-gray-400 shrink-0" aria-hidden />
            <input
              id="custom-orders-search"
              className="flex-1 min-w-0 outline-none text-xs border border-gray-200 rounded px-2.5 h-8"
              placeholder="Search order, customer, design…"
              value={search}
              onChange={(e) => {
                resetPage();
                setSearch(e.target.value);
              }}
            />
          </div>

          <label className="flex items-center shrink-0">
            <span className="text-gray-500 sr-only">Status</span>
            <select
              className={filterStatusClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
              aria-label="Status"
            >
              {statusFilterOptions.map((o) => (
                <option key={o.value || '_'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1 shrink-0">
            <select
              className={filterDateFieldClass}
              value={dateField}
              onChange={(e) => setDateField(e.target.value)}
              aria-label="Date field"
            >
              {dateFieldOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className={filterDatePickerWrapClass}>
              <DatePicker
                className="w-full min-w-0"
                inputClassName={filterDateInputClass}
                placeholder="From"
                value={dateField === 'order' ? orderFrom : deliveryFrom}
                max={(dateField === 'order' ? orderTo : deliveryTo) || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  resetPage();
                  if (dateField === 'order') {
                    setOrderFrom(next);
                    if (orderTo && next && orderTo < next) setOrderTo('');
                  } else {
                    setDeliveryFrom(next);
                    if (deliveryTo && next && deliveryTo < next) setDeliveryTo('');
                  }
                }}
              />
            </div>
            <span className="text-gray-400 shrink-0 text-xs">–</span>
            <div className={filterDatePickerWrapClass}>
              <DatePicker
                className="w-full min-w-0"
                inputClassName={filterDateInputClass}
                placeholder="To"
                panelAlign="end"
                value={dateField === 'order' ? orderTo : deliveryTo}
                min={(dateField === 'order' ? orderFrom : deliveryFrom) || undefined}
                onChange={(e) => {
                  resetPage();
                  if (dateField === 'order') {
                    setOrderTo(e.target.value);
                  } else {
                    setDeliveryTo(e.target.value);
                  }
                }}
              />
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={FilterX}
            iconOnly
            className="h-8 w-8 shrink-0"
            title="Clear filters"
            aria-label="Clear filters"
            onClick={clearAllFilters}
            disabled={filtersClear}
          />

          <div className="ml-auto shrink-0">
            <TableColumnPicker {...pickerProps} menuAlign="end" />
          </div>
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        loading={isLoading}
        rowKey="id"
        onRowClick={(r) => {
          if (!canView && !canEdit) return;
          navigate(`/custom-orders/${r.id}/edit`, { state: { viewOnly: true } });
        }}
        emptyTitle="No custom orders"
        emptyMessage="Create a customized product order to track measurements and trials."
        visibleCount={data?.data?.length ?? 0}
        totalCount={data?.meta?.total ?? 0}
        page={data?.meta?.page ?? page}
        totalPages={data?.meta?.total_pages ?? 1}
        countLabel="orders"
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
        isOpen={Boolean(bookingPromptOrder)}
        onClose={dismissBookingPrompt}
        onConfirm={confirmBookingPrompt}
        title="Create booking?"
        message={
          bookingPromptOrder ? (
            <>
              Product{' '}
              <span className="font-mono font-medium">
                {bookingPromptOrder.generated_product_code || '—'}
              </span>{' '}
              created for order{' '}
              <span className="font-mono font-medium">{bookingPromptOrder.order_number}</span>.
              Open a new booking with customer and product pre-filled?
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Create booking"
        cancelLabel="Not now"
      />

      <AdminDeleteModal
        isOpen={Boolean(cancelDelete.target)}
        onClose={cancelDelete.close}
        onConfirm={cancelDelete.confirmDelete}
        title="Cancel custom order?"
        description="It will be marked cancelled and kept for records."
        itemLabel={cancelDelete.target?.order_number}
        shopName={selectedShopName}
        errorMessage={cancelDelete.error}
        onClearError={cancelDelete.clearError}
        loading={cancelDelete.loading}
        confirmLabel="Cancel order"
      />

      <Modal
        isOpen={Boolean(retrialTarget)}
        onClose={() => !updateMut.isPending && setRetrialTarget(null)}
        title="Add re-trial"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetrialTarget(null)}
              disabled={updateMut.isPending}
            >
              Close
            </Button>
            <Button type="button" loading={updateMut.isPending} onClick={saveRetrial}>
              Add re-trial
            </Button>
          </>
        }
      >
        {retrialTarget ? (
          <p className="text-xs text-gray-500 mb-3">
            Order <span className="font-mono">{retrialTarget.order_number}</span>
            {Array.isArray(retrialTarget.retrials) && retrialTarget.retrials.length > 0 ? (
              <span className="ml-1">
                · {retrialTarget.retrials.length} existing re-trial
                {retrialTarget.retrials.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3">
          <Input
            label="Date"
            type="date"
            required
            value={retrialForm.date}
            onChange={(e) => setRetrialForm((f) => ({ ...f, date: e.target.value }))}
          />
          <Input
            label="Notes"
            value={retrialForm.notes}
            onChange={(e) => setRetrialForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional"
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(trialTarget)}
        onClose={() => !updateMut.isPending && setTrialTarget(null)}
        title="Set trial date"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTrialTarget(null)}
              disabled={updateMut.isPending}
            >
              Close
            </Button>
            <Button type="button" loading={updateMut.isPending} onClick={saveTrial}>
              Save
            </Button>
          </>
        }
      >
        {trialTarget ? (
          <p className="text-xs text-gray-500 mb-3">
            Order <span className="font-mono">{trialTarget.order_number}</span>
          </p>
        ) : null}
        <Input
          label="Trial date"
          type="date"
          required
          value={trialForm.date}
          onChange={(e) => setTrialForm((f) => ({ ...f, date: e.target.value }))}
        />
      </Modal>

      <Modal
        isOpen={Boolean(tailorTarget)}
        onClose={() => !updateMut.isPending && setTailorTarget(null)}
        title="Give to tailor"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTailorTarget(null)}
              disabled={updateMut.isPending}
            >
              Close
            </Button>
            <Button type="button" loading={updateMut.isPending} onClick={saveGiveToTailor}>
              Save
            </Button>
          </>
        }
      >
        {tailorTarget ? (
          <p className="text-xs text-gray-500 mb-3">
            Order <span className="font-mono">{tailorTarget.order_number}</span>
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3">
          <Select
            label="Tailor"
            required
            value={tailorForm.tailor_name}
            onChange={(e) => setTailorForm((f) => ({ ...f, tailor_name: e.target.value }))}
            options={[
              { value: '', label: tailorsLoading ? 'Loading…' : 'Select tailor' },
              ...tailors.map((t) => ({ value: t, label: t })),
            ]}
            disabled={tailorsLoading}
            hint={
              !tailorsLoading && tailors.length === 0
                ? 'Add tailors under Master → Tailors.'
                : undefined
            }
          />
          <Input
            label="Tailor date"
            type="date"
            required
            value={tailorForm.tailor_date}
            onChange={(e) => setTailorForm((f) => ({ ...f, tailor_date: e.target.value }))}
          />
        </div>
      </Modal>

      <CustomOrderTrialLogsModal
        order={trialLogsOrder}
        isOpen={Boolean(trialLogsOrder)}
        onClose={() => setTrialLogsOrder(null)}
      />

      <CustomOrderProductVerifyModal
        order={productVerifyOrder}
        isOpen={Boolean(productVerifyOrder)}
        onClose={() => setProductVerifyOrder(null)}
        onCreated={handleProductVerifyCreated}
      />
    </>
  );
};

export default CustomOrderList;
