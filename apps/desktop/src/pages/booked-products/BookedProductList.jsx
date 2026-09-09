import { useQuery } from '@tanstack/react-query';
import {
  BOOKED_PRODUCT_BUCKET_LABELS,
  formatCurrency,
  formatDate,
  ORDER_STATUS_LABELS,
  orderStatusToBookedProductBucket,
} from '@wrs/shared';
import { FileSpreadsheet, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { bookedProductsApi } from '../../lib/api/bookedProducts.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { downloadCsv } from '../../utils/csv.js';

/** Badge tone by filter bucket (not granular order status). */
const BUCKET_BADGE_TONE = {
  booked: 'yellow',
  delivered: 'green',
  returned: 'gray',
  cancelled: 'red',
};

const STATUS_BUCKET_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'booked', label: 'Booked' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Default: bill, customer, code, product, delivery date, status. */
const BOOKED_PRODUCT_LIST_DEFAULT_HIDDEN = ['customer_phone', 'rent', 'qty', 'return_date'];

const BookedProductList = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      sort: '-o.pickup_date',
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(categoryId ? { category_id: categoryId } : {}),
      ...(status ? { status } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [page, perPage, search, categoryId, status, from, to]
  );

  const { data, isLoading } = useQuery({
    queryKey: ['booked-products', listParams],
    queryFn: () => bookedProductsApi.list(listParams),
    keepPreviousData: true,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', 'product'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const categoryOptions = useMemo(() => {
    const rows = categoriesData?.data ?? categoriesData ?? [];
    const list = Array.isArray(rows) ? rows : [];
    return [
      { value: '', label: 'All categories' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.id })),
    ];
  }, [categoriesData]);

  const clearFilters = () => {
    setSearch('');
    setCategoryId('');
    setStatus('');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const filtersClear = !search && !categoryId && !status && !from && !to;

  const allColumns = useMemo(
    () => [
      {
        key: 'order_number',
        header: 'Bill No.',
        columnPickerLabel: 'Bill No.',
        className: 'text-xs whitespace-nowrap',
        render: (r) => (
          <BookingBillLink orderId={r.order_id}>{r.order_number || '—'}</BookingBillLink>
        ),
      },
      {
        key: 'customer_name',
        header: 'Customer Name',
        columnPickerLabel: 'Customer name',
        className: 'text-xs',
        render: (r) => (
          <span className="text-xs text-gray-900">{r.customer_name || r.pickup_name || '—'}</span>
        ),
      },
      {
        key: 'product_code',
        header: 'Code',
        columnPickerLabel: 'Product code',
        className: 'text-xs font-mono',
        render: (r) => r.product_code || '—',
      },
      {
        key: 'product_name',
        header: 'Product Name',
        columnPickerLabel: 'Product name',
        className: 'text-xs',
        render: (r) => <span className="uppercase">{r.product_name || '—'}</span>,
      },
      {
        key: 'customer_phone',
        header: 'Customer No.',
        columnPickerLabel: 'Customer phone',
        render: (r) => <span className="font-mono text-xs">{r.customer_phone || '—'}</span>,
      },
      {
        key: 'customer_address',
        header: 'Address',
        columnPickerLabel: 'Address',
        className: 'text-xs max-w-[16rem]',
        render: (r) => (
          <span className="block truncate" title={r.customer_address || ''}>
            {r.customer_address || '—'}
          </span>
        ),
      },
      {
        key: 'rent',
        header: 'Rent',
        columnPickerLabel: 'Rent',
        align: 'right',
        className: 'text-xs',
        render: (r) => formatCurrency(Number(r.rent ?? 0)),
      },
      {
        key: 'qty',
        header: 'Qty',
        columnPickerLabel: 'Quantity',
        align: 'right',
        className: 'text-xs tabular-nums',
        render: (r) => {
          const n = Number(r.qty ?? 0);
          return Number.isFinite(n) ? n : 0;
        },
      },
      {
        key: 'pickup_date',
        header: 'Delivery Date',
        columnPickerLabel: 'Delivery date',
        className: 'text-xs',
        render: (r) => formatDate(r.pickup_date),
      },
      {
        key: 'return_date',
        header: 'Return Date',
        columnPickerLabel: 'Return date',
        className: 'text-xs',
        render: (r) => formatDate(r.return_date),
      },
      {
        key: 'order_status',
        header: 'Status',
        columnPickerLabel: 'Status',
        className: 'text-xs whitespace-nowrap',
        render: (r) => {
          const key = r.order_status || '';
          const bucket = orderStatusToBookedProductBucket(key);
          const label = bucket
            ? BOOKED_PRODUCT_BUCKET_LABELS[bucket]
            : ORDER_STATUS_LABELS[key] || key || '—';
          const tone = bucket ? BUCKET_BADGE_TONE[bucket] : 'gray';
          return (
            <Badge tone={tone} className="whitespace-nowrap shrink-0">
              {label}
            </Badge>
          );
        },
      },
    ],
    []
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('booked-products', allColumns, {
    defaultHidden: BOOKED_PRODUCT_LIST_DEFAULT_HIDDEN,
  });

  const exportColumns = useMemo(
    () =>
      visibleColumns.map((column) => ({
        key: column.key,
        header: column.columnPickerLabel || column.key,
        get: (row) => {
          if (column.key === 'pickup_date' || column.key === 'return_date') {
            return row[column.key] ? formatDate(row[column.key]) : '';
          }
          if (column.key === 'rent') return formatCurrency(Number(row.rent || 0));
          if (column.key === 'order_status') {
            const bucket = orderStatusToBookedProductBucket(row.order_status || '');
            return bucket
              ? BOOKED_PRODUCT_BUCKET_LABELS[bucket]
              : ORDER_STATUS_LABELS[row.order_status] || row.order_status || '';
          }
          return row[column.key] ?? '';
        },
      })),
    [visibleColumns]
  );

  return (
    <>
      <PageHeader
        title="Booked Product"
        description="One row per booked product line (pickup / delivery date filters)"
      />

      <div className="card relative z-10 p-3 mb-3 overflow-visible">
        <div className="flex flex-nowrap items-center gap-2 min-w-max">
          <div className="w-44 shrink-0">
            <label htmlFor="booked-product-search" className="sr-only">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                id="booked-product-search"
                className="input w-full pl-8 text-xs py-1.5"
                placeholder="Search…"
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
            </div>
          </div>
          <div className="w-40 shrink-0 min-w-0">
            <Select
              label=""
              value={categoryId}
              onChange={(e) => {
                setPage(1);
                setCategoryId(e.target.value);
              }}
              options={categoryOptions}
            />
          </div>
          <div className="w-36 shrink-0 min-w-0">
            <Select
              label=""
              value={status}
              onChange={(e) => {
                setPage(1);
                setStatus(e.target.value);
              }}
              options={STATUS_BUCKET_OPTIONS}
            />
          </div>
          <div className="w-28 shrink-0 min-w-0">
            <Input
              id="booked-from"
              label=""
              type="date"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={from}
              onChange={(e) => {
                setPage(1);
                setFrom(e.target.value);
              }}
            />
          </div>
          <div className="w-28 shrink-0 min-w-0">
            <Input
              id="booked-to"
              label=""
              type="date"
              panelAlign="end"
              className="w-full min-w-0"
              inputClassName="text-xs py-1.5 pr-8"
              value={to}
              onChange={(e) => {
                setPage(1);
                setTo(e.target.value);
              }}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon={Search}
            iconOnly
            title="Apply filters"
            aria-label="Apply filters"
            className="shrink-0"
            onClick={() => setPage(1)}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            iconOnly
            title="Reset filters"
            aria-label="Reset filters"
            className="shrink-0"
            disabled={filtersClear}
            onClick={clearFilters}
          />
          <TableColumnPicker {...pickerProps} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={FileSpreadsheet}
            onClick={() => downloadCsv('booked_products.csv', exportColumns, data?.data || [])}
            disabled={isLoading || !data?.data?.length}
          >
            Export
          </Button>
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        loading={isLoading}
        rowKey="id"
        onRowClick={(r) => navigate(`/booking/${r.order_id}`)}
        emptyTitle="No line items"
        emptyMessage="Try widening the date range or clearing filters."
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

export default BookedProductList;
