import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime } from '@wrs/shared';
import { RotateCcw, Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import SecurityChargeFundsModal from './SecurityChargeFundsModal.jsx';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { securityChargesApi } from '../../lib/api/securityCharges.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';

const STATUS_TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'settled', label: 'Settled' },
];

const SECURITY_CHARGES_PENDING_DEFAULT_HIDDEN = ['payment_account_name'];
const SECURITY_CHARGES_SETTLED_DEFAULT_HIDDEN = ['income_entry_id'];

function billLabel(r) {
  return r.bill_no || r.order_number || '—';
}

function SummaryStrip({ summary }) {
  if (!summary) return null;
  const v = 'text-green-700 font-semibold tabular-nums';
  return (
    <div className="card px-4 py-3 mb-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-gray-800">
      <span>
        Assessed (pending):{' '}
        <span className={v}>{formatCurrency(summary.total_pending, { decimals: 0 })}</span>
      </span>
      <span>
        Legacy/closed assessments:{' '}
        <span className={v}>{formatCurrency(summary.total_settled, { decimals: 0 })}</span>
      </span>
      <span>
        Held: <span className={v}>{formatCurrency(summary.total_held || 0)}</span>
      </span>
      <span>
        Recognized income:{' '}
        <span className={v}>{formatCurrency(summary.total_recognized || 0)}</span>
      </span>
    </div>
  );
}

SummaryStrip.propTypes = {
  summary: PropTypes.shape({
    total_pending: PropTypes.number,
    total_settled: PropTypes.number,
    total_held: PropTypes.number,
    total_recognized: PropTypes.number,
  }),
};

SummaryStrip.defaultProps = { summary: null };

