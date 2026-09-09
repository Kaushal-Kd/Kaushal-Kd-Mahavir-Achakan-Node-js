import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import { Download, Scale, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import Select from '../../components/ui/Select.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { reportsApi } from '../../lib/api/reports.js';
import {
  fetchAllReportRows,
  omitPagination,
  runTablePdfExport,
  withExportPdfBusy,
} from '../../lib/reportPdfExport.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import SettlementModal from '../booking/SettlementModal.jsx';

const FROM_ID = 'pending-bills-return-from';
const TO_ID = 'pending-bills-return-to';

function returnStatusLabel(status) {
  if (status === 'partially_returned' || status === 'returned' || status === 'closed') return 'Return';
  return status || '—';
}

const PendingBills = () => {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [settlementOrderId, setSettlementOrderId] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [sortBy, setSortBy] = useState('return_date');
  const [sortDir, setSortDir] = useState('desc');

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      sort_by: sortBy,
      sort_dir: sortDir,
    }),
    [page, perPage, search, from, to, sortBy, sortDir]
  );

  const { data: res, isLoading, isFetching } = useQuery({
    queryKey: ['reports', 'pending-bills', listParams],
    queryFn: () => reportsApi.pendingBills(listParams),
    keepPreviousData: true,
  });

  const payload = res?.data;
  const rows = payload?.rows ?? [];
  const meta = payload?.meta;
  const summary = payload?.summary;

  const applySearch = () => {
    setSearch(searchDraft);
    setPage(1);
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'order_number',
        header: 'Bill No.',
        columnPickerLabel: 'Bill No.',
        render: (r) => (
          <BookingBillLink orderId={r.id}>{r.order_number || '—'}</BookingBillLink>
        ),
      },
      {
        key: 'pickup_name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => r.pickup_name || '—',
      },
      {
        key: 'pickup_number',
        header: 'Customer No.',
        columnPickerLabel: 'Customer No.',
        render: (r) => r.pickup_number || '—',
      },
      {
        key: 'address',
        header: 'Address',
        columnPickerLabel: 'Address',
        render: (r) => r.address || '—',
      },
      {
        key: 'total_amount',
        header: 'Bill Amt.',
        columnPickerLabel: 'Bill Amt.',
        align: 'right',
        render: (r) => formatCurrency(r.total_amount),
      },
      {
        key: 'advance_amount',
        header: 'Advance Amount',
        columnPickerLabel: 'Advance Amount',
        align: 'right',
        render: (r) => formatCurrency(r.advance_amount),
      },
      {
        key: 'balance',
        header: 'Pending Amt.',
        columnPickerLabel: 'Pending Amt.',
        align: 'right',
        render: (r) => <span className="text-red-600 font-medium">{formatCurrency(r.balance)}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        className: 'bg-brand-light',
        render: (r) => <span className="font-medium text-gray-800">{returnStatusLabel(r.status)}</span>,
      },
      {
        key: 'return_date',
        header: 'Return',
        columnPickerLabel: 'Return',
        render: (r) => (r.return_date ? formatDate(r.return_date) : '—'),
      },
      {
        key: 'reference_name',
        header: 'Reference Name',
        columnPickerLabel: 'Reference Name',
        render: (r) => (r.reference_name ? r.reference_name : 'N/A'),
      },
      {
        key: 'action',
        header: 'Action',
        locked: true,
        align: 'center',
        render: (r) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={Scale}
            iconOnly
            className="text-brand"
            title="Product settlement"
            aria-label="Product settlement"
            onClick={() => setSettlementOrderId(r.id)}
          />
        ),
      },
    ],
    []
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns('pending-bills', allColumns);

  const pdfColumns = useMemo(
    () =>
      exportColumns
        .filter((c) => c.key !== 'action')
        .map((c) => ({
          key: c.key,
          header: c.columnPickerLabel || String(c.header || c.key),
          get: (r) => {
            if (c.key === 'total_amount') return formatCurrency(r.total_amount);
            if (c.key === 'advance_amount') return formatCurrency(r.advance_amount);
            if (c.key === 'balance') return formatCurrency(r.balance);
            if (c.key === 'status') return returnStatusLabel(r.status);
            if (c.key === 'return_date') return r.return_date ? formatDate(r.return_date) : '';
            if (c.key === 'reference_name') return r.reference_name || 'N/A';
            return r[c.key] ?? '';
          },
        })),
    [exportColumns]
  );

  const totalPages = meta?.total_pages || 1;

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      const exportRows = await fetchAllReportRows(reportsApi.pendingBills, omitPagination(listParams));
      const stamp = `${from || 'all'}_${to || 'all'}`;
      const subtitleParts = [];
      if (from) subtitleParts.push(`From ${from}`);
      if (to) subtitleParts.push(`To ${to}`);
      if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
      subtitleParts.push(`${exportRows.length} record(s)`);
      await runTablePdfExport({
        filename: `pending_bills_${stamp}.pdf`,
        title: 'Pending Bills Amounts',
        subtitle: subtitleParts.join(' · '),
        columns: pdfColumns,
        rows: exportRows,
      });
    });
  };

  const kpiActions = summary ? (
    <div className="flex flex-wrap gap-6 text-right">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Bill Amount</div>
        <div className="text-lg font-semibold text-green-700">{formatCurrency(summary.total_bill_amount)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Advance Amount</div>
        <div className="text-lg font-semibold text-brand">{formatCurrency(summary.total_advance_amount)}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Pending Amount</div>
        <div className="text-lg font-semibold text-green-700">{formatCurrency(summary.total_pending_amount)}</div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <PageHeader
        title="Pending Bills Amounts"
        description="Bills with product returned but amount still due."
        breadcrumbs={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: 'Pending Bills Amounts' },
        ]}
        actions={kpiActions}
      />

      <div className="card relative z-10 p-3 mb-3 overflow-visible">
        <div className="flex flex-nowrap items-center gap-2 min-w-max">
          <div className="w-44 shrink-0">
            <label htmlFor="pending-bills-search" className="sr-only">
              Search
            </label>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="pending-bills-search"
                type="search"
                className="input w-full pl-8 text-xs py-1.5"
                placeholder="Search…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch();
                }}
              />
            </div>
          </div>
          <div className="w-28 shrink-0 min-w-0">
            <Input
              id={FROM_ID}
              label=""
              type="date"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-28 shrink-0 min-w-0">
            <Input
              id={TO_ID}
              label=""
              type="date"
              panelAlign="end"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={applySearch}>
            Apply
          </Button>
          <div className="w-32 shrink-0">
            <Select
              aria-label="Sort pending bills by"
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
              options={[
                { value: 'return_date', label: 'Return date' },
                { value: 'bill_no', label: 'Bill number' },
              ]}
            />
          </div>
          <div className="w-32 shrink-0">
            <Select
              aria-label="Sort direction"
              value={sortDir}
              onChange={(e) => { setSortDir(e.target.value); setPage(1); }}
              options={[
                { value: 'asc', label: 'Oldest / Low' },
                { value: 'desc', label: 'Newest / High' },
              ]}
            />
          </div>
          <TableColumnPicker {...pickerProps} />
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={Download}
            className="shrink-0"
            disabled={exportBusy || isLoading}
            loading={exportBusy}
            onClick={exportPdf}
          >
            Export PDF
          </Button>
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={isLoading || isFetching}
        emptyTitle="No pending bill amounts"
        rowKey="id"
        visibleCount={rows.length}
        totalCount={meta?.total ?? 0}
        page={meta?.page ?? page}
        totalPages={totalPages}
        countLabel="records"
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        disablePrevious={page <= 1 || isFetching}
        disableNext={page >= totalPages || isFetching}
        perPage={perPage}
        onPerPageChange={(n) => {
          setPage(1);
          setPerPage(n);
        }}
      />

      <SettlementModal
        isOpen={Boolean(settlementOrderId)}
        orderId={settlementOrderId}
        onClose={() => setSettlementOrderId(null)}
      />
    </>
  );
};

export default PendingBills;
