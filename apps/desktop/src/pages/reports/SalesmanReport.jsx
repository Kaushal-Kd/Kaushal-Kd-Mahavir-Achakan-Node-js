import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import { useMemo, useState } from 'react';

import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { reportsApi } from '../../lib/api/reports.js';
import { usersApi } from '../../lib/api/users.js';
import {
  runTablePdfExport,
  runTablePdfPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthDateRange = (month) => {
  const [year, monthNumber] = String(month).split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const prefix = `${year}-${String(monthNumber).padStart(2, '0')}`;
  return { from: `${prefix}-01`, to: `${prefix}-${String(lastDay).padStart(2, '0')}` };
};

const TYPE_OPTIONS = [
  { value: 'booking', label: 'Booking' },
  { value: 'sale', label: 'Sale' },
];

function rowKey(r) {
  if (r._is_total) return 'total';
  return `${r.sales_person_id || 'none'}_${r.bill_date}`;
}

const SalesmanReport = () => {
  const [month, setMonth] = useState(currentMonth);
  const initialRange = useMemo(() => monthDateRange(currentMonth()), []);
  const [dateMode, setDateMode] = useState('month');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [reportType, setReportType] = useState('booking');
  const [salesPersonId, setSalesPersonId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

  const validDateSelection =
    dateMode === 'month' ? Boolean(month) : Boolean(from && to && from <= to);

  const listParams = useMemo(
    () => ({
      ...(dateMode === 'month' ? { month } : { from, to }),
      type: reportType,
      ...(salesPersonId ? { sales_person_id: salesPersonId } : {}),
      ...(reportType === 'booking' && categoryId ? { category_id: categoryId } : {}),
    }),
    [dateMode, month, from, to, reportType, salesPersonId, categoryId]
  );

  const {
    data: res,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['reports', 'salesman', listParams],
    queryFn: () => reportsApi.salesman(listParams),
    enabled: validDateSelection,
    keepPreviousData: true,
  });

  const payload = res?.data;
  const rawRows = payload?.rows ?? [];
  const summary = payload?.summary;
  const range = payload?.range;

  const { data: usersRes } = useQuery({
    queryKey: ['users', 'salesman-report'],
    queryFn: () => usersApi.list({ per_page: 200, is_active: 'true' }),
    staleTime: 60_000,
  });

  const salesmanOptions = useMemo(() => {
    const list = usersRes?.data || [];
    return [
      { value: '', label: 'All salesmen' },
      { value: 'none', label: 'Unassigned' },
      ...list
        .filter((u) => u.is_active !== false && u.role === 'salesman')
        .map((u) => ({
          value: u.id,
          label: String(u.name || u.email || 'User').trim(),
        })),
    ];
  }, [usersRes]);

  const { data: catRes } = useQuery({
    queryKey: ['categories', 'product', 'salesman-report'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
    enabled: reportType === 'booking',
  });

  const categoryOptions = useMemo(() => {
    const raw = catRes?.data ?? catRes ?? [];
    const list = Array.isArray(raw) ? raw : [];
    return [
      { value: '', label: 'Categories' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.key || c.id })),
    ];
  }, [catRes]);

  const sortedRows = useMemo(() => {
    const copy = [...rawRows];
    copy.sort((a, b) => {
      const dateCmp = String(a.bill_date || '').localeCompare(String(b.bill_date || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(a.salesman_name || '').localeCompare(String(b.salesman_name || ''));
    });
    return copy;
  }, [rawRows]);

  const tableRows = useMemo(() => {
    if (!summary || sortedRows.length === 0) return sortedRows;
    return [
      ...sortedRows,
      {
        _is_total: true,
        sales_person_id: null,
        salesman_name: 'Total',
        bill_date: null,
        bill_count: summary.bill_count,
        product_count: summary.product_count,
        product_amount: summary.product_amount,
        accessory_count: summary.accessory_count,
        accessory_amount: summary.accessory_amount,
        bill_discount: summary.bill_discount,
        item_discount: summary.item_discount,
        total_amount: summary.total_amount,
        commission_amount: summary.commission_amount,
      },
    ];
  }, [sortedRows, summary]);

  const allColumns = useMemo(
    () => [
      {
        key: 'salesman_name',
        header: 'Salesman Name',
        columnPickerLabel: 'Salesman Name',
        render: (r) => (
          <span className={r._is_total ? 'font-bold text-gray-900' : 'font-medium'}>
            {r.salesman_name || '—'}
          </span>
        ),
      },
      {
        key: 'accessory_count',
        header: 'Accessory Count',
        columnPickerLabel: 'Accessory Count',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold' : ''}>{r.accessory_count ?? 0}</span>
        ),
      },
      {
        key: 'accessory_amount',
        header: 'Accessory Amt.',
        columnPickerLabel: 'Accessory Amt.',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold' : ''}>
            {formatCurrency(r.accessory_amount)}
          </span>
        ),
      },
      {
        key: 'bill_date',
        header: 'Bill Date',
        columnPickerLabel: 'Bill Date',
        render: (r) => (r._is_total ? 'N/A' : formatDate(r.bill_date) || '—'),
      },
      {
        key: 'bill_count',
        header: 'No. of Bill',
        columnPickerLabel: 'No. of Bill',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold' : ''}>{r.bill_count ?? '—'}</span>
        ),
      },
      {
        key: 'product_count',
        header: 'No. of Product',
        columnPickerLabel: 'No. of Product',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold' : ''}>{r.product_count ?? '—'}</span>
        ),
      },
      {
        key: 'product_amount',
        header: 'Product Amt.',
        columnPickerLabel: 'Product Amt.',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold' : ''}>{formatCurrency(r.product_amount)}</span>
        ),
      },
      {
        key: 'bill_discount',
        header: 'Bill Discount',
        columnPickerLabel: 'Bill Discount',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold text-red-600' : 'text-red-600'}>
            {formatCurrency(r.bill_discount)}
          </span>
        ),
      },
      {
        key: 'item_discount',
        header: 'Item Discount',
        columnPickerLabel: 'Item Discount',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold text-red-600' : 'text-red-600'}>
            {formatCurrency(r.item_discount)}
          </span>
        ),
      },
      {
        key: 'total_amount',
        header: 'Total Amount',
        columnPickerLabel: 'Total Amount',
        align: 'right',
        render: (r) => (
          <span className={r._is_total ? 'font-bold text-gray-900' : 'font-semibold'}>
            {formatCurrency(r.total_amount)}
          </span>
        ),
      },
      {
        key: 'commission_amount',
        header: 'Commission',
        columnPickerLabel: 'Commission',
        align: 'right',
        render: (r) => (
          <div className={r._is_total ? 'font-bold text-gray-900' : 'font-semibold'}>
            {formatCurrency(r.commission_amount)}
            {!r._is_total && r.commission_basis ? (
              <div className="text-[10px] font-normal text-gray-400">
                {formatCurrency(r.commission_rate)} / {r.commission_basis}
              </div>
            ) : null}
          </div>
        ),
      },
    ],
    []
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns(
    'salesman-report',
    allColumns
  );

  const pdfColumns = useMemo(
    () =>
      exportColumns.map((c) => ({
        key: c.key,
        header: c.columnPickerLabel || String(c.header || c.key),
        get: (r) => {
          if (c.key === 'bill_date') return r._is_total ? 'N/A' : formatDate(r.bill_date);
          if (c.key === 'product_amount') return formatCurrency(r.product_amount);
          if (c.key === 'accessory_amount') return formatCurrency(r.accessory_amount);
          if (c.key === 'bill_discount') return formatCurrency(r.bill_discount);
          if (c.key === 'item_discount') return formatCurrency(r.item_discount);
          if (c.key === 'total_amount') return formatCurrency(r.total_amount);
          if (c.key === 'commission_amount') return formatCurrency(r.commission_amount);
          return r[c.key] ?? '';
        },
      })),
    [exportColumns]
  );

  const monthLabel = useMemo(() => {
    if (!month) return '';
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  }, [month]);

  const dateLabel = dateMode === 'month' ? monthLabel || month : `${from} to ${to}`;

  const tablePdfOpts = () => {
    const subtitleParts = [dateLabel, reportType === 'sale' ? 'Sale' : 'Booking'];
    const salesmanLabel = salesmanOptions.find((o) => o.value === salesPersonId)?.label;
    if (salesPersonId && salesmanLabel) subtitleParts.push(`Salesman: ${salesmanLabel}`);
    const categoryLabel = categoryOptions.find((o) => o.value === categoryId)?.label;
    if (reportType === 'booking' && categoryId && categoryLabel) {
      subtitleParts.push(`Category: ${categoryLabel}`);
    }
    return {
      filename: `salesman_${reportType}_${dateMode === 'month' ? month : `${from}_${to}`}.pdf`,
      title: 'Salesman Report',
      subtitle: subtitleParts.join(' · '),
      columns: pdfColumns,
      rows: tableRows,
    };
  };

  const exportPdf = () => {
    if (!validDateSelection) return;
    withExportPdfBusy(setExportBusy, async () => {
      await runTablePdfExport(tablePdfOpts());
    });
  };

  const printPdf = () => {
    if (!validDateSelection) return;
    withListPdfBusy(setExportBusy, async () => {
      await runTablePdfPrint(tablePdfOpts());
    });
  };

  return (
    <>
      <PageHeader
        title="Salesman"
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Salesman' }]}
        description={
          range
            ? `${reportType === 'sale' ? 'Sale' : 'Booking'} report for ${dateLabel} (${range.from} to ${range.to}).`
            : 'Daily salesman performance by booking or sale.'
        }
      />

      <div className="card relative z-10 px-3 py-2 mb-3 overflow-x-auto">
        <div className="flex flex-nowrap items-center gap-2 min-w-max">
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap">
              Salesman
            </span>
            <select
              className="input w-36 min-w-0 text-xs py-1.5 pr-7 bg-surface"
              value={salesPersonId}
              onChange={(e) => setSalesPersonId(e.target.value)}
            >
              {salesmanOptions.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap">Dates</span>
            <select
              className="input w-28 min-w-0 text-xs py-1.5 pr-7 bg-surface"
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value)}
            >
              <option value="month">Month</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {dateMode === 'month' ? (
            <input
              type="month"
              aria-label="Report month"
              className="input w-[8.5rem] min-w-0 text-xs py-1.5 bg-surface"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          ) : (
            <>
              <input
                type="date"
                aria-label="From date"
                className="input w-32 min-w-0 text-xs py-1.5 bg-surface"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                aria-label="To date"
                className="input w-32 min-w-0 text-xs py-1.5 bg-surface"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </>
          )}
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap">Type</span>
            <select
              className="input w-24 min-w-0 text-xs py-1.5 pr-7 bg-surface"
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value);
                if (e.target.value === 'sale') setCategoryId('');
              }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {reportType === 'booking' ? (
            <label className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap">
                Categories
              </span>
              <select
                className="input w-36 min-w-0 text-xs py-1.5 pr-7 bg-surface"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                {categoryOptions.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <TableColumnPicker {...pickerProps} />
          <ListPdfToolbarButtons
            className="shrink-0 ml-1"
            busy={exportBusy}
            disabled={!validDateSelection || isLoading || isFetching}
            onPrint={printPdf}
            onExport={exportPdf}
          />
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={tableRows}
        loading={isLoading || isFetching}
        emptyTitle="No Record Found"
        emptyMessage="No salesman activity for the selected dates and filters."
        rowKey={rowKey}
        getRowClassName={(r) => (r._is_total ? 'bg-gray-100 font-semibold' : '')}
        visibleCount={tableRows.length}
        totalCount={tableRows.length}
        countLabel="rows"
      />
    </>
  );
};

export default SalesmanReport;
