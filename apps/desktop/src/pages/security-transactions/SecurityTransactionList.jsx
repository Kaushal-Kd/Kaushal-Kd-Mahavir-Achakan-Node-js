import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '@wrs/shared';
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
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { paymentsApi } from '../../lib/api/payments.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { downloadCsv } from '../../utils/csv.js';

function displayCustomerName(r) {
  return r.customer_name || r.pickup_name || '—';
}

function billLabel(r) {
  return r.bill_no || r.order_number || '—';
}

function formatTxnDateTime(row) {
  return formatDateTime(row.created_at || row.payment_date) || '—';
}

function SummaryStripSecurity({ summary }) {
  if (!summary) return null;
  const v = 'text-green-700 font-semibold tabular-nums';
  return (
    <div className="card px-4 py-3 mb-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-gray-800">
      <span>
        Total Receive: <span className={v}>{formatCurrency(summary.total_received)}</span>
      </span>
      <span>
        Total Return: <span className={v}>{formatCurrency(summary.total_returned)}</span>
      </span>
      <span>
        Total Charge: <span className={v}>{formatCurrency(summary.total_charge)}</span>
      </span>
      <span>
        Security on Hand: <span className={v}>{formatCurrency(summary.security_on_hand)}</span>
      </span>
    </div>
  );
}

SummaryStripSecurity.propTypes = {
  summary: PropTypes.shape({
    total_received: PropTypes.number,
    total_returned: PropTypes.number,
    total_charge: PropTypes.number,
    security_on_hand: PropTypes.number,
  }),
};

SummaryStripSecurity.defaultProps = { summary: null };

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

const SECURITY_TXN_DEFAULT_HIDDEN = ['customer_phone', 'charge_amount', 'notes_ref'];