const SecurityChargesList = () => {
  const [search, setSearch] = useState('');
  const [conditionKind, setConditionKind] = useState('');
  const [collectionStatus, setCollectionStatus] = useState('all');
  const [statusTab, setStatusTab] = useState('pending');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [settleRow, setSettleRow] = useState(null);

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      settled: statusTab === 'settled',
      collection_status: collectionStatus,
      ...(conditionKind ? { condition_kind: conditionKind } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [page, perPage, search, statusTab, collectionStatus, conditionKind]
  );

  const { data, isLoading } = useQuery({
    queryKey: ['security-charges', listParams],
    queryFn: () => securityChargesApi.list(listParams),
    keepPreviousData: true,
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });

  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'security-charges-page'],
    queryFn: () => securityAccountsApi.list(),
  });

  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = securityAccountsQuery.data?.data || [];

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
        header: 'Customer',
        columnPickerLabel: 'Customer',
        className: 'text-xs',
        render: (r) => <span>{r.customer_name || r.pickup_name || '—'}</span>,
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
        key: 'amount',
        header: 'Assessed',
        columnPickerLabel: 'Assessed',
        align: 'right',
        className: 'text-xs',
        render: (r) => (
          <span className="font-semibold tabular-nums">
            {formatCurrency(r.amount, { decimals: 0 })}
          </span>
        ),
      },
      ...['held', 'uncollected', 'settled'].map((field) => ({
        key: `ledger_${field}`,
        header: field === 'settled' ? 'Recognized' : field === 'held' ? 'Held' : 'Uncollected',
        align: 'right',
        render: (row) =>
          row.ledger_verified ? formatCurrency(row.balances?.[field] || 0) : 'Unverified',
      })),
      {
        key: 'remarks',
        header: 'Remarks',
        columnPickerLabel: 'Remarks',
        className: 'text-xs min-w-[16rem] max-w-[28rem] align-top',
        render: (r) => {
          const text = String(r.remarks || '').trim();
          if (!text) return '—';
          return (
            <span
              className="block whitespace-pre-wrap break-words text-gray-900 leading-snug"
              title={text}
            >
              {text}
            </span>
          );
        },
      },
      {
        key: 'created_at',
        header: 'Date',
        columnPickerLabel: 'Created date',
        className: 'text-xs whitespace-nowrap',
        render: (r) => formatDateTime(r.created_at) || '—',
      },
      ...(statusTab === 'pending'
        ? [
            {
              key: 'payment_account_name',
              header: 'Charge account',
              columnPickerLabel: 'Charge account',
              className: 'text-xs',
              render: (r) => r.payment_account_name || r.security_account_name || '—',
            },
          ]
        : [
            {
              key: 'settled_at',
              header: 'Settled',
              columnPickerLabel: 'Settled date',
              className: 'text-xs whitespace-nowrap',
              render: (r) => formatDateTime(r.settled_at) || '—',
            },
            {
              key: 'payment_account_name',
              header: 'Held in account',
              columnPickerLabel: 'Held in account',
              className: 'text-xs',
              render: (r) => r.payment_account_name || r.security_account_name || '—',
            },
            {
              key: 'income_entry_id',
              header: 'Income',
              columnPickerLabel: 'Income link',
              className: 'text-xs whitespace-nowrap',
              render: (r) =>
                r.income_entry_id ? (
                  <Link to="/income" className="text-brand hover:underline">
                    View income
                  </Link>
                ) : (
                  '—'
                ),
            },
          ]),
      {
        key: 'actions',
        header: '',
        locked: true,
        render: (row) => (
          <Button
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setSettleRow(row);
            }}
          >
            {row.ledger_verified ? 'Manage funds' : 'Review legacy'}
          </Button>
        ),
      },
    ],
    [statusTab]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns(
    statusTab === 'pending' ? 'security-charges-pending' : 'security-charges-settled',
    allColumns,
    {
      defaultHidden:
        statusTab === 'pending'
          ? SECURITY_CHARGES_PENDING_DEFAULT_HIDDEN
          : SECURITY_CHARGES_SETTLED_DEFAULT_HIDDEN,
    }
  );

  const filtersClear = !search && !conditionKind && collectionStatus === 'all';

  return (
    <>
      <PageHeader
        title="Missing/Damage Charges"
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Missing/Damage Charges' }]}
      />

      <SummaryStrip summary={data?.summary} />

      <div className="card p-3 mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_TABS.map((t) => (
            <Button
              key={t.value}
              type="button"
              size="sm"
              variant={statusTab === t.value ? 'primary' : 'secondary'}
              onClick={() => {
                setStatusTab(t.value);
                setPage(1);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="relative min-w-[10rem] flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            className="input w-full pl-8 text-xs py-1.5"
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <Select
          label="Condition"
          value={conditionKind}
          className="max-w-40"
          onChange={(event) => {
            setConditionKind(event.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All conditions' },
            { value: 'missing', label: 'Missing' },
            { value: 'damage', label: 'Damage' },
          ]}
        />
        <Select
          label="Funds"
          value={collectionStatus}
          className="max-w-48"
          onChange={(event) => {
            setCollectionStatus(event.target.value);
            setPage(1);
          }}
          options={[
            { value: 'all', label: 'All funds' },
            { value: 'uncollected', label: 'Not collected' },
            { value: 'held', label: 'Held deposit' },
            { value: 'legacy', label: 'Needs reconciliation' },
          ]}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={RotateCcw}
          disabled={filtersClear}
          onClick={() => {
            setSearch('');
            setConditionKind('');
            setCollectionStatus('all');
            setPage(1);
          }}
        >
          Reset
        </Button>
        <TableColumnPicker {...pickerProps} />
      </div>

      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        loading={isLoading}
        rowKey="id"
        emptyTitle={statusTab === 'pending' ? 'No pending charges' : 'No settled charges'}
        emptyMessage={
          statusTab === 'pending'
            ? 'Record an assessment on return, then explicitly collect or retain funds. Only held money can be refunded or settled as income.'
            : 'Settled charges are income to your account (not paid to the customer). Held in account shows where the amount was held before income.'
        }
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

      {settleRow && (
        <SecurityChargeFundsModal
          key={settleRow.id}
          charge={settleRow}
          paymentAccounts={paymentAccounts}
          securityAccounts={securityAccounts}
          onClose={() => setSettleRow(null)}
        />
      )}
    </>
  );
};

export default SecurityChargesList;
