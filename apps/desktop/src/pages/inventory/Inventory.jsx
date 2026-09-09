import { useQuery } from '@tanstack/react-query';
import { formatCurrency, PRODUCT_STATUS } from '@wrs/shared';
import clsx from 'clsx';
import { Boxes } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CompactCatalogFilters from '../../components/list/CompactCatalogFilters.jsx';
import Badge from '../../components/ui/Badge.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
import { productsApi } from '../../lib/api/products.js';
import { tableCountFromListResponse } from '../../lib/tableListMeta.js';
const INVENTORY_DEFAULT_PER_PAGE = 50;

const LANES = [
  { id: 'all', label: 'All', tone: 'gray' },
  { id: PRODUCT_STATUS.AVAILABLE, label: 'Available', tone: 'green' },
  { id: PRODUCT_STATUS.BOOKED, label: 'Booked', tone: 'brand' },
  { id: PRODUCT_STATUS.DELIVERED, label: 'Delivered', tone: 'brand' },
  { id: PRODUCT_STATUS.RETURNED, label: 'Returned', tone: 'gray' },
  { id: PRODUCT_STATUS.WASHING, label: 'Washing', tone: 'yellow' },
  { id: PRODUCT_STATUS.REPAIR, label: 'Repair', tone: 'yellow' },
  { id: PRODUCT_STATUS.SOLD, label: 'Sold', tone: 'gray' },
  { id: PRODUCT_STATUS.LOST, label: 'Lost', tone: 'red' },
];

const STATUS_TONE = LANES.reduce((acc, l) => {
  if (l.id !== 'all') acc[l.id] = l.tone;
  return acc;
}, {});

const PRODUCT_TYPE_OPTS = [
  { value: '', label: 'All types' },
  { value: 'rent', label: 'Rent' },
  { value: 'sell', label: 'Sell' },
  { value: 'both', label: 'Both' },
];

/** Default: image, code, name, free qty, status. */
const INVENTORY_DEFAULT_HIDDEN = [
  'category',
  'size',
  'color',
  'qty',
  'booked_qty',
  'in_delivery_qty',
  'washing_qty',
  'rentals',
  'price_rent',
];

