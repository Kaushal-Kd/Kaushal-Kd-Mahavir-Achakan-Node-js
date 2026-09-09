import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate, todayIndiaISODate } from '@wrs/shared';
import { FileDown } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import SaleBillLink from '../../components/booking/SaleBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import { gstApi } from '../../lib/api/gst.js';
import {
  fetchAllReportRows,
  omitPagination,
  runTablePdfExport,
  withExportPdfBusy,
} from '../../lib/reportPdfExport.js';
import { syncService } from '../../services/syncService.js';
import { toast } from '../../stores/uiStore.js';

function monthStart() {
  return `${todayIndiaISODate().slice(0, 7)}-01`;
}

const LegacyGstReport = () => {
  const queryClient = useQueryClient();
  const [source, setSource] = useState('booking');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayIndiaISODate());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [taxMode, setTaxMode] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [exportBusy, setExportBusy] = useState(false);
  const [convertRow, setConvertRow] = useState(null);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const params = useMemo(() => ({
    source,
    from,
    to,
    search: search.trim() || undefined,
    status: status || undefined,
    tax_mode: taxMode,
    sort_by: sortBy,
    sort_dir: sortDir,
    page,
    per_page: 50,
  }), [source, from, to, search, status, taxMode, sortBy, sortDir, page]);
  const query = useQuery({
    queryKey: ['gst-report', params],
    queryFn: () => gstApi.report(params),
    enabled: !!from && !!to,
  });
  const payload = query.data?.data || {};
  const rows = payload.rows || [];
  const meta = payload.meta || {};

  const conversion = useMutation({
    mutationFn: () =>
      syncService.submitOrQueueGstConversion(
        convertRow.id,
        {
          source_type: source,
          idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${convertRow.id}`,
          reason,
          admin_password: password,
        },
        { label: convertRow.bill_number, requiresMasterPassword: true }
      ),
    onSuccess: async (result) => {
      toast.success(
        result?.queued
          ? 'GST conversion queued for synchronization'
          : 'GST Bill converted to Kaccha Bill'
      );
      setConvertRow(null);
      setReason('');
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['gst-report'] });
    },
    onError: (error) => toast.error(error?.response?.data?.error?.message || 'Conversion failed'),
  });

  const columns = useMemo(() => [
    {
      key: 'bill_number', header: 'Bill No.', render: (row) => source === 'sale'
        ? <SaleBillLink saleId={row.id}>{row.bill_number}</SaleBillLink>
        : <BookingBillLink orderId={row.id}>{row.bill_number}</BookingBillLink>,
    },
    { key: 'bill_date', header: 'Date', render: (row) => formatDate(row.bill_date) },
    { key: 'party_name', header: 'Party' },
    { key: 'address', header: 'Address', render: (row) => row.address || '—' },
    { key: 'taxable_value', header: 'Taxable', align: 'right', render: (row) => formatCurrency(row.taxable_value) },
    { key: 'cgst', header: 'CGST', align: 'right', render: (row) => formatCurrency(row.cgst) },
    { key: 'sgst', header: 'SGST', align: 'right', render: (row) => formatCurrency(row.sgst) },
    { key: 'igst', header: 'IGST', align: 'right', render: (row) => formatCurrency(row.igst) },
    { key: 'tax_total', header: 'Tax Total', align: 'right', render: (row) => formatCurrency(row.tax_total) },
    { key: 'grand_total', header: 'Grand Total', align: 'right', render: (row) => formatCurrency(row.grand_total) },
    { key: 'payment_status', header: 'Payment' },
    { key: 'status', header: 'Bill Status' },
    { key: 'action', header: 'Action', render: (row) => (
      <Button size="sm" variant="secondary" onClick={() => setConvertRow(row)}>Convert to Kaccha</Button>
    ) },
  ], [source]);

  const exportPdf = () => withExportPdfBusy(setExportBusy, async () => {
    const exportRows = await fetchAllReportRows(gstApi.report, omitPagination(params));
    await runTablePdfExport({
      filename: `gst_${source}_${from}_${to}.pdf`,
      title: `GST ${source === 'sale' ? 'Sales' : 'Booked Orders'}`,
      subtitle: `${from} to ${to}`,
      columns: columns.filter((column) => column.key !== 'action').map((column) => ({
        key: column.key,
        header: String(column.header),
        get: (row) => ['taxable_value', 'cgst', 'sgst', 'igst', 'tax_total', 'grand_total'].includes(column.key)
          ? formatCurrency(row[column.key])
          : row[column.key] || '',
      })),
      rows: exportRows,
    });
  });

  return (
    <>
      <PageHeader
        title="GST Report"
        description="GST bookings continue through Prepare, Today Delivery, and Today Return by status. GST sales are available on the Sales tab."
        actions={<Button icon={FileDown} loading={exportBusy} onClick={exportPdf}>Export PDF</Button>}
      />
      <div className="mb-3 flex border-b border-gray-200">
        {[
          ['booking', 'Booked Orders'],
          ['sale', 'Sales'],
        ].map(([value, label]) => (
          <button key={value} type="button" className={`px-4 py-2 text-sm font-medium ${source === value ? 'border-b-2 border-brand text-brand' : 'text-gray-500'}`} onClick={() => { setSource(value); setStatus(''); setPage(1); }}>
            {label}
          </button>
        ))}
      </div>
      <div className="card mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-7">
        <Input label="From" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} />
        <Input label="To" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} />
        <Input label="Search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        <Select
          label="Status"
          value={status}
          onChange={(event) => { setStatus(event.target.value); setPage(1); }}
          options={source === 'sale'
            ? [
                { value: '', label: 'All statuses' },
                { value: 'active', label: 'Active' },
                { value: 'cancelled', label: 'Cancelled' },
              ]
            : [
                { value: '', label: 'All statuses' },
                { value: 'booked', label: 'Booked' },
                { value: 'in_preparation', label: 'In preparation' },
                { value: 'ready_for_delivery', label: 'Ready for delivery' },
                { value: 'delivered', label: 'Delivered' },
                { value: 'partially_returned', label: 'Partially returned' },
                { value: 'returned', label: 'Returned' },
                { value: 'closed', label: 'Closed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
        />
        <Select label="Tax type" value={taxMode} onChange={(event) => { setTaxMode(event.target.value); setPage(1); }} options={[
          { value: 'all', label: 'All GST' },
          { value: 'cgst_sgst', label: 'CGST + SGST' },
          { value: 'igst', label: 'IGST' },
        ]} />
        <Select label="Sort by" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }} options={[
          { value: 'date', label: 'Date' },
          { value: 'bill_no', label: 'Bill number' },
        ]} />
        <Select label="Direction" value={sortDir} onChange={(event) => { setSortDir(event.target.value); setPage(1); }} options={[
          { value: 'asc', label: 'Low / Oldest' },
          { value: 'desc', label: 'High / Newest' },
        ]} />
      </div>
      {payload.summary ? (
        <div className="card mb-3 flex flex-wrap gap-5 p-3 text-xs">
          <span>Taxable: <strong>{formatCurrency(payload.summary.taxable_value)}</strong></span>
          <span>CGST: <strong>{formatCurrency(payload.summary.cgst)}</strong></span>
          <span>SGST: <strong>{formatCurrency(payload.summary.sgst)}</strong></span>
          <span>IGST: <strong>{formatCurrency(payload.summary.igst)}</strong></span>
          <span>Grand Total: <strong>{formatCurrency(payload.summary.grand_total)}</strong></span>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        loading={query.isLoading}
        page={page}
        totalPages={meta.total_pages || 1}
        totalCount={meta.total || 0}
        onPreviousPage={() => setPage((current) => Math.max(1, current - 1))}
        onNextPage={() => setPage((current) => current + 1)}
        disablePrevious={page <= 1}
        disableNext={page >= (meta.total_pages || 1)}
      />
      <Modal
        isOpen={Boolean(convertRow)}
        onClose={() => setConvertRow(null)}
        title="Convert GST Bill to Kaccha Bill"
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setConvertRow(null)}>Cancel</Button><Button loading={conversion.isPending} disabled={!reason.trim() || !password} onClick={() => conversion.mutate()}>Convert</Button></>}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">Tax will be removed atomically. Existing payments stay unchanged, and overpaid conversions are rejected.</p>
          <Input label="Reason" required value={reason} onChange={(event) => setReason(event.target.value)} />
          <Input label="Master Password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
      </Modal>
    </>
  );
};

LegacyGstReport.propTypes = {};
const GstInvoiceWorkspace = lazy(() => import('./GstInvoiceWorkspace.jsx'));
function GstReport() {
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const shopId = useShopStore((s) => s.selectedShopId);
  const [legacy, setLegacy] = useState(false);
  const admin = ['super_admin', 'shop_admin'].includes(role);
  return <>
    {admin && <div className="mb-3 flex flex-wrap gap-2"><Button variant={legacy ? 'secondary' : 'primary'} onClick={() => setLegacy(false)}>Created GST invoices</Button><Button variant={legacy ? 'primary' : 'secondary'} onClick={() => setLegacy(true)}>Existing GST bills</Button></div>}
    {!admin || legacy ? <LegacyGstReport key={userId + ':' + shopId} /> : <Suspense fallback={<p className="p-4 text-sm">Loading GST invoices?</p>}><GstInvoiceWorkspace key={userId + ':' + shopId} /></Suspense>}
  </>;
}
GstReport.propTypes = {};
export default GstReport;
