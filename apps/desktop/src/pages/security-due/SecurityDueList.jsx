import { useQuery } from '@tanstack/react-query';
import { formatCurrency, ORDER_STATUS_LABELS } from '@wrs/shared';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  FileSpreadsheet,
  RotateCcw,
  Search,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { paymentsApi } from '../../lib/api/payments.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { downloadCsv } from '../../utils/csv.js';

function displayCustomerName(r) {
  return r.customer_name || r.pickup_name || '—';
}

function billLabel(r) {
  return r.bill_no || r.order_number || '—';
}

function rowPending(r) {
  const collected = Number(r.collected_amount ?? 0);
  const returned = Number(r.return_amount ?? 0);
  const charge = Number(r.charge_amount ?? 0);
  return collected - returned - charge;
}

function dueStatusMeta(orderStatus) {
  const s = orderStatus || '';
  if (s === 'cancelled') return { label: 'Cancelled', tone: 'red' };
  if (s === 'partially_returned') return { label: 'Partially Returned', tone: 'yellow' };
  if (s === 'returned' || s === 'closed') return { label: 'Returned', tone: 'green' };
  if (s === 'delivered') return { label: 'Delivered', tone: 'brand' };
  return { label: ORDER_STATUS_LABELS[s] || s || '—', tone: 'brand' };
}

function SummaryStripDue({ summary }) {
  if (!summary) return null;
  const v = 'text-green-700 font-semibold tabular-nums';
  return (
    <div className="card px-4 py-3 mb-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-gray-800">
      <span>
        Total Collected: <span className={v}>{formatCurrency(summary.total_collected)}</span>
      </span>
      <span>
        Total Return: <span className={v}>{formatCurrency(summary.total_return)}</span>
      </span>
      <span>
        Total Charge: <span className={v}>{formatCurrency(summary.total_charge)}</span>
      </span>
      <span>
        Total Pending: <span className={v}>{formatCurrency(summary.total_pending)}</span>
      </span>
    </div>
  );
}

SummaryStripDue.propTypes = {
  summary: PropTypes.shape({
    total_collected: PropTypes.number,
    total_return: PropTypes.number,
    total_charge: PropTypes.number,
    total_pending: PropTypes.number,
  }),
};

SummaryStripDue.defaultProps = { summary: null };

function SortHeader({ label, field, sort, onSort }) {
  const desc = sort.startsWith('-');
  const cur = desc ? sort.slice(1) : sort;
  const active = cur === field;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-0.5 text-left font-semibold text-gray-800 hover:text-brand"
      onClick={() => onSort(field)}
    >
      {label}
      {!active ? (
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-40" aria-hidden />
      ) : desc ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
    </button>
  );
}

SortHeader.propTypes = {
  label: PropTypes.string.isRequired,
  field: PropTypes.string.isRequired,
  sort: PropTypes.string.isRequired,
  onSort: PropTypes.func.isRequired,
};

const SECURITY_DUE_DEFAULT_HIDDEN = ['customer_phone'];

