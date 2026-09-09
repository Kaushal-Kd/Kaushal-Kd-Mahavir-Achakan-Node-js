import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate, formatWallClockDateTime } from '@wrs/shared';
import {
  FilterX,
  History,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import UpcomingPickupDates from '../../components/booking/UpcomingPickupDates.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import LaundryWhatsAppSlipModal from '../../components/laundry/LaundryWhatsAppSlipModal.jsx';
import VendorOutstandingModal from '../../components/laundry/VendorOutstandingModal.jsx';
import DatePicker from '../../components/ui/DatePicker.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useLaundryPrioritySettings } from '../../hooks/useLaundryPrioritySettings.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { laundryApi } from '../../lib/api/laundry.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { washingQueueApi } from '../../lib/api/washingQueue.js';
import {
  buildLaundrySlipWhatsAppContext,
  resolveVendorContactPhone,
} from '../../lib/laundryVendorWhatsApp.js';
import {
  clearLaundryListRestore,
  readLaundryListRestore,
  writeLaundryListRestore,
} from '../../lib/laundryListRestore.js';
import { toast } from '../../stores/uiStore.js';
import { useShopStore } from '../../stores/shopStore.js';
import {
  filterWashingQueue,
  PRIORITY_TONE,
  QUEUE_SORT_OPTIONS,
  resolveNextBookingLink,
  sortWashingQueue,
} from './laundryQueueUtils.js';
import { formatLaundrySlipDateTime } from './laundrySlipData.js';
import { buildLaundrySlipPdfBase64, printLaundrySlip } from './laundrySlipPrint.js';
import LaundryReturnLogsModal from './LaundryReturnLogsModal.jsx';
import ReturnWashingModal from './ReturnWashingModal.jsx';

const LAUNDRY_LIST_DEFAULT_HIDDEN = [
  'pickup_at',
  'return_at',
  'remarks',
  'product_total',
  'accessory_total',
  'subtotal',
  'discount_mode',
  'discount_value',
  'discount_amount',
  'created_at',
];

const LAUNDRY_RETURN_PATH = '/laundry';

function washingBalance(row) {
  if (row.washing_balance != null) return Number(row.washing_balance);
  return Number(row.payable_amount || 0) - Number(row.paid_to_washing_amount ?? 0);
}

const LaundryJobList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const restoredRef = useRef(readLaundryListRestore());
  const restored = restoredRef.current;
  const { settings: prioritySettings } = useLaundryPrioritySettings();
  const [query, setQuery] = useState(() => restored?.query ?? '');
  const [laundryFrom, setLaundryFrom] = useState(() => restored?.laundryFrom ?? '');
  const [laundryTo, setLaundryTo] = useState(() => restored?.laundryTo ?? '');
  const [returnModalJobId, setReturnModalJobId] = useState(null);
  const [returnLogsModal, setReturnLogsModal] = useState(null);
  const [queueModalOpen, setQueueModalOpen] = useState(() => restored?.queueModalOpen ?? false);
  const [queueSearch, setQueueSearch] = useState(() => restored?.queueSearch ?? '');
  const [queueSort, setQueueSort] = useState(() => restored?.queueSort ?? 'priority');
  const [whatsAppModal, setWhatsAppModal] = useState(null);
  const [whatsAppLoadingId, setWhatsAppLoadingId] = useState(null);
  const [whatsAppSendBusy, setWhatsAppSendBusy] = useState(false);
  const [vendorDueModal, setVendorDueModal] = useState(null);

  useEffect(() => {
    if (restored) clearLaundryListRestore();
  }, [restored]);

  const captureLaundryListRestore = useCallback(
    (extra = {}) => {
      writeLaundryListRestore({
        query,
        laundryFrom,
        laundryTo,
        queueModalOpen: true,
        queueSearch,
        queueSort,
        ...extra,
      });
    },
    [query, laundryFrom, laundryTo, queueSearch, queueSort]
  );

  const { ensureReady: ensureWhatsAppReady, sendWithDocument } = useWhatsAppOutbound();
  const selectedShopName = useSelectedShopName();

  const deleteJob = useAdminDelete({
    deleteFn: (job, admin_password) => laundryApi.remove(job.id, { admin_password }),
    onSuccess: () => {
      toast.success('Laundry job deleted');
      queryClient.invalidateQueries({ queryKey: ['laundry-jobs'] });
    },
  });

  const removeFromQueue = useAdminDelete({
    deleteFn: (item, admin_password) => washingQueueApi.remove(item.id, { admin_password }),
    onSuccess: () => {
      toast.success('Product removed from washing queue — now available');
      queryClient.invalidateQueries({ queryKey: ['washing-queue'] });
    },
  });

  const { data: queueResp, isLoading: queueLoading } = useQuery({
    queryKey: ['washing-queue'],
    queryFn: () => washingQueueApi.list(),
  });
  const queueItems = queueResp?.data || [];
  const filteredQueueItems = useMemo(() => {
    const filtered = filterWashingQueue(queueItems, queueSearch);
    return sortWashingQueue(filtered, queueSort, prioritySettings);
  }, [queueItems, queueSearch, queueSort, prioritySettings]);

  const { data: jobsResp, isLoading } = useQuery({
    queryKey: ['laundry-jobs', query, laundryFrom, laundryTo],
    queryFn: () =>
      laundryApi.list({
        search: query,
        per_page: 200,
        ...(laundryFrom ? { laundry_date_from: laundryFrom } : {}),
        ...(laundryTo ? { laundry_date_to: laundryTo } : {}),
      }),
  });
  const filtered = jobsResp?.data || [];
  const jobsMeta = jobsResp?.meta || {};

  const laundryDateClear = !laundryFrom && !laundryTo;
  const clearLaundryDates = () => {
    setLaundryFrom('');
    setLaundryTo('');
  };

  const handlePrint = async (id) => {
    try {
      const resp = await laundryApi.get(id);
      const job = resp?.data;
      if (!job) {
        toast.error('Laundry job not found');
        return;
      }
      printLaundrySlip(job);
    } catch (e) {
      toast.error(e?.message || 'Failed to load print data');
    }
  };

  const handleWhatsApp = async (id) => {
    setWhatsAppLoadingId(id);
    try {
      const [jobResp, accountsResp, whatsAppState] = await Promise.all([
        laundryApi.get(id),
        paymentAccountsApi.list(),
        ensureWhatsAppReady(),
      ]);
      const job = jobResp?.data;
      if (!job) {
        toast.error('Laundry job not found');
        return;
      }
      const accounts = accountsResp?.data || [];
      const resolved = resolveVendorContactPhone({
        vendorAccountId: job.vendorAccountId,
        vendorName: job.vendorName,
        paymentAccounts: accounts,
      });
      if (!resolved?.phone) {
        toast.warning(
          'Vendor has no valid Contact No. Add it on the vendor payment account in Master → Accounts.'
        );
        return;
      }
      if (!whatsAppState.templateByKey.LAUNDRY_SLIP?.is_active) {
        toast.info('WhatsApp template "Laundry slip to vendor" is inactive in Settings.');
        return;
      }
      if (!whatsAppState.canSend) {
        toast.info('WhatsApp is not connected. Scan QR code in Settings first.');
        return;
      }
      setWhatsAppModal({
        job,
        phone: resolved.phone,
        vendorName: job.vendorName || resolved.account?.name || '',
        jobNo: job.jobNo || '',
      });
    } catch (e) {
      toast.error(e?.message || 'Failed to prepare WhatsApp send');
    } finally {
      setWhatsAppLoadingId(null);
    }
  };

  const handleWhatsAppSend = async () => {
    if (!whatsAppModal?.job || !whatsAppModal.phone) return;
    setWhatsAppSendBusy(true);
    try {
      const pdf = await buildLaundrySlipPdfBase64(whatsAppModal.job);
      if (!pdf?.base64) {
        throw new Error('Could not generate laundry slip PDF');
      }
      const shop = useShopStore.getState().selectedShop;
      await sendWithDocument({
        templateKey: 'LAUNDRY_SLIP',
        phone: whatsAppModal.phone,
        context: buildLaundrySlipWhatsAppContext(
          whatsAppModal.job,
          shop?.name || shop?.company_name
        ),
        document: {
          filename: pdf.filename,
          content_base64: pdf.base64,
          mimetype: 'application/pdf',
        },
      });
      toast.success(`Laundry slip sent to ${whatsAppModal.phone}`);
      setWhatsAppModal(null);
    } catch (e) {
      toast.error(e?.message || 'Failed to send WhatsApp message');
    } finally {
      setWhatsAppSendBusy(false);
    }
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'laundry_date',
        header: 'Laundry date & time',
        columnPickerLabel: 'Laundry date & time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) =>
          (r.laundry_at ? formatWallClockDateTime(r.laundry_at) : formatDate(r.laundry_date)) ||
          '—',
      },
      {
        key: 'job_no',
        header: 'Job No',
        columnPickerLabel: 'Job No',
        render: (r) => (
          <button
            type="button"
            className="font-mono text-brand hover:underline"
            title="View job details"
            onClick={() => navigate(`/laundry/${r.id}`)}
          >
            {r.job_no}
          </button>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        align: 'center',
        render: (r) => (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
              r.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}
          >
            {r.status === 'completed' ? 'Completed' : 'Open'}
          </span>
        ),
      },
      {
        key: 'vendor_name',
        header: 'Vendor',
        columnPickerLabel: 'Vendor',
        render: (r) => r.vendor_name || '—',
      },
      {
        key: 'pickup_by',
        header: 'Pickup By',
        columnPickerLabel: 'Pickup By',
        render: (r) => r.pickup_by || '—',
      },
      {
        key: 'pickup_at',
        header: 'Pickup date & time',
        columnPickerLabel: 'Pickup date & time',
        render: (r) => formatLaundrySlipDateTime(r.pickup_at) || '—',
      },
      {
        key: 'return_at',
        header: 'Return date & time',
        columnPickerLabel: 'Return date & time',
        render: (r) => formatLaundrySlipDateTime(r.return_at) || '—',
      },
      {
        key: 'remarks',
        header: 'Remarks',
        columnPickerLabel: 'Remarks',
        render: (r) => {
          const text = String(r.remarks || '').trim();
          if (!text) return '—';
          const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
          return (
            <span className="max-w-[12rem] inline-block truncate" title={text}>
              {short}
            </span>
          );
        },
      },
      {
        key: 'product_lines',
        header: 'Products',
        columnPickerLabel: 'Products',
        align: 'center',
        render: (r) => Number(r.product_lines || 0),
      },
      {
        key: 'accessory_lines',
        header: 'Accessories',
        columnPickerLabel: 'Accessories',
        align: 'center',
        render: (r) => Number(r.accessory_lines || 0),
      },
      {
        key: 'product_total',
        header: 'Product total',
        columnPickerLabel: 'Product total',
        align: 'right',
        render: (r) => formatCurrency(Number(r.product_total || 0)),
      },
      {
        key: 'accessory_total',
        header: 'Accessory total',
        columnPickerLabel: 'Accessory total',
        align: 'right',
        render: (r) => formatCurrency(Number(r.accessory_total || 0)),
      },
      {
        key: 'subtotal',
        header: 'Subtotal',
        columnPickerLabel: 'Subtotal',
        align: 'right',
        render: (r) => formatCurrency(Number(r.subtotal || 0)),
      },
      {
        key: 'discount_mode',
        header: 'Discount mode',
        columnPickerLabel: 'Discount mode',
        render: (r) => {
          const mode = String(r.discount_mode || '').toLowerCase();
          if (mode === 'percent') return 'Percent';
          if (mode === 'fixed') return 'Fixed';
          return r.discount_mode || '—';
        },
      },
      {
        key: 'discount_value',
        header: 'Discount value',
        columnPickerLabel: 'Discount value',
        align: 'right',
        render: (r) =>
          String(r.discount_mode || '').toLowerCase() === 'percent'
            ? `${Number(r.discount_value || 0)}%`
            : formatCurrency(Number(r.discount_value || 0)),
      },
      {
        key: 'discount_amount',
        header: 'Discount amount',
        columnPickerLabel: 'Discount amount',
        align: 'right',
        render: (r) => formatCurrency(Number(r.discount_amount || 0)),
      },
      {
        key: 'payable_amount',
        header: 'Payable',
        columnPickerLabel: 'Payable',
        align: 'right',
        render: (r) => formatCurrency(Number(r.payable_amount || 0)),
      },
      {
        key: 'paid_to_washing_amount',
        header: 'Paid to washing',
        columnPickerLabel: 'Paid to washing',
        align: 'right',
        render: (r) => formatCurrency(Number(r.paid_to_washing_amount ?? 0)),
      },
      {
        key: 'washing_balance',
        header: 'Remaining',
        columnPickerLabel: 'Remaining',
        align: 'right',
        render: (r) => formatCurrency(washingBalance(r)),
      },
      {
        key: 'vendor_outstanding_total',
        header: 'Vendor total due',
        columnPickerLabel: 'Vendor total due',
        align: 'right',
        render: (r) => {
          if (r.vendor_outstanding_total == null) return '—';
          return (
            <button
              type="button"
              className="tabular-nums text-brand hover:underline font-medium"
              onClick={() =>
                setVendorDueModal({
                  jobId: r.id,
                  jobNo: r.job_no,
                  vendorName: r.vendor_name,
                })
              }
            >
              {formatCurrency(Number(r.vendor_outstanding_total))}
            </button>
          );
        },
      },
      {
        key: 'created_at',
        header: 'Created at',
        columnPickerLabel: 'Created at',
        render: (r) => formatLaundrySlipDateTime(r.created_at) || formatDate(r.created_at) || '—',
      },
      {
        key: 'actions',
        header: 'Action',
        locked: true,
        align: 'center',
        render: (r) => (
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-green-700 hover:underline"
              onClick={() => setReturnModalJobId(r.id)}
            >
              <RotateCcw size={13} />
              Return
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-gray-700 hover:underline"
              onClick={() => setReturnLogsModal({ jobId: r.id, jobNo: r.job_no })}
            >
              <History size={13} />
              Logs
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-brand hover:underline"
              onClick={() => navigate(`/laundry/new?jobId=${r.id}`)}
            >
              <Pencil size={13} />
              Edit
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-red-600 hover:underline"
              onClick={() => deleteJob.requestDelete({ id: r.id, job_no: r.job_no })}
            >
              <Trash2 size={13} />
              Delete
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-green-700 hover:underline disabled:opacity-50"
              disabled={whatsAppLoadingId === r.id || whatsAppSendBusy}
              onClick={() => handleWhatsApp(r.id)}
            >
              <MessageCircle size={13} />
              WhatsApp
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-gray-700 hover:underline"
              onClick={() => handlePrint(r.id)}
            >
              <Printer size={13} />
              Print
            </button>
            {r.vendor_outstanding_total != null ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-brand hover:underline"
                onClick={() =>
                  setVendorDueModal({
                    jobId: r.id,
                    jobNo: r.job_no,
                    vendorName: r.vendor_name,
                  })
                }
              >
                Vendor due
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [
      navigate,
      deleteJob.requestDelete,
      whatsAppLoadingId,
      whatsAppSendBusy,
      handlePrint,
      handleWhatsApp,
      setVendorDueModal,
    ]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('laundry-jobs', allColumns, {
    defaultHidden: LAUNDRY_LIST_DEFAULT_HIDDEN,
    prefsRevision: 1,
  });

  return (
    <>
      <PageHeader
        title="Laundry Management / Jobs"
        description="Dashboard / Laundry / List"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setQueueSearch('');
                setQueueSort('priority');
                setQueueModalOpen(true);
              }}
            >
              Queue{queueItems.length > 0 ? ` (${queueItems.length})` : ''}
            </Button>
            <Button size="sm" icon={Plus} onClick={() => navigate('/laundry/new')}>
              Create Job
            </Button>
          </div>
        }
      />

      <section className="card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <div className="relative flex-1 min-w-[12rem]">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="input h-7 w-full text-xs pl-7"
              placeholder="Search job no / vendor / pickup by"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="text-gray-500 font-medium shrink-0">Laundry date</span>
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-gray-500">From</span>
            <DatePicker
              className="w-[9.5rem]"
              inputClassName="h-7 text-[11px] px-1 py-0.5"
              value={laundryFrom}
              onChange={(e) => setLaundryFrom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-gray-500">To</span>
            <DatePicker
              className="w-[9.5rem]"
              inputClassName="h-7 text-[11px] px-1 py-0.5"
              value={laundryTo}
              onChange={(e) => setLaundryTo(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={FilterX}
            className="h-7 px-1.5 text-[11px]"
            onClick={clearLaundryDates}
            disabled={laundryDateClear}
          >
            Clear
          </Button>
          <TableColumnPicker {...pickerProps} menuAlign="end" />
        </div>

        <DataTable
          embedded
          columns={visibleColumns}
          rows={filtered}
          loading={isLoading}
          rowKey="id"
          emptyTitle="No laundry jobs found"
          emptyMessage="Create a laundry job to get started."
          visibleCount={filtered.length}
          totalCount={jobsMeta?.total ?? filtered.length}
          countLabel="jobs"
          showCountFooter={filtered.length > 0 || isLoading}
        />
      </section>

      {queueModalOpen ? (
        <Modal
          isOpen={queueModalOpen}
          onClose={() => setQueueModalOpen(false)}
          title="Washing Queue"
          size="xl"
          closeOnBackdrop={false}
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setQueueModalOpen(false)}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setQueueModalOpen(false);
                  navigate('/laundry/new');
                }}
              >
                Create Job
              </Button>
            </div>
          }
        >
          <div className="flex flex-nowrap items-center gap-2 border-b border-gray-200 px-4 py-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                className="input h-8 w-full pl-7 text-xs"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search code / name / order / next booking"
                aria-label="Search washing queue"
              />
            </div>
            <select
              className="input h-8 w-36 shrink-0 bg-surface text-xs"
              value={queueSort}
              onChange={(e) => setQueueSort(e.target.value)}
              aria-label="Sort washing queue"
            >
              {QUEUE_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort by {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-auto px-4 py-2">
              {queueLoading ? (
                <p className="text-xs text-gray-500 py-6 text-center">Loading...</p>
              ) : queueItems.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">No items in washing queue.</p>
              ) : filteredQueueItems.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">
                  No items match your search.
                </p>
              ) : (
                <table className="table w-full text-[11px]">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="text-center">
                        <TableHeaderLabel align="center">Priority</TableHeaderLabel>
                      </th>
                      <th className="text-left">
                        <TableHeaderLabel>Code</TableHeaderLabel>
                      </th>
                      <th className="text-left">
                        <TableHeaderLabel>Name</TableHeaderLabel>
                      </th>
                      <th className="text-left">
                        <TableHeaderLabel>Category</TableHeaderLabel>
                      </th>
                      <th className="text-center">
                        <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                      </th>
                      <th className="text-left">
                        <TableHeaderLabel>From Order</TableHeaderLabel>
                      </th>
                      <th className="text-left">
                        <TableHeaderLabel>Next Booking</TableHeaderLabel>
                      </th>
                      <th className="text-center">
                        <TableHeaderLabel align="center">Next Pickup</TableHeaderLabel>
                      </th>
                      <th className="text-center">
                        <TableHeaderLabel align="center">Days Left</TableHeaderLabel>
                      </th>
                      <th className="text-left">
                        <TableHeaderLabel>Queued At</TableHeaderLabel>
                      </th>
                      <th className="text-center">
                        <TableHeaderLabel align="center" nowrap>
                          Action
                        </TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQueueItems.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100 h-8 last:border-b-0">
                        <td className="px-2 text-center">
                          <span
                            className={`rounded px-1 py-0.5 ${PRIORITY_TONE[item.priority] || PRIORITY_TONE['No Schedule']}`}
                          >
                            {item.priority}
                          </span>
                        </td>
                        <td className="px-2 font-mono">{item.code || '-'}</td>
                        <td
                          className="px-2"
                          title={`Next Booking: ${item.nextBookingNo || '-'}\nCustomer: ${item.nextCustomerName || '-'}\nPickup: ${item.nextPickupDate || '-'}`}
                        >
                          {item.name || '-'}
                        </td>
                        <td className="px-2">{item.category_label || 'Uncategorized'}</td>
                        <td className="px-2 text-center">{item.qty}</td>
                        <td className="px-2">
                          <BookingBillLink
                            orderId={item.order_id}
                            returnTo={LAUNDRY_RETURN_PATH}
                            returnLabel="Back to laundry"
                            onNavigate={() =>
                              captureLaundryListRestore({ upcomingPopoverQueueItemId: item.id })
                            }
                          >
                            {item.order_number || '-'}
                          </BookingBillLink>
                        </td>
                        <td className="px-2 font-mono">
                          {(() => {
                            const next = resolveNextBookingLink(item);
                            return (
                              <BookingBillLink
                                orderId={next.orderId}
                                returnTo={LAUNDRY_RETURN_PATH}
                                returnLabel="Back to laundry"
                                onNavigate={() =>
                                  captureLaundryListRestore({ upcomingPopoverQueueItemId: item.id })
                                }
                              >
                                {next.label || '-'}
                              </BookingBillLink>
                            );
                          })()}
                        </td>
                        <td className="px-2 text-center">
                          <UpcomingPickupDates
                            bookings={item.upcomingBookings}
                            initialOpen={
                              restored?.upcomingPopoverOpen &&
                              String(restored?.upcomingPopoverQueueItemId) === String(item.id)
                            }
                            returnTo={LAUNDRY_RETURN_PATH}
                            returnLabel="Back to laundry"
                            onBookingNavigate={() =>
                              captureLaundryListRestore({
                                upcomingPopoverQueueItemId: item.id,
                                upcomingPopoverOpen: true,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 text-center">{item.daysLeft ?? '-'}</td>
                        <td className="px-2 whitespace-nowrap tabular-nums">
                          {formatWallClockDateTime(item.queued_at) || '-'}
                        </td>
                        <td className="px-2 text-center">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-red-600 hover:underline disabled:opacity-50"
                            disabled={
                              removeFromQueue.loading && removeFromQueue.target?.id === item.id
                            }
                            onClick={() => removeFromQueue.requestDelete(item)}
                          >
                            <X size={12} />
                            {removeFromQueue.loading && removeFromQueue.target?.id === item.id
                              ? 'Removing...'
                              : 'Remove'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </Modal>
      ) : null}

      {returnModalJobId ? (
        <ReturnWashingModal jobId={returnModalJobId} onClose={() => setReturnModalJobId(null)} />
      ) : null}

      {returnLogsModal?.jobId ? (
        <LaundryReturnLogsModal
          jobId={returnLogsModal.jobId}
          jobNo={returnLogsModal.jobNo}
          onClose={() => setReturnLogsModal(null)}
        />
      ) : null}

      <AdminDeleteModal
        isOpen={Boolean(deleteJob.target)}
        onClose={deleteJob.close}
        onConfirm={deleteJob.confirmDelete}
        title="Delete laundry job?"
        description="This laundry job and its line records will be removed. This cannot be undone."
        itemLabel={deleteJob.target?.job_no}
        shopName={selectedShopName}
        errorMessage={deleteJob.error}
        onClearError={deleteJob.clearError}
        loading={deleteJob.loading}
      />

      <AdminDeleteModal
        isOpen={Boolean(removeFromQueue.target)}
        onClose={removeFromQueue.close}
        onConfirm={removeFromQueue.confirmDelete}
        title="Remove from washing queue?"
        description="The product will be marked available for rent again."
        itemLabel={
          removeFromQueue.target
            ? [removeFromQueue.target.code, removeFromQueue.target.name].filter(Boolean).join(' · ')
            : undefined
        }
        shopName={selectedShopName}
        errorMessage={removeFromQueue.error}
        onClearError={removeFromQueue.clearError}
        loading={removeFromQueue.loading}
        confirmLabel="Remove"
      />

      <LaundryWhatsAppSlipModal
        isOpen={!!whatsAppModal}
        onClose={() => !whatsAppSendBusy && setWhatsAppModal(null)}
        onSend={handleWhatsAppSend}
        vendorName={whatsAppModal?.vendorName}
        jobNo={whatsAppModal?.jobNo}
        phone={whatsAppModal?.phone}
        loading={whatsAppSendBusy}
      />

      {vendorDueModal?.jobId ? (
        <VendorOutstandingModal
          jobId={vendorDueModal.jobId}
          jobNo={vendorDueModal.jobNo}
          vendorName={vendorDueModal.vendorName}
          onClose={() => setVendorDueModal(null)}
        />
      ) : null}
    </>
  );
};

export default LaundryJobList;
