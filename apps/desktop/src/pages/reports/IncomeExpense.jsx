import { useQuery } from '@tanstack/react-query';
import {
  formatCurrency,
  formatDate,
  INCOME_EXPENSE_DATE_BASIS_OPTIONS,
  INCOME_EXPENSE_TRANSACTION_TYPE_OPTIONS,
} from '@wrs/shared';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useMemo, useState, useEffect } from 'react';

import {
  runGroupedPdfExport,
  runGroupedPdfPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';

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
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';

const COLUMN_DEFS = [
  { key: 'date', header: 'Date & Time', width: '120px' },
  { key: 'bill_no', header: 'Bill No', width: '108px' },
  { key: 'name', header: 'Name' },
  { key: 'details', header: 'Details' },
  { key: 'payment_account', header: 'Payment' },
  { key: 'booking_date', header: 'Booking', width: '96px' },
  { key: 'pickup_date', header: 'Delivery', width: '96px' },
  { key: 'return_date', header: 'Return', width: '96px' },
  { key: 'amount', header: 'Amount', align: 'right', width: '108px' },
];

const ORDER_DATE_COLUMN_KEYS = ['booking_date', 'pickup_date', 'return_date'];

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

function withRowIds(rows) {
  return (rows || []).map((r) => ({
    ...r,
    row_id: `${r.source}_${r.source_id}`,
  }));
}

const IncomeExpense = () => {
  const defaultFy = FY_OPTIONS[0] || { from: '2026-04-01', to: '2027-03-31' };
  const [fyValue, setFyValue] = useState(String(currentIndianFyStartYear()));
  const [from, setFrom] = useState(defaultFy.from);
  const [to, setTo] = useState(defaultFy.to);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [dateBasisDraft, setDateBasisDraft] = useState('payment');
  const [dateBasis, setDateBasis] = useState('payment');
  const [paymentAccountDraft, setPaymentAccountDraft] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [transactionTypeDraft, setTransactionTypeDraft] = useState('all');
  const [transactionType, setTransactionType] = useState('all');
  const [sortDirDraft, setSortDirDraft] = useState('desc');
  const [sortDir, setSortDir] = useState('desc');
  const [exportBusy, setExportBusy] = useState(false);
  const [tab, setTab] = useState('income');
  const [incomePage, setIncomePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);

  const accountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });

  const paymentAccountOptions = useMemo(() => {
    const raw = accountsQuery.data?.data;
    const list = Array.isArray(raw) ? [...raw] : [];
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return [
      { value: '', label: 'All accounts' },
      ...list
        .filter((a) => a.is_active !== false)
        .map((a) => ({ value: a.id, label: a.name || a.id })),
    ];
  }, [accountsQuery.data?.data]);

  const listParams = useMemo(() => {
    const p = {
      from,
      to,
      date_basis: dateBasis,
      transaction_type: transactionType,
      sort_dir: sortDir,
    };
    if (search.trim()) p.search = search.trim();
    if (paymentAccountId.trim()) p.payment_account_id = paymentAccountId.trim();
    return p;
  }, [from, to, search, dateBasis, paymentAccountId, transactionType, sortDir]);

  const {
    data: res,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['reports', 'income-expense', listParams],
    queryFn: () => reportsApi.incomeExpense(listParams),
  });

  const payload = res?.data;
  const visibleSummary = payload?.summary;
  const range = payload?.range;
  const meta = payload?.meta;
  const incomeRows = useMemo(() => withRowIds(payload?.income_rows), [payload?.income_rows]);
  const expenseRows = useMemo(() => withRowIds(payload?.expense_rows), [payload?.expense_rows]);
  const incomePaged = useMemo(
    () => paginateClientRows(incomeRows, incomePage, perPage),
    [incomeRows, incomePage, perPage]
  );
  const expensePaged = useMemo(
    () => paginateClientRows(expenseRows, expensePage, perPage),
    [expenseRows, expensePage, perPage]
  );
  const allColumns = useMemo(
    () =>
      COLUMN_DEFS.map((c) => {
        const base = { ...c, columnPickerLabel: c.header };
        if (c.key === 'date') {
          return {
            ...base,
            className: 'text-xs whitespace-nowrap tabular-nums',
            render: (r) => formatFinancialRecordDateTime(r, 'date'),
          };
        }
        if (ORDER_DATE_COLUMN_KEYS.includes(c.key)) {
          return {
            ...base,
            className: 'text-xs whitespace-nowrap',
            render: (r) => (r[c.key] ? formatDate(r[c.key]) : '—'),
          };
        }
        if (c.key === 'amount') {
          return {
            ...base,
            className: 'text-xs tabular-nums',
            render: (r) => formatCurrency(r.amount),
          };
        }
        if (c.key === 'bill_no') {
          return {
            ...base,
            className: 'text-xs whitespace-nowrap',
            render: (r) => (
              <TransactionBillLink
                orderId={r.order_id}
                saleId={r.sale_id}
                purchaseId={r.purchase_id}
                voucherId={
                  r.voucher_id ||
                  (['payment_voucher', 'receipt_voucher'].includes(r.source) ? r.source_id : null)
                }
                referenceKind={r.reference_kind || r.source}
                billKind={r.bill_kind}
                linkedBillId={r.linked_bill_id}
              >
                {r.bill_no || '—'}
              </TransactionBillLink>
            ),
          };
        }
        return {
          ...base,
          className: 'text-xs',
          render: (r) => r[c.key] ?? '—',
        };
      }),
    []
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns(
    'income-expense',
    allColumns,
    {
      defaultHidden: ORDER_DATE_COLUMN_KEYS,
    }
  );

  const applyFilters = () => {
    setIncomePage(1);
    setExpensePage(1);
    setSearch(searchDraft.trim());
    setDateBasis(dateBasisDraft);
    setPaymentAccountId(paymentAccountDraft);
    setTransactionType(transactionTypeDraft);
    setSortDir(sortDirDraft);
  };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchDraft.trim();
      setSearch((prev) => {
        if (prev === next) return prev;
        setIncomePage(1);
        setExpensePage(1);
        return next;
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [searchDraft]);

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
          if (ORDER_DATE_COLUMN_KEYS.includes(c.key)) {
            return r[c.key] ? formatDate(r[c.key]) : '';
          }
          if (c.key === 'amount') return formatCurrency(r.amount);
          return r[c.key] ?? '';
        },
      })),
    [exportColumns]
  );

  const groupedPdfOpts = () => {
    const stamp = `${from}_${to}`;
    const subtitleParts = [`${from} to ${to}`];
    const dateBasisLabel = INCOME_EXPENSE_DATE_BASIS_OPTIONS.find(
      (o) => o.value === dateBasis
    )?.label;
    if (dateBasisLabel && dateBasis !== 'payment') subtitleParts.push(`Date by: ${dateBasisLabel}`);
    const txLabel = INCOME_EXPENSE_TRANSACTION_TYPE_OPTIONS.find(
      (o) => o.value === transactionType
    )?.label;
    if (txLabel && transactionType !== 'all') subtitleParts.push(`Type: ${txLabel}`);
    if (paymentAccountId.trim()) {
      const acct = paymentAccountOptions.find((o) => o.value === paymentAccountId);
      if (acct?.label) subtitleParts.push(`Account: ${acct.label}`);
    }
    if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
    return {
      filename: `income-expense_${stamp}.pdf`,
      title: 'Incomes & Expenses',
      subtitle: subtitleParts.join(' · '),
      columns: pdfColumns,
      groups: [
        { label: 'Income', rows: incomeRows },
        { label: 'Expense', rows: expenseRows },
      ],
    };
  };

  const exportPdf = () => {
    if (!from || !to) return;
    withExportPdfBusy(setExportBusy, async () => {
      await runGroupedPdfExport(groupedPdfOpts());
    });
  };

  const printPdf = () => {
    if (!from || !to) return;
    withListPdfBusy(setExportBusy, async () => {
      await runGroupedPdfPrint(groupedPdfOpts());
    });
  };

  const breadcrumbs = useMemo(
    () => [
      { label: 'Dashboard', to: '/' },
      { label: 'Incomes & Expenses', to: null },
    ],
    []
  );

  const tableDensityClass =
    '[&_.table]:!text-xs [&_th]:!text-[11px] [&_th]:!normal-case [&_th]:!tracking-normal [&_th]:!py-1.5 [&_th]:!px-2 [&_td]:!py-1.5 [&_td]:!px-2';

  const isIncomeTab = tab === 'income';
  const activePaged = isIncomeTab ? incomePaged : expensePaged;

  return (
    <div
      className={`-mx-6 px-6 w-full min-w-0 max-w-none pb-2 text-xs text-gray-900 [&_.label]:text-xs [&_input]:text-xs [&_select]:text-xs [&_h1]:!text-base [&_h1]:!font-semibold ${tableDensityClass}`}
    >
      <PageHeader
        title="Incomes & Expenses"
        breadcrumbs={breadcrumbs}
        actions={
          <ListPdfToolbarButtons
            busy={exportBusy}
            disabled={!from || !to || isLoading || isFetching}
            onPrint={printPdf}
            onExport={exportPdf}
          />
        }
      />

      <div className="card p-3 mb-3 space-y-1.5 min-w-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 items-end min-w-0">
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
          <Select
            label="Date by"
            value={dateBasisDraft}
            onChange={(e) => setDateBasisDraft(e.target.value)}
            options={INCOME_EXPENSE_DATE_BASIS_OPTIONS}
          />
          <Input
            label="From date"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <Select
            label="Payment account"
            value={paymentAccountDraft}
            onChange={(e) => setPaymentAccountDraft(e.target.value)}
            options={paymentAccountOptions}
          />
          <Select
            label="Transaction type"
            value={transactionTypeDraft}
            onChange={(e) => {
              const nextType = e.target.value;
              setTransactionTypeDraft(nextType);
              setTransactionType(nextType);
              setIncomePage(1);
              setExpensePage(1);
            }}
            options={INCOME_EXPENSE_TRANSACTION_TYPE_OPTIONS}
          />
          <Select
            label="Date sorting"
            value={sortDirDraft}
            onChange={(e) => setSortDirDraft(e.target.value)}
            options={[
              { value: 'asc', label: 'Oldest to newest' },
              { value: 'desc', label: 'Newest to oldest' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end min-w-0">
          <div className="min-w-0 flex-1">
            <Input
              label="Search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              placeholder="Bill no, name, details, payment…"
            />
          </div>
          <div className="flex shrink-0 items-end gap-2">
            <Button type="button" size="sm" className="shrink-0" onClick={applyFilters}>
              <Search className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
              Apply filters
            </Button>
            <TableColumnPicker {...pickerProps} iconOnly menuAlign="end" />
          </div>
        </div>
        <p className="text-[11px] text-gray-500 leading-snug">
          Search filters the table as you type, and transaction type applies immediately. Use Apply
          filters for date basis, payment account, and date sorting. Booking / delivery / return
          date applies to order, sale, and purchase payments; entries and vouchers use entry date.
          Booked / Delivered / Returned payment filters match the BOOKING status shown in Details.
          {meta?.row_limit
            ? ` Up to ${meta.row_limit} rows per side (${sortDir === 'asc' ? 'oldest' : 'newest'} first). Totals include all matching records.`
            : ''}
        </p>
      </div>

      {visibleSummary ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          <SummaryCard
            variant="income"
            cash={visibleSummary.income_cash}
            bank={visibleSummary.income_bank}
            total={visibleSummary.income_total}
            damageMissingTotal={visibleSummary.damage_missing_income_total}
          />
          <SummaryCard
            variant="expense"
            cash={visibleSummary.expense_cash}
            bank={visibleSummary.expense_bank}
            total={visibleSummary.expense_total}
          />
          <div className="card p-3 flex flex-col justify-center">
            <div className="text-[11px] font-medium text-gray-600">Profit</div>
            <div className="text-base font-semibold text-green-700 tabular-nums">
              {formatCurrency(visibleSummary.profit)}
            </div>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden border border-gray-200">
        <div className="flex border-b border-gray-200">
          <ReportTabButton active={isIncomeTab} onClick={() => setTab('income')} label="Income" />
          <ReportTabButton
            active={!isIncomeTab}
            onClick={() => setTab('expense')}
            label="Expense"
          />
        </div>
        <DataTable
          embedded
          columns={visibleColumns}
          rows={activePaged.rows}
          loading={isLoading}
          emptyTitle={isIncomeTab ? 'No income rows' : 'No expense rows'}
          emptyMessage="Try another date range or clear the search filter."
          rowKey="row_id"
          visibleCount={activePaged.visibleCount}
          totalCount={activePaged.total}
          page={activePaged.page}
          totalPages={activePaged.totalPages}
          countLabel="rows"
          onPreviousPage={() =>
            isIncomeTab
              ? setIncomePage((p) => Math.max(1, p - 1))
              : setExpensePage((p) => Math.max(1, p - 1))
          }
          onNextPage={() =>
            isIncomeTab ? setIncomePage((p) => p + 1) : setExpensePage((p) => p + 1)
          }
          disablePrevious={activePaged.page <= 1}
          disableNext={activePaged.page >= activePaged.totalPages}
          perPage={perPage}
          onPerPageChange={(n) => {
            setIncomePage(1);
            setExpensePage(1);
            setPerPage(n);
          }}
        />
      </div>
    </div>
  );
};

const ReportTabButton = ({ active, onClick, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={clsx(
      'px-3 py-2 text-xs font-medium border-b-2 transition',
      active
        ? 'border-brand text-brand bg-white'
        : 'border-transparent text-gray-500 hover:text-gray-800'
    )}
  >
    {label}
  </button>
);

ReportTabButton.propTypes = {
  active: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
};

function SummaryCard({ variant, cash, bank, total, damageMissingTotal }) {
  const isIncome = variant === 'income';
  const showDamage = isIncome && Number(damageMissingTotal || 0) > 0;
  return (
    <div className="card p-3">
      <dl className="space-y-0.5 text-xs leading-snug">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-800">{isIncome ? 'Cash Income:' : 'Cash Expense:'}</dt>
          <dd className={`tabular-nums font-medium ${isIncome ? 'text-green-700' : 'text-brand'}`}>
            {formatCurrency(cash)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-800">{isIncome ? 'Bank Income:' : 'Bank Expense:'}</dt>
          <dd className={`tabular-nums font-medium ${isIncome ? 'text-brand' : 'text-green-700'}`}>
            {formatCurrency(bank)}
          </dd>
        </div>
        {showDamage ? (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-800">Damage / missing:</dt>
            <dd className="tabular-nums font-medium text-gray-900">
              {formatCurrency(damageMissingTotal)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-2 pt-0.5 border-t border-gray-100">
          <dt className="text-gray-900 font-medium">Total:</dt>
          <dd
            className={`tabular-nums font-semibold ${isIncome ? 'text-green-700' : 'text-brand'}`}
          >
            {formatCurrency(total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

SummaryCard.propTypes = {
  variant: PropTypes.oneOf(['income', 'expense']).isRequired,
  cash: PropTypes.number,
  bank: PropTypes.number,
  total: PropTypes.number,
  damageMissingTotal: PropTypes.number,
};

SummaryCard.defaultProps = {
  cash: 0,
  bank: 0,
  total: 0,
  damageMissingTotal: 0,
};

IncomeExpense.propTypes = {};

export default IncomeExpense;