const SecurityDueList = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [amountFilter, setAmountFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [sort, setSort] = useState('-d.last_payment_date');

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      sort,
      ...(amountFilter ? { amount_filter: amountFilter } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(dateFrom ? { from: dateFrom } : {}),
      ...(dateTo ? { to: dateTo } : {}),
    }),
    [page, perPage, search, sort, amountFilter, dateFrom, dateTo]
  );

  const { data, isLoading } = useQuery({
    queryKey: ['security-due', listParams],
    queryFn: () => paymentsApi.securityDue(listParams),
    keepPreviousData: true,
  });

  const summary = data?.summary;

  const clearFilters = () => {
    setSearch('');
    setAmountFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
    setSort('-d.last_payment_date');
  };

  const filtersClear = !search && !amountFilter && !dateFrom && !dateTo;

  const onSort = useCallback((field) => {
    setPage(1);
    setSort((prev) => {
      const desc = prev.startsWith('-');
      const cur = desc ? prev.slice(1) : prev;
      if (cur !== field) return `-${field}`;
      return desc ? field : `-${field}`;
    });
  }, []);

  const allColumns = useMemo(
    () => [
      {
        key: 'order_number',
        header: 'Bill No.',
        columnPickerLabel: 'Bill No.',
        className: 'text-xs whitespace-nowrap',
        render: (r) => <BookingBillLink orderId={r.order_id}>{billLabel(r)}</BookingBillLink>,
      },
      {
        key: 'customer_name',
        header: <SortHeader label="Name" field="c.name" sort={sort} onSort={onSort} />,
        columnPickerLabel: 'Name',
        className: 'text-xs',
        render: (r) => <span className="text-gray-900">{displayCustomerName(r)}</span>,
      },
      {
        key: 'customer_phone',
        header: 'Customer No.',
        columnPickerLabel: 'Customer phone',
        className: 'text-xs',
        render: (r) => <span className="font-mono text-xs">{r.customer_phone || '—'}</span>,
      },
      {
        key: 'customer_address',
        header: 'Address',
        columnPickerLabel: 'Address',
        className: 'text-xs max-w-[14rem]',
        render: (r) => (
          <span className="block truncate" title={r.customer_address || ''}>
            {r.customer_address || '—'}
          </span>
        ),
      },
      {
        key: 'collected_amount',
        header: (
          <SortHeader
            label="Collected Amt."
            field="d.collected_amount"
            sort={sort}
            onSort={onSort}
          />
        ),
        columnPickerLabel: 'Collected amount',
        align: 'right',
        className: 'text-xs',
        render: (r) => formatCurrency(Number(r.collected_amount ?? 0)),
      },
      {
        key: 'return_amount',
        header: (
          <SortHeader label="Return Amt." field="d.return_amount" sort={sort} onSort={onSort} />
        ),
        columnPickerLabel: 'Return amount',
        align: 'right',
        className: 'text-xs',
        render: (r) => formatCurrency(Number(r.return_amount ?? 0)),
      },
      {
        key: 'charge_amount',
        header: (
          <SortHeader label="Charge Amt." field="charge_amount" sort={sort} onSort={onSort} />
        ),
        columnPickerLabel: 'Charge amount',
        align: 'right',
        className: 'text-xs',
        render: (r) => formatCurrency(Number(r.charge_amount ?? 0)),
      },
      {
        key: 'pending_amount',
        header: 'Pending Amt.',
        columnPickerLabel: 'Pending amount',
        align: 'right',
        className: 'text-xs',
        render: (r) => {
          const pending = rowPending(r);
          return (
            <span className={clsx(pending > 0 && 'font-medium text-red-600')}>
              {formatCurrency(pending)}
            </span>
          );
        },
      },
      {
        key: 'order_status',
        header: 'Status',
        columnPickerLabel: 'Status',
        className: 'text-xs whitespace-nowrap',
        render: (r) => {
          const { label, tone } = dueStatusMeta(r.derived_status || r.order_status);
          return (
            <Badge tone={tone} className="whitespace-nowrap shrink-0">
              {label}
            </Badge>
          );
        },
      },
    ],
    [onSort, sort]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('security-due', allColumns, {
    defaultHidden: SECURITY_DUE_DEFAULT_HIDDEN,
  });

  const exportColumns = useMemo(
    () =>
      visibleColumns.map((c) => ({
        key: c.key,
        header: c.columnPickerLabel || String(c.key),
        get: (r) => {
          if (c.key === 'order_number') return billLabel(r);
          if (c.key === 'customer_name') return displayCustomerName(r);
          if (c.key === 'customer_phone') return r.customer_phone || '';
          if (c.key === 'customer_address') return r.customer_address || '';
          if (c.key === 'collected_amount') return formatCurrency(Number(r.collected_amount ?? 0));
          if (c.key === 'return_amount') return formatCurrency(Number(r.return_amount ?? 0));
          if (c.key === 'charge_amount') return formatCurrency(Number(r.charge_amount ?? 0));
          if (c.key === 'pending_amount') return formatCurrency(rowPending(r));
          if (c.key === 'order_status')
            return dueStatusMeta(r.derived_status || r.order_status).label;
          return r[c.key] ?? '';
        },
      })),
    [visibleColumns]
  );

  const exportExcel = useCallback(() => {
    const rows = data?.data || [];
    downloadCsv('security_due.csv', exportColumns, rows);
  }, [data?.data, exportColumns]);

  return (
    <>
      <PageHeader
        title="Due Security"
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Due Security' }]}
      />

      <SummaryStripDue summary={summary} />

      <div className="card p-3 mb-3 overflow-x-auto">
        <div className="flex flex-nowrap items-center gap-2 w-full min-w-max">
          <div className="w-52 min-w-[12rem] shrink-0">
            <label htmlFor="sec-due-search" className="sr-only">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                id="sec-due-search"
                className="input w-full pl-8 text-xs"
                placeholder="Search..."
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </div>
          </div>
          <div className="w-44 shrink-0">
            <Select
              label=""
              value={amountFilter}
              onChange={(event) => {
                setPage(1);
                setAmountFilter(event.target.value);
              }}
              options={[
                { value: '', label: 'All amounts' },
                { value: 'collected', label: 'Collected' },
                { value: 'return', label: 'Return Amount' },
                { value: 'charge', label: 'Charge Amount' },
                { value: 'pending', label: 'Pending Amount' },
              ]}
            />
          </div>
          <div className="w-28 shrink-0 min-w-0">
            <Input
              id="sec-due-date-from"
              label=""
              type="date"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => {
                const next = event.target.value;
                setPage(1);
                setDateFrom(next);
                if (dateTo && next && dateTo < next) setDateTo('');
              }}
            />
          </div>
          <div className="w-28 shrink-0 min-w-0">
            <Input
              id="sec-due-date-to"
              label=""
              type="date"
              panelAlign="end"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => {
                setPage(1);
                setDateTo(event.target.value);
              }}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            title="Reset filters"
            aria-label="Reset filters"
            disabled={filtersClear}
            onClick={clearFilters}
            className="shrink-0"
          />
          <TableColumnPicker {...pickerProps} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={FileSpreadsheet}
            className="shrink-0 border-0 bg-green-600 text-white hover:bg-green-700"
            onClick={exportExcel}
            disabled={isLoading}
          >
            Excel
          </Button>
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        loading={isLoading}
        rowKey="order_id"
        onRowClick={(r) => navigate(`/booking/${r.order_id}`)}
        emptyTitle="No orders with collected security"
        emptyMessage="Try adjusting search or page size."
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
    </>
  );
};

export default SecurityDueList;
