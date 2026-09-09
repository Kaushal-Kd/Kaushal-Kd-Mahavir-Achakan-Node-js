import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import { Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { reportsApi } from '../../lib/api/reports.js';
import { paginateClientRows } from '../../lib/tableListMeta.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import ConditionDepositReconciliation from './ConditionDepositReconciliation.jsx';
import {
  runTablePdfExport,
  runTablePdfPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';

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

const TrialBalance = () => {
  const defaultFy = FY_OPTIONS[0] || { from: '2026-04-01', to: '2027-03-31' };
  const [fyValue, setFyValue] = useState(String(currentIndianFyStartYear()));
  const [from, setFrom] = useState(defaultFy.from);
  const [to, setTo] = useState(defaultFy.to);
  const [searchDraft, setSearchDraft] = useState('');
  const [applied, setApplied] = useState({ from: '', to: '', search: '' });
  const [exportBusy, setExportBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);

  const listParams = useMemo(() => {
    if (!applied.from || !applied.to) return null;
    return { from: applied.from, to: applied.to };
  }, [applied]);

  const { data: res, isLoading, isFetching } = useQuery({
    queryKey: ['reports', 'trial-balance', listParams],
    queryFn: () => reportsApi.trialBalance(listParams),
    enabled: Boolean(listParams),
  });

  const payload = res?.data;
  const summary = payload?.summary;
  const rowsRaw = payload?.rows;

  const displayRows = useMemo(() => {
    const allRows = Array.isArray(rowsRaw) ? rowsRaw : [];
    const q = applied.search.trim().toLowerCase();
    if (!q) return allRows.map((r) => ({ ...r, row_id: r.account_id }));
    return allRows
      .filter((r) => String(r.account_name || '').toLowerCase().includes(q) || String(r.account_id || '').toLowerCase().includes(q))
      .map((r) => ({ ...r, row_id: r.account_id }));
  }, [rowsRaw, applied.search]);

  const clientPage = useMemo(
    () => paginateClientRows(displayRows, page, perPage),
    [displayRows, page, perPage]
  );

  const allColumns = useMemo(
    () => [
      {
        key: 'account_name',
        header: 'Account Name',
        columnPickerLabel: 'Account Name',
        className: 'text-xs font-medium text-gray-900',
      },
      {
        key: 'opening_balance',
        header: 'Opening Balance',
        columnPickerLabel: 'Opening Balance',
        align: 'right',
        className: 'text-xs',
        render: (r) => (
          <span className={balanceClass(r.opening_side)}>{formatBalanceLabel(r.opening_balance, r.opening_side)}</span>
        ),
      },
      {
        key: 'curr_dr',
        header: 'Curr. Dr.',
        columnPickerLabel: 'Curr. Dr.',
        align: 'right',
        width: '120px',
        className: 'text-xs tabular-nums text-brand font-medium',
        render: (r) => formatCurrency(r.curr_dr),
      },
      {
        key: 'curr_cr',
        header: 'Curr. Cr.',
        columnPickerLabel: 'Curr. Cr.',
        align: 'right',
        width: '120px',
        className: 'text-xs tabular-nums text-brand font-medium',
        render: (r) => formatCurrency(r.curr_cr),
      },
      {
        key: 'closing_balance',
        header: 'Closing Balance',
        columnPickerLabel: 'Closing Balance',
        align: 'right',
        className: 'text-xs',
        render: (r) => (
          <span className={balanceClass(r.closing_side)}>{formatBalanceLabel(r.closing_balance, r.closing_side)}</span>
        ),
      },
    ],
    []
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns('trial-balance', allColumns);

  const runSearch = () => {
    setPage(1);
    setApplied({ from, to, search: searchDraft.trim() });
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
          if (c.key === 'opening_balance') return formatBalanceLabel(r.opening_balance, r.opening_side);
          if (c.key === 'curr_dr') return formatCurrency(r.curr_dr);
          if (c.key === 'curr_cr') return formatCurrency(r.curr_cr);
          if (c.key === 'closing_balance') return formatBalanceLabel(r.closing_balance, r.closing_side);
          return r[c.key] ?? '';
        },
      })),
    [exportColumns]
  );

  const tablePdfOpts = () => {
    const stamp = `${listParams.from}_${listParams.to}`;
    const subtitleParts = [`${listParams.from} to ${listParams.to}`];
    if (applied.search.trim()) subtitleParts.push(`Search: ${applied.search.trim()}`);
    return {
      filename: `trial-balance_${stamp}.pdf`,
      title: 'Trial Balance',
      subtitle: subtitleParts.join(' · '),
      columns: pdfColumns,
      rows: displayRows,
    };
  };

  const exportPdf = () => {
    if (!listParams) return;
    withExportPdfBusy(setExportBusy, async () => {
      await runTablePdfExport(tablePdfOpts());
    });
  };

  const printPdf = () => {
    if (!listParams) return;
    withListPdfBusy(setExportBusy, async () => {
      await runTablePdfPrint(tablePdfOpts());
    });
  };

  const breadcrumbs = useMemo(
    () => [
      { label: 'Dashboard', to: '/' },
      { label: 'Trial Balance', to: null },
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
        title="Trial Balance"
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
            <div className="w-[8.5rem]">
              <Input label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="w-[8.5rem]">
              <Input label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="min-w-0 flex-1 basis-0 max-w-xs">
              <Input
                label="Search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="Filter by account name…"
              />
            </div>
            <Button type="button" size="sm" onClick={runSearch} disabled={isFetching}>
              <Search className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
              Search
            </Button>
            <TableColumnPicker {...pickerProps} />
          </div>
          {summary && listParams ? (
            <div className="text-xs space-y-1 lg:text-right shrink-0 border-t border-gray-100 lg:border-0 pt-2 lg:pt-0">
              <div>
                <span className="text-gray-600">Curr. Dr.: </span>
                <span className="text-brand font-semibold tabular-nums">{formatCurrency(summary.total_curr_dr)}</span>
              </div>
              <div>
                <span className="text-gray-600">Curr. Cr.: </span>
                <span className="text-brand font-semibold tabular-nums">{formatCurrency(summary.total_curr_cr)}</span>
              </div>
              <div>
                <span className="text-gray-600">Opening balance: </span>
                <span className={balanceClass(summary.opening_net_side)}>
                  {formatBalanceLabel(summary.opening_net_amount, summary.opening_net_side)}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Closing balance: </span>
                <span className={balanceClass(summary.closing_net_side)}>
                  {formatBalanceLabel(summary.closing_net_amount, summary.closing_net_side)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
        {listParams ? (
          <p className="text-[11px] text-gray-500 mt-2">
            From {formatDate(listParams.from)} to {formatDate(listParams.to)}
            {applied.search ? ` · filtered by “${applied.search}”` : ''}
          </p>
        ) : (
          <p className="text-[11px] text-gray-500 mt-2">Set dates and click Search to load the trial balance.</p>
        )}
      </div>

      <div className="card overflow-hidden border border-gray-200">
        <DataTable
          embedded
          columns={visibleColumns}
          rows={clientPage.rows}
          loading={isLoading}
          emptyTitle="No rows"
          emptyMessage={listParams ? 'No accounts match the filter.' : 'Run Search to load data.'}
          rowKey="row_id"
          visibleCount={clientPage.visibleCount}
          totalCount={clientPage.total}
          page={clientPage.page}
          totalPages={clientPage.totalPages}
          countLabel="accounts"
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
          disablePrevious={clientPage.page <= 1}
          disableNext={clientPage.page >= clientPage.totalPages}
          perPage={perPage}
          onPerPageChange={(n) => {
            setPage(1);
            setPerPage(n);
          }}
        />
      </div>
      {listParams && <ConditionDepositReconciliation data={payload?.condition_deposits} from={listParams.from} to={listParams.to} />}
    </div>
  );
};

export default TrialBalance;