const SecurityTransactionList = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [view, setView] = useState('received');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [sort, setSort] = useState('-pm.created_at');

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      sort,
      view,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(securityAccountId ? { security_account_id: securityAccountId } : {}),
      ...(dateFrom ? { from: dateFrom } : {}),
      ...(dateTo ? { to: dateTo } : {}),
    }),
    [page, perPage, search, securityAccountId, dateFrom, dateTo, sort, view]
  );

  const { data, isLoading } = useQuery({
    queryKey: ['security-transactions', listParams],
    queryFn: () => paymentsApi.securityTransactions(listParams),
    keepPreviousData: true,
  });

  const { data: secAccountsRes } = useQuery({
    queryKey: ['security-accounts'],
    queryFn: () => securityAccountsApi.list(),
  });

  const securityAccountOptions = useMemo(() => {
    const rows = secAccountsRes?.data ?? secAccountsRes ?? [];
    const list = Array.isArray(rows) ? rows : [];
    return [
      { value: '', label: 'Select Account' },
      ...list.map((a) => ({ value: a.id, label: a.name || a.id })),
    ];
  }, [secAccountsRes]);

  const summary = data?.summary;

  const clearFilters = () => {
    setSearch('');
    setSecurityAccountId('');
    setView('received');
    setDateFrom('');
    setDateTo('');
    setPage(1);
    setSort('-pm.created_at');
  };

  const filtersClear = !search && !securityAccountId && !dateFrom && !dateTo && view === 'received';

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
        render: (r) => (
          <BookingBillLink
            orderId={r.order_id}
            className={r.order_id ? undefined : 'text-gray-500'}
          >
            {r.order_id ? billLabel(r) : '—'}
          </BookingBillLink>
        ),
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
        key: 'payment_date',
        header: (
          <SortHeader label="Date & Time" field="pm.created_at" sort={sort} onSort={onSort} />
        ),
        columnPickerLabel: 'Date & time',
        className: 'text-xs whitespace-nowrap',
        render: (r) => formatTxnDateTime(r),
      },
      {
        key: 'security_account_name',
        header: 'Payment Acc.',
        columnPickerLabel: 'Security account',
        className: 'text-xs',
        render: (r) => <span className="uppercase">{r.security_account_name || '—'}</span>,
      },
      {
        key: 'amount',
        header: <SortHeader label="Amount" field="pm.amount" sort={sort} onSort={onSort} />,
        columnPickerLabel: 'Amount',
        align: 'right',
        className: 'text-xs',
        render: (r) =>
          formatCurrency(Number(view === 'on_hand' ? r.on_hand_amount : (r.amount ?? 0))),
      },
      {
        key: 'category',
        header: 'Security (Status)',
        columnPickerLabel: 'Security status',
        className: 'text-xs',
        render: (r) =>
          view === 'on_hand' ? (
            <span className="font-medium text-brand">On Hand</span>
          ) : r.category === 'deposit_refund' ? (
            <span className="font-medium text-red-600">Return</span>
          ) : (
            <span className="font-medium text-green-700">Received</span>
          ),
      },
      {
        key: 'charge_amount',
        header: 'Charge Amt.',
        columnPickerLabel: 'Charge amount',
        align: 'right',
        className: 'text-xs',
        render: (r) => formatCurrency(Number(r.charge_amount ?? 0)),
      },
      {
        key: 'notes_ref',
        header: 'Income Ref.',
        columnPickerLabel: 'Income reference',
        className: 'text-xs max-w-[12rem] truncate',
        render: (r) => {
          const parts = [r.transaction_id, r.notes].filter(Boolean);
          return parts.length ? parts.join(' · ') : 'N/A';
        },
      },
    ],
    [onSort, sort, view]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('security-transactions', allColumns, {
    defaultHidden: SECURITY_TXN_DEFAULT_HIDDEN,
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
          if (c.key === 'payment_date') return formatTxnDateTime(r);
          if (c.key === 'security_account_name')
            return (r.security_account_name || '').toUpperCase();
          if (c.key === 'amount')
            return formatCurrency(Number(view === 'on_hand' ? r.on_hand_amount : (r.amount ?? 0)));
          if (c.key === 'category')
            return view === 'on_hand'
              ? 'On Hand'
              : r.category === 'deposit_refund'
                ? 'Return'
                : 'Received';
          if (c.key === 'charge_amount') return formatCurrency(Number(r.charge_amount ?? 0));
          if (c.key === 'notes_ref') {
            const parts = [r.transaction_id, r.notes].filter(Boolean);
            return parts.length ? parts.join(' · ') : 'N/A';
          }
          return r[c.key] ?? '';
        },
      })),
    [visibleColumns, view]
  );

  const exportExcel = useCallback(() => {
    const rows = data?.data || [];
    const stamp = dateFrom || dateTo ? `${dateFrom || 'start'}_${dateTo || 'end'}` : 'all';
    downloadCsv(`security_transactions_${stamp}.csv`, exportColumns, rows);
  }, [data?.data, dateFrom, dateTo, exportColumns]);

  return (
    <>
      <PageHeader
        title="Security"
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Security' }]}
      />

      <SummaryStripSecurity summary={summary} />

      <div className="card relative z-20 p-3 mb-3 overflow-visible">
        <div className="flex flex-nowrap items-center gap-2 w-full min-w-max">
          <div className="w-44 min-w-[9rem] shrink-0">
            <label htmlFor="sec-txn-search" className="sr-only">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                id="sec-txn-search"
                className="input w-full pl-8 text-xs py-1.5"
                placeholder="Search..."
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </div>
          </div>
          <div className="w-44 shrink-0 min-w-0">
            <Select
              label=""
              value={view}
              onChange={(e) => {
                setPage(1);
                setView(e.target.value);
              }}
              options={[
                { value: 'received', label: 'Received' },
                { value: 'return', label: 'Return' },
                { value: 'on_hand', label: 'On Hand' },
              ]}
            />
          </div>
          <div className="w-44 shrink-0 min-w-0">
            <Select
              label=""
              value={securityAccountId}
              onChange={(e) => {
                setPage(1);
                setSecurityAccountId(e.target.value);
              }}
              options={securityAccountOptions}
            />
          </div>
          <div className="relative w-28 shrink-0 min-w-0">
            <Input
              id="sec-txn-date-from"
              label=""
              type="date"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => {
                setPage(1);
                const next = e.target.value;
                setDateFrom(next);
                if (dateTo && next && dateTo < next) setDateTo('');
              }}
            />
          </div>
          <div className="relative w-28 shrink-0 min-w-0">
            <Input
              id="sec-txn-date-to"
              label=""
              type="date"
              panelAlign="end"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => {
                setPage(1);
                setDateTo(e.target.value);
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
        rowKey="id"
        onRowClick={(r) => {
          if (r.order_id) navigate(`/booking/${r.order_id}`);
        }}
        emptyTitle="No security transactions"
        emptyMessage="Try adjusting filters or date."
        visibleCount={data?.data?.length ?? 0}
        totalCount={data?.meta?.total ?? 0}
        page={data?.meta?.page ?? page}
        totalPages={data?.meta?.total_pages ?? 1}
        countLabel="rows"
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

export default SecurityTransactionList;
