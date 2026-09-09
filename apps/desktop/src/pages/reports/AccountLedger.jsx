import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import { Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import TransactionBillLink from '../../components/booking/TransactionBillLink.jsx';
import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { reportsApi } from '../../lib/api/reports.js';
import { paginateClientRows } from '../../lib/tableListMeta.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import {
  runGroupedPdfExport,
  runGroupedPdfPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';

const LEDGER_COLUMNS = [
  { key: 'date', header: 'Date & Time', width: '120px' },
  { key: 'ref_no', header: 'Bill number', width: '100px' },
  { key: 'customer_name', header: 'Customer name' },
  { key: 'details', header: 'Details' },
  { key: 'amount', header: 'Amount', align: 'right', width: '112px' },
];

function currentIndianFyStartYear() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

function buildFinancialYearOptions() {
  const start = currentIndianFyStartYear();
  const out = [];
  for (let fy = start; fy >= start - 6; fy -= 1) {
    const endY = fy + 1;
    out.push({
      value: `${fy}`,
      label: `${fy} - ${endY}`,
      from: `${fy}-04-01`,
      to: `${endY}-03-31`,
    });
  }
  return out;
}

const FY_OPTIONS = buildFinancialYearOptions();
const FY_CUSTOM = '';

function formatBalanceLabel(amount, side) {
  const a = Number(amount || 0);
  if (!side || side === 'flat' || Math.abs(a) < 1e-9) return formatCurrency(0);
  return `${formatCurrency(a)} ${side}`;
}

function balanceClass(side) {
  if (!side || side === 'flat') return 'text-gray-900 font-medium tabular-nums';
  return side === 'Cr' ? 'text-red-700 font-medium tabular-nums' : 'text-green-700 font-medium tabular-nums';
}

const AccountLedger = () => {
  const defaultFy = FY_OPTIONS[0] || { from: '2026-04-01', to: '2027-03-31' };
  const [fyValue, setFyValue] = useState(String(currentIndianFyStartYear()));
  const [from, setFrom] = useState(defaultFy.from);
  const [to, setTo] = useState(defaultFy.to);
  const [accountDraft, setAccountDraft] = useState('');
  const [applied, setApplied] = useState({ accountId: '', from: '', to: '' });
  const [exportBusy, setExportBusy] = useState(false);
  const [drPage, setDrPage] = useState(1);
  const [crPage, setCrPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);

  const accountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });

  const accountOptions = useMemo(() => {
    const raw = accountsQuery.data?.data;
    const list = Array.isArray(raw) ? [...raw] : [];
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return list.filter((a) => a.is_active !== false).map((a) => ({ value: a.id, label: a.name || a.id }));
  }, [accountsQuery.data?.data]);

  const listParams = useMemo(() => {
    if (!applied.accountId || !applied.from || !applied.to) return null;
    return {
      account_id: applied.accountId,
      from: applied.from,
      to: applied.to,
    };
  }, [applied]);

  const { data: res, isLoading, isFetching } = useQuery({
    queryKey: ['reports', 'account-ledger', listParams],
    queryFn: () => reportsApi.accountLedger(listParams),
    enabled: Boolean(listParams),
  });

  const payload = res?.data;
  const summary = payload?.summary;
  const meta = payload?.meta;
  const drRowsRaw = payload?.dr_rows ?? [];
  const crRowsRaw = payload?.cr_rows ?? [];
  const drRows = useMemo(
    () => drRowsRaw.map((r, i) => ({ ...r, row_id: r.row_id || `dr-${i}` })),
    [drRowsRaw]
  );
  const crRows = useMemo(
    () => crRowsRaw.map((r, i) => ({ ...r, row_id: r.row_id || `cr-${i}` })),
    [crRowsRaw]
  );
  const drPaged = useMemo(() => paginateClientRows(drRows, drPage, perPage), [drRows, drPage, perPage]);
  const crPaged = useMemo(() => paginateClientRows(crRows, crPage, perPage), [crRows, crPage, perPage]);
  const accountName = payload?.account?.name;

  const allColumns = useMemo(
    () =>
      LEDGER_COLUMNS.map((c) => {
        const base = { ...c, columnPickerLabel: c.header };
        if (c.key === 'date') {
          return {
            ...base,
            className: 'text-xs whitespace-nowrap tabular-nums',
            render: (r) => formatFinancialRecordDateTime(r, 'date'),
          };
        }
        if (c.key === 'amount') {
          return {
            ...base,
            className: 'text-xs tabular-nums',
            render: (r) => formatCurrency(r.amount),
          };
        }
        if (c.key === 'ref_no') {
          return {
            ...base,
            className: 'text-xs whitespace-nowrap',
            render: (r) => (
              <TransactionBillLink orderId={r.order_id} saleId={r.sale_id}>
                {r.ref_no || '—'}
              </TransactionBillLink>
            ),
          };
        }
        return { ...base, className: 'text-xs', render: (r) => r[c.key] ?? '—' };
      }),
    []
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns('account-ledger', allColumns);

  const runSearch = () => {
    if (!accountDraft.trim()) return;
    setDrPage(1);
    setCrPage(1);
    setApplied({ accountId: accountDraft.trim(), from, to });
  };

  const onFyChange = (e) => {
    const v = e.target.value;
    setFyValue(v);
    if (v === FY_CUSTOM) return;
    const opt = FY_OPTIONS.find((o) => o.value === v);
    if (opt) {
      setFrom(opt.from);
      setTo(opt.to);
    }
  };

  const pdfColumns = useMemo(
    () =>
      exportColumns.map((c) => ({
        key: c.key,
        header: c.columnPickerLabel || String(c.header || c.key),
        get: (r) => {
          if (c.key === 'date') return formatFinancialRecordDateTime(r, 'date');
          if (c.key === 'amount') return formatCurrency(r.amount);
          return r[c.key] ?? '';
        },
      })),
    [exportColumns]
  );

  const groupedPdfOpts = () => {
    const stamp = `${listParams.from}_${listParams.to}`;
    return {
      filename: `account-ledger_${stamp}.pdf`,
      title: 'Account Ledger',
      subtitle: `${accountName || 'Account'} · ${listParams.from} to ${listParams.to}`,
      columns: pdfColumns,
      groups: [
        { label: 'Dr', rows: drRows },
        { label: 'Cr', rows: crRows },
      ],
    };
  };

  const exportPdf = () => {
    if (!listParams) return;
    withExportPdfBusy(setExportBusy, async () => {
      await runGroupedPdfExport(groupedPdfOpts());
    });
  };

  const printPdf = () => {
    if (!listParams) return;
    withListPdfBusy(setExportBusy, async () => {
      await runGroupedPdfPrint(groupedPdfOpts());
    });
  };

  const breadcrumbs = useMemo(
    () => [
      { label: 'Dashboard', to: '/' },
      { label: 'Account Ledger', to: null },
    ],
    []
  );

  const tableDensityClass =
    '[&_.table]:!text-xs [&_th]:!text-[11px] [&_th]:!normal-case [&_th]:!tracking-normal [&_th]:!py-1.5 [&_th]:!px-2 [&_td]:!py-1.5 [&_td]:!px-2';

  return (
    <div
      className={`-mx-6 px-6 w-full min-w-0 max-w-none pb-2 text-xs text-gray-900 [&_.label]:text-xs [&_input]:text-xs [&_select]:text-xs [&_h1]:!text-base [&_h1]:!font-semibold ${tableDensityClass}`}
    >
      <PageHeader
        title="Account Ledger"
        breadcrumbs={breadcrumbs}
        actions={
          <ListPdfToolbarButtons
            busy={exportBusy}
            disabled={!listParams || isLoading}
            onPrint={printPdf}
            onExport={exportPdf}
          />
        }
      />

      <div className="card p-3 mb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-40">
              <Select
                label="Financial year"
                required
                value={fyValue}
                onChange={onFyChange}
                options={[
                  ...FY_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                  { value: FY_CUSTOM, label: 'Custom (use dates below)' },
                ]}
              />
            </div>
            <div className="min-w-[12rem] max-w-xs flex-1">
              <Select
                label="Accounts"
                required
                value={accountDraft}
                onChange={(e) => setAccountDraft(e.target.value)}
                options={[{ value: '', label: 'Select account…' }, ...accountOptions]}
              />
            </div>
            <div className="w-[8.5rem]">
              <Input label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-[8.5rem]">
              <Input label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button type="button" size="sm" onClick={runSearch} disabled={isFetching || !accountDraft.trim()}>
              <Search className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
              Search
            </Button>
            <TableColumnPicker {...pickerProps} />
          </div>
          {summary ? (
            <div className="text-xs space-y-1 lg:text-right shrink-0 border-t border-gray-100 lg:border-0 pt-2 lg:pt-0">
              <div>
                <span className="text-gray-600">From period: </span>
                <span className="text-brand font-medium tabular-nums">{formatDate(summary.from_period)}</span>
              </div>
              <div>
                <span className="text-gray-600">To period: </span>
                <span className="text-brand font-medium tabular-nums">{formatDate(summary.to_period)}</span>
              </div>
              <div>
                <span className="text-gray-600">Opening balance: </span>
                <span className={balanceClass(summary.opening_side)}>
                  {formatBalanceLabel(summary.opening_balance, summary.opening_side)}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Closing balance: </span>
                <span className={balanceClass(summary.closing_side)}>
                  {formatBalanceLabel(summary.closing_balance, summary.closing_side)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
        {meta?.row_limit ? (
          <p className="text-[11px] text-gray-500 mt-2">Up to {meta.row_limit} rows per side.</p>
        ) : null}
        {accountName && listParams ? (
          <p className="text-[11px] text-gray-600 mt-1">
            Ledger: <span className="font-medium text-gray-800">{accountName}</span>
          </p>
        ) : null}
      </div>

      <div className="card overflow-hidden border border-gray-200 xl:grid xl:grid-cols-2 xl:gap-0 divide-y xl:divide-y-0 xl:divide-x divide-gray-200">
        <div>
          <div className="bg-gray-50 border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-700">
            Dr Details
          </div>
          <DataTable
            embedded
            columns={visibleColumns}
            rows={drPaged.rows}
            loading={isLoading}
            emptyTitle="No debit rows"
            emptyMessage={listParams ? 'No movements on this side for the range.' : 'Select an account and click Search.'}
            rowKey="row_id"
            visibleCount={drPaged.visibleCount}
            totalCount={drPaged.total}
            page={drPaged.page}
            totalPages={drPaged.totalPages}
            countLabel="rows"
            onPreviousPage={() => setDrPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setDrPage((p) => p + 1)}
            disablePrevious={drPaged.page <= 1}
            disableNext={drPaged.page >= drPaged.totalPages}
            perPage={perPage}
            onPerPageChange={(n) => {
              setDrPage(1);
              setCrPage(1);
              setPerPage(n);
            }}
          />
          {listParams && summary ? (
            <div className="border-t border-gray-200 bg-gray-50 px-2 py-1.5 flex justify-between text-xs font-semibold text-gray-800">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(summary.period_dr_total)}</span>
            </div>
          ) : null}
        </div>
        <div>
          <div className="bg-gray-50 border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold text-gray-700">
            Cr Details
          </div>
          <DataTable
            embedded
            columns={visibleColumns}
            rows={crPaged.rows}
            loading={isLoading}
            emptyTitle="No credit rows"
            emptyMessage={listParams ? 'No movements on this side for the range.' : 'Select an account and click Search.'}
            rowKey="row_id"
            visibleCount={crPaged.visibleCount}
            totalCount={crPaged.total}
            page={crPaged.page}
            totalPages={crPaged.totalPages}
            countLabel="rows"
            onPreviousPage={() => setCrPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setCrPage((p) => p + 1)}
            disablePrevious={crPaged.page <= 1}
            disableNext={crPaged.page >= crPaged.totalPages}
            perPage={perPage}
            onPerPageChange={(n) => {
              setDrPage(1);
              setCrPage(1);
              setPerPage(n);
            }}
          />
          {listParams && summary ? (
            <div className="border-t border-gray-200 bg-gray-50 px-2 py-1.5 flex justify-between text-xs font-semibold text-gray-800">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(summary.period_cr_total)}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AccountLedger;