const Inventory = () => {
  const [lane, setLane] = useState('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(INVENTORY_DEFAULT_PER_PAGE);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productType, setProductType] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const navigate = useNavigate();

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        lane,
        search,
        categoryId,
        productType,
        sizeFilter,
        colorFilter,
      }),
    [lane, search, categoryId, productType, sizeFilter, colorFilter]
  );

  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const { data: cats } = useQuery({
    queryKey: ['categories', 'product', 'inventory'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const { data: colorsRes } = useQuery({
    queryKey: ['configurations', 'colors', 'inventory'],
    queryFn: () => configurationsApi.get('colors'),
  });

  const { data: sizesRes } = useQuery({
    queryKey: ['configurations', 'sizes', 'inventory'],
    queryFn: () => configurationsApi.get('sizes'),
  });

  const categoryOptions = useMemo(() => {
    const rows = cats?.data ?? cats ?? [];
    const list = Array.isArray(rows) ? rows : [];
    return [
      { value: '', label: 'All categories' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.id })),
    ];
  }, [cats]);

  const sizeOptions = useMemo(() => {
    const items = sizesRes?.data?.items || [];
    if (!items.length) return null;
    return [{ value: '', label: 'All sizes' }, ...items.map((s) => ({ value: s, label: s }))];
  }, [sizesRes?.data?.items]);

  const colorOptions = useMemo(() => {
    const items = sortColorsAZ(colorsRes?.data?.items);
    if (!items.length) return null;
    return [{ value: '', label: 'All colors' }, ...items.map((c) => ({ value: c, label: c }))];
  }, [colorsRes?.data?.items]);

  const catalogFiltersClear = !search.trim() && !categoryId && !productType && !sizeFilter && !colorFilter;
  const clearCatalogFilters = () => {
    setSearch('');
    setCategoryId('');
    setProductType('');
    setSizeFilter('');
    setColorFilter('');
  };

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-snapshot', lane, page, perPage, search, categoryId, productType, sizeFilter, colorFilter],
    queryFn: () =>
      productsApi.inventory({
        lane,
        page,
        per_page: perPage,
        ...(productType ? { type: productType } : {}),
        ...(categoryId ? { category_id: categoryId } : {}),
        ...(sizeFilter ? { size: sizeFilter } : {}),
        ...(colorFilter ? { color: colorFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const counts = data?.counts || {};
  const tableMeta = tableCountFromListResponse(data, 'products');

  const categoryLabelById = useMemo(() => {
    const m = { none: 'Uncategorized' };
    for (const c of cats?.data || cats || []) {
      if (c?.id) m[c.id] = c.label;
    }
    return m;
  }, [cats]);

  const allColumns = useMemo(
    () => [
    {
      key: 'image',
      header: '',
      columnPickerLabel: 'Image',
      locked: true,
      width: 56,
      render: (r) => <SmartImage src={r.main_image} alt={r.name} className="w-10 h-10 rounded object-cover" />,
    },
    {
      key: 'code',
      header: 'Code',
      columnPickerLabel: 'Code',
      render: (r) => <span className="font-mono text-xs">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      columnPickerLabel: 'Name',
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      columnPickerLabel: 'Category',
      className: 'text-xs',
      render: (r) => (
        <span className="text-gray-700">
          {r.category_id ? categoryLabelById[r.category_id] || '—' : 'Uncategorized'}
        </span>
      ),
    },
    { key: 'size', header: 'Size', columnPickerLabel: 'Size' },
    { key: 'color', header: 'Color', columnPickerLabel: 'Color' },
    {
      key: 'qty',
      header: 'Total',
      columnPickerLabel: 'Total qty',
      align: 'right',
      className: 'tabular-nums',
    },
    {
      key: 'booked_qty',
      header: 'Booked',
      columnPickerLabel: 'Booked qty',
      align: 'right',
      className: 'tabular-nums text-xs',
      render: (r) => {
        const n = Number(r.booked_qty || 0);
        return n > 0 ? <span className="font-medium text-brand">{n}</span> : '0';
      },
    },
    {
      key: 'in_delivery_qty',
      header: 'Out',
      columnPickerLabel: 'Out (delivered)',
      align: 'right',
      className: 'tabular-nums text-xs',
      render: (r) => {
        const n = Number(r.in_delivery_qty || 0);
        return n > 0 ? <span className="font-medium text-brand">{n}</span> : '0';
      },
    },
    {
      key: 'washing_qty',
      header: 'Washing',
      columnPickerLabel: 'Washing qty',
      align: 'right',
      className: 'tabular-nums text-xs',
      render: (r) => {
        const n = Number(r.washing_qty || 0);
        return n > 0 ? <span className="font-medium text-yellow-700">{n}</span> : '0';
      },
    },
    {
      key: 'free_qty',
      header: 'Free',
      columnPickerLabel: 'Free qty',
      align: 'right',
      className: 'tabular-nums text-xs',
      render: (r) => {
        const n = Number(r.free_qty || 0);
        return n > 0 ? <span className="font-medium text-green-700">{n}</span> : '0';
      },
    },
    {
      key: 'rentals',
      header: 'Rentals',
      columnPickerLabel: 'Rentals (used / max)',
      align: 'right',
      render: (r) => {
        const used = Number(r.count) || 0;
        const max = Number(r.lifetime_gap) || 0;
        return max > 0 ? `${used} / ${max}` : used || '\u2014';
      },
    },
    {
      key: 'price_rent',
      header: 'Rent',
      columnPickerLabel: 'Rent price',
      align: 'right',
      render: (r) => formatCurrency(r.price_rent),
    },
    {
      key: 'status',
      header: 'Status',
      columnPickerLabel: 'Status',
      render: (r) => (
        <Badge tone={STATUS_TONE[r.display_status] || 'gray'}>
          <span className="capitalize">{r.display_status || r.status}</span>
        </Badge>
      ),
    },
  ],
    [categoryLabelById]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('inventory', allColumns, {
    defaultHidden: INVENTORY_DEFAULT_HIDDEN,
  });

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Live stock from bookings, deliveries, returns, and washing"
      />

      <div className="card p-1.5 mb-3 flex flex-wrap gap-1">
        {LANES.map((l) => {
          const count = counts[l.id] ?? 0;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLane(l.id);
                setPage(1);
              }}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1',
                lane === l.id ? 'bg-brand-light text-brand' : 'text-gray-700 hover:bg-gray-50'
              )}
            >
              <span>{l.label}</span>
              <span
                className={clsx(
                  'text-xs tabular-nums rounded px-1.5 py-0.5',
                  lane === l.id ? 'bg-white/80 text-brand' : 'bg-gray-100 text-gray-600'
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <CompactCatalogFilters
        searchValue={search}
        searchPlaceholder="Search name or code…"
        onSearchChange={setSearch}
        categoryValue={categoryId}
        categoryOptions={categoryOptions}
        onCategoryChange={setCategoryId}
        typeValue={productType}
        typeOptions={PRODUCT_TYPE_OPTS}
        onTypeChange={setProductType}
        sizeValue={sizeFilter}
        sizeOptions={sizeOptions}
        onSizeChange={setSizeFilter}
        colorValue={colorFilter}
        colorOptions={colorOptions}
        onColorChange={setColorFilter}
        onClear={clearCatalogFilters}
        disabledClear={catalogFiltersClear}
        endActions={<TableColumnPicker {...pickerProps} />}
      />

      {rows.length === 0 && !isLoading ? (
        <div className="card p-12 text-center">
          <Boxes size={28} className="text-brand mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-900 mb-1">Nothing here</h3>
          <p className="text-sm text-gray-500">
            No products match the current filter. Try another status or adjust your search.
          </p>
        </div>
      ) : (
        <DataTable
          columns={visibleColumns}
          rows={rows}
          loading={isLoading && rows.length === 0}
          onRowClick={(r) => navigate(`/products/${r.id}`)}
          visibleCount={tableMeta.visibleCount}
          totalCount={tableMeta.totalCount}
          page={tableMeta.page}
          totalPages={tableMeta.totalPages}
          countLabel={tableMeta.countLabel}
          onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setPage((p) => p + 1)}
          disablePrevious={tableMeta.page <= 1}
          disableNext={tableMeta.page >= tableMeta.totalPages}
          showCountFooter
          perPage={perPage}
          onPerPageChange={(n) => {
            setPage(1);
            setPerPage(n);
          }}
        />
      )}
    </>
  );
};

export default Inventory;
