import { useQuery } from '@tanstack/react-query';
import { formatCurrency, todayIndiaISODate, toLocalISODate } from '@wrs/shared';
import { Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { categoriesApi } from '../../lib/api/categories.js';
import { reportsApi } from '../../lib/api/reports.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import {
  fetchAllReportRows,
  omitPagination,
  runTablePdfExport,
  runTablePdfPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';

const today = () => todayIndiaISODate();
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalISODate(d);
};

const FROM_ID = 'product-performance-from';
const TO_ID = 'product-performance-to';
const SEARCH_ID = 'product-performance-search';

const SORT_BY_OPTIONS = [
  { value: 'total_earning', label: 'Total earning' },
  { value: 'total_rent', label: 'Total rent' },
  { value: 'booked_qty', label: 'Booked qty' },
  { value: 'sale_qty', label: 'Sale qty' },
  { value: 'total_discount', label: 'Total discount' },
  { value: 'stock', label: 'Stock' },
  { value: 'mrp', label: 'MRP' },
  { value: 'rent_price', label: 'Rent price' },
  { value: 'code', label: 'Code' },
  { value: 'product_name', label: 'Product name' },
  { value: 'category_name', label: 'Category' },
];

const SORT_DIR_OPTIONS = [
  { value: 'desc', label: 'High to low' },
  { value: 'asc', label: 'Low to high' },
];

/** Columns hidden until user enables them in the column picker. */
const PRODUCT_PERFORMANCE_DEFAULT_HIDDEN = ['mrp', 'total_discount'];

const ProductPerformance = () => {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [categoryId, setCategoryId] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('total_earning');
  const [sortDir, setSortDir] = useState('desc');
  const [exportBusy, setExportBusy] = useState(false);

  const reportFilterParams = useMemo(
    () => ({
      from,
      to,
      sort_by: sortBy,
      sort_dir: sortDir,
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    }),
    [from, to, categoryId, search, sortBy, sortDir]
  );

  const listParams = useMemo(
    () => ({
      ...reportFilterParams,
      page,
      per_page: perPage,
    }),
    [reportFilterParams, page, perPage]
  );

  const { data: res, isLoading, isFetching } = useQuery({
    queryKey: ['reports', 'product-performance', listParams],
    queryFn: () => reportsApi.productPerformance(listParams),
    keepPreviousData: true,
  });

  const payload = res?.data;
  const rows = payload?.rows ?? [];
  const meta = payload?.meta;
  const range = payload?.range;

  const { data: catRes } = useQuery({
    queryKey: ['categories', 'product', 'product-performance'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const categoryOptions = useMemo(() => {
    const raw = catRes?.data ?? catRes ?? [];
    const list = Array.isArray(raw) ? raw : [];
    return [
      { value: '', label: 'All categories' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.key || c.id })),
    ];
  }, [catRes]);

  const allColumns = useMemo(
    () => [
      {
        key: 'image',
        header: '',
        columnPickerLabel: 'Image',
        locked: true,
        width: 56,
        render: (r) => (
          <SmartImage
            src={r.main_image}
            alt={r.product_name || r.code || 'Product'}
            className="w-10 h-10 rounded bg-gray-50 object-contain border border-gray-100"
          />
        ),
      },
      {
        key: 'code',
        header: 'Code',
        columnPickerLabel: 'Code',
        locked: true,
        render: (r) => <span className="font-mono text-xs">{r.code}</span>,
      },
      {
        key: 'category_name',
        header: 'Category',
        columnPickerLabel: 'Category',
        render: (r) => (r.category_name ? r.category_name : 'Uncategorized'),
      },
      {
        key: 'product_name',
        header: 'Product name',
        columnPickerLabel: 'Product name',
        locked: true,
        render: (r) => <span className="font-medium">{r.product_name}</span>,
      },
      { key: 'stock', header: 'Stock', columnPickerLabel: 'Stock', align: 'right' },
      { key: 'booked_qty', header: 'Booked Qty', columnPickerLabel: 'Booked qty', align: 'right' },
      {
        key: 'mrp',
        header: 'MRP',
        columnPickerLabel: 'MRP',
        align: 'right',
        render: (r) => formatCurrency(r.mrp),
      },
      {
        key: 'rent_price',
        header: 'Rent Price',
        columnPickerLabel: 'Rent price',
        align: 'right',
        render: (r) => formatCurrency(r.rent_price),
      },
      {
        key: 'total_rent',
        header: 'Total Rent',
        columnPickerLabel: 'Total rent',
        align: 'right',
        render: (r) => formatCurrency(r.total_rent),
      },
      {
        key: 'total_discount',
        header: 'Total Discount',
        columnPickerLabel: 'Total discount',
        align: 'right',
        className: 'text-red-600 font-medium',
        render: (r) => formatCurrency(r.total_discount),
      },
      { key: 'sale_qty', header: 'Sale Qty', columnPickerLabel: 'Sale qty', align: 'right' },
      {
        key: 'total_earning',
        header: 'Total Earning',
        columnPickerLabel: 'Total earning',
        align: 'right',
        className: 'text-green-700 font-medium',
        render: (r) => formatCurrency(r.total_earning),
      },
    ],
    []
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns(
    'product-performance',
    allColumns,
    { defaultHidden: PRODUCT_PERFORMANCE_DEFAULT_HIDDEN }
  );

  const pdfColumns = useMemo(
    () =>
      exportColumns
        .filter((c) => c.key !== 'image')
        .map((c) => ({
          key: c.key,
          header: typeof c.header === 'string' ? c.header : c.key,
          get: (r) => {
            if (c.key === 'category_name') return r.category_name || 'Uncategorized';
            if (
              typeof r[c.key] === 'number' &&
              c.key !== 'stock' &&
              c.key !== 'booked_qty' &&
              c.key !== 'sale_qty'
            ) {
              return formatCurrency(r[c.key]);
            }
            return r[c.key] ?? '';
          },
        })),
    [exportColumns]
  );

  const buildTablePdfOpts = async () => {
    const exportRows = await fetchAllReportRows(
      reportsApi.productPerformance,
      omitPagination(reportFilterParams)
    );
    const subtitleParts = [`${from} to ${to}`];
    const categoryLabel = categoryOptions.find((o) => o.value === categoryId)?.label;
    if (categoryId && categoryLabel) subtitleParts.push(`Category: ${categoryLabel}`);
    if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
    const sortLabel = SORT_BY_OPTIONS.find((o) => o.value === sortBy)?.label;
    const dirLabel = SORT_DIR_OPTIONS.find((o) => o.value === sortDir)?.label;
    if (sortLabel && dirLabel) subtitleParts.push(`Sort: ${sortLabel} (${dirLabel})`);
    return {
      filename: `product_performance_${from}_${to}.pdf`,
      title: 'Product Performance',
      subtitle: subtitleParts.join(' · '),
      columns: pdfColumns,
      rows: exportRows,
    };
  };

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      await runTablePdfExport(await buildTablePdfOpts());
    });
  };

  const printPdf = () => {
    withListPdfBusy(setExportBusy, async () => {
      await runTablePdfPrint(await buildTablePdfOpts());
    });
  };

  const applySearch = () => {
    setSearch(searchDraft);
    setPage(1);
  };

  const totalPages = meta?.total_pages || 1;

  return (
    <>
      <PageHeader
        title="Product Performance"
        description={
          range
            ? `Rent and sale line totals by booking date (${range.from} to ${range.to}).`
            : 'Rent and sale line totals by booking date for each active product.'
        }
      />

      <div className="card relative z-10 p-3 mb-4 overflow-visible">
        <div className="flex flex-nowrap items-center gap-2 min-w-max">
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
          <div className="w-40 shrink-0 min-w-0">
            <Select
              label=""
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              options={categoryOptions}
            />
          </div>
          <div className="w-36 shrink-0 min-w-0">
            <Select
              label=""
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setPage(1);
              }}
              options={SORT_BY_OPTIONS}
            />
          </div>
          <div className="w-32 shrink-0 min-w-0">
            <Select
              label=""
              value={sortDir}
              onChange={(e) => {
                setSortDir(e.target.value);
                setPage(1);
              }}
              options={SORT_DIR_OPTIONS}
            />
          </div>
          <div className="w-44 shrink-0">
            <label htmlFor={SEARCH_ID} className="sr-only">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                id={SEARCH_ID}
                type="search"
                className="input w-full pl-8 text-xs py-1.5"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch();
                }}
                placeholder="Name or code"
              />
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={applySearch}>
            Apply
          </Button>
          <TableColumnPicker {...pickerProps} />
        </div>
      </div>

      <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
        <p className="text-xs text-gray-500">
          Sorted by {SORT_BY_OPTIONS.find((o) => o.value === sortBy)?.label || sortBy} (
          {SORT_DIR_OPTIONS.find((o) => o.value === sortDir)?.label || sortDir})
        </p>
        <ListPdfToolbarButtons
          busy={exportBusy}
          disabled={!from || !to || isLoading || isFetching}
          onPrint={printPdf}
          onExport={exportPdf}
        />
      </div>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={isLoading || isFetching}
        emptyTitle="No products in this shop"
        rowKey="id"
        visibleCount={rows.length}
        totalCount={meta?.total ?? 0}
        page={meta?.page ?? page}
        totalPages={totalPages}
        countLabel="products"
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
    </>
  );
};

export default ProductPerformance;
