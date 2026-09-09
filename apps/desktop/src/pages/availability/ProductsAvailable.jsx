import { useQuery } from '@tanstack/react-query';
import { formatCurrency, toISODate, toLocalISODate } from '@wrs/shared';
import { toast } from '../../stores/uiStore.js';
import clsx from 'clsx';
import { Camera, History, LayoutGrid, List, PackagePlus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ProductsAvailableAddToCartModal from '../../components/booking/ProductsAvailableAddToCartModal.jsx';
import ProductRentalHistoryModal from '../../components/booking/ProductRentalHistoryModal.jsx';
import BarcodeScannerModal from '../../components/ui/BarcodeScannerModal.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import DatePicker from '../../components/ui/DatePicker.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import TableListFooter from '../../components/ui/TableListFooter.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
import { productsApi } from '../../lib/api/products.js';
import { useAppSettings } from '../../hooks/useAppSettings.js';
import { tableCountFromListResponse } from '../../lib/tableListMeta.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';

const LAYOUT_STORAGE_KEY = 'products-available-layout';

/** Default list columns: code, name, rent, actions. */
const PRODUCTS_AVAILABLE_DEFAULT_HIDDEN = ['category_name', 'color', 'size'];

function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function readStoredLayout() {
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return v === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Always show rent including zero (₹0). */
function formatProductRent(value) {
  const rent = Number(value);
  return formatCurrency(Number.isFinite(rent) ? rent : 0);
}

function parseOptionalRentFilter(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Show code once — size is already embedded in codes like A-0796[40]. */
function formatProductCodeLabel(product) {
  const code = String(product?.code ?? '').trim();
  if (!code) return '—';
  if (/\[[^\]]+\]$/.test(code)) return code;
  const size = String(product?.size ?? '').trim();
  return size ? `${code} [${size}]` : code;
}

const ProductsAvailable = () => {
  const appSettings = useAppSettings();
  const returnOffsetDays = appSettings.getNumber('AUTO_SELECT_RETURN_DATE_DAYS', 3);
  const todayISO = toISODate(new Date());

  const [searchInput, setSearchInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [rentMin, setRentMin] = useState('');
  const [rentMax, setRentMax] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO);
  const [returnDate, setReturnDate] = useState(addDaysISO(todayISO, returnOffsetDays));
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [layout, setLayout] = useState(readStoredLayout);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [bookProduct, setBookProduct] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);

  const { data: cats } = useQuery({
    queryKey: ['categories', 'product', 'products-available'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const { data: colorsRes } = useQuery({
    queryKey: ['configurations', 'colors', 'products-available'],
    queryFn: () => configurationsApi.get('colors'),
  });

  const { data: sizesRes } = useQuery({
    queryKey: ['configurations', 'sizes', 'products-available'],
    queryFn: () => configurationsApi.get('sizes'),
  });

  const categoryOptions = useMemo(() => {
    const rows = cats?.data ?? cats ?? [];
    const list = Array.isArray(rows) ? rows : [];
    return [
      { value: '', label: 'Category' },
      ...list.map((c) => ({ value: c.id, label: c.label || c.id })),
    ];
  }, [cats]);

  const sizeOptions = useMemo(() => {
    const items = sizesRes?.data?.items || [];
    if (!items.length) return null;
    return [{ value: '', label: 'Size' }, ...items.map((s) => ({ value: s, label: s }))];
  }, [sizesRes?.data?.items]);

  const colorOptions = useMemo(() => {
    const items = sortColorsAZ(colorsRes?.data?.items);
    if (!items.length) return null;
    return [{ value: '', label: 'Color' }, ...items.map((c) => ({ value: c, label: c }))];
  }, [colorsRes?.data?.items]);

  const buildAppliedFilters = useCallback(
    () => ({
      from: deliveryDate,
      to: returnDate,
      search: searchInput.trim() || undefined,
      category_id: categoryId || undefined,
      size: sizeFilter || undefined,
      color: colorFilter || undefined,
      rent_min: parseOptionalRentFilter(rentMin),
      rent_max: parseOptionalRentFilter(rentMax),
    }),
    [deliveryDate, returnDate, searchInput, categoryId, sizeFilter, colorFilter, rentMin, rentMax]
  );

  const [appliedFilters, setAppliedFilters] = useState(() => ({
    from: todayISO,
    to: addDaysISO(todayISO, returnOffsetDays),
    search: undefined,
    category_id: undefined,
    size: undefined,
    color: undefined,
    rent_min: undefined,
    rent_max: undefined,
  }));

  useEffect(() => {
    const nextReturn = addDaysISO(deliveryDate, returnOffsetDays);
    setReturnDate(nextReturn);
    setAppliedFilters((prev) => (prev ? { ...prev, to: nextReturn } : prev));
  }, [returnOffsetDays]);

  const {
    data: listData,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['products-available', appliedFilters, page, perPage],
    queryFn: () =>
      productsApi.availabilityList({
        from: appliedFilters.from,
        to: appliedFilters.to,
        page,
        per_page: perPage,
        available_only: true,
        ...(appliedFilters.category_id ? { category_id: appliedFilters.category_id } : {}),
        ...(appliedFilters.search ? { search: appliedFilters.search } : {}),
        ...(appliedFilters.size ? { size: appliedFilters.size } : {}),
        ...(appliedFilters.color ? { color: appliedFilters.color } : {}),
        ...(appliedFilters.rent_min != null ? { rent_min: appliedFilters.rent_min } : {}),
        ...(appliedFilters.rent_max != null ? { rent_max: appliedFilters.rent_max } : {}),
      }),
    enabled: !!appliedFilters,
    keepPreviousData: true,
  });

  const rows = listData?.data ?? [];
  const tableMeta = tableCountFromListResponse(listData, 'products');

  const searchDebounceRef = useRef(null);
  const didMountRef = useRef(false);

  const applyFiltersFromUi = useCallback(
    (opts = { silent: false }) => {
      if (!deliveryDate || !returnDate) {
        if (!opts.silent) toast.warning('Select delivery and return dates');
        return false;
      }
      if (deliveryDate > returnDate) {
        if (!opts.silent) toast.error('Return date must be after delivery date');
        return false;
      }
      const minRent = parseOptionalRentFilter(rentMin);
      const maxRent = parseOptionalRentFilter(rentMax);
      if (minRent != null && maxRent != null && minRent > maxRent) {
        if (!opts.silent) toast.error('Rent min cannot be greater than rent max');
        return false;
      }
      setPage(1);
      setAppliedFilters(buildAppliedFilters());
      return true;
    },
    [buildAppliedFilters, deliveryDate, returnDate, rentMin, rentMax]
  );

  // Always call the latest apply logic from the debounce without re-arming the
  // timer whenever unrelated filters (dates, rent) change identity.
  const applyFiltersRef = useRef(applyFiltersFromUi);
  useEffect(() => {
    applyFiltersRef.current = applyFiltersFromUi;
  }, [applyFiltersFromUi]);

  const runSearch = useCallback(() => {
    window.clearTimeout(searchDebounceRef.current);
    applyFiltersFromUi({ silent: false });
  }, [applyFiltersFromUi]);

  // Debounce only on search-text changes; skip the initial mount (already queried).
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return undefined;
    }
    window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      applyFiltersRef.current({ silent: true });
    }, 350);
    return () => window.clearTimeout(searchDebounceRef.current);
  }, [searchInput]);

  const setLayoutMode = (mode) => {
    setLayout(mode);
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  };

  const openBook = (product) => setBookProduct(product);
  const openHistory = (product) =>
    setHistoryProduct({
      id: product.id,
      code: product.code,
      name: product.name,
      size: product.size,
      color: product.color,
      qty: product.total_qty,
      total_qty: product.total_qty,
    });

  const codeWithSize = (r) => (
    <span className="font-mono text-xs">{formatProductCodeLabel(r)}</span>
  );

  const allColumns = useMemo(
    () => [
      {
        key: 'code',
        header: 'Code',
        columnPickerLabel: 'Code',
        render: (r) => codeWithSize(r),
      },
      {
        key: 'name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => <span className="font-medium">{r.name}</span>,
      },
      {
        key: 'category_name',
        header: 'Category',
        columnPickerLabel: 'Category',
        render: (r) => <span className="text-gray-700">{r.category_name || '—'}</span>,
      },
      { key: 'color', header: 'Color', columnPickerLabel: 'Color', render: (r) => r.color || '—' },
      { key: 'size', header: 'Size', columnPickerLabel: 'Size', render: (r) => r.size || '—' },
      {
        key: 'price_rent',
        header: 'Rent',
        columnPickerLabel: 'Rent',
        align: 'right',
        render: (r) => <span className="tabular-nums">{formatProductRent(r.price_rent)}</span>,
      },
      {
        key: 'actions',
        header: 'Action',
        columnPickerLabel: 'Actions',
        locked: true,
        align: 'right',
        render: (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={PackagePlus}
              title="Book"
              aria-label="Book"
              onClick={() => openBook(r)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={History}
              title="History"
              aria-label="History"
              onClick={() => openHistory(r)}
            />
          </div>
        ),
      },
    ],
    []
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('products-available', allColumns, {
    defaultHidden: PRODUCTS_AVAILABLE_DEFAULT_HIDDEN,
  });

  const showEmpty = appliedFilters && !isLoading && rows.length === 0;
  const listLoading = isLoading || (isFetching && rows.length === 0);
  const emptyMessage = appliedFilters?.search
    ? 'No matching products available for these dates.'
    : 'No products available in this range.';

  return (
    <>
      <PageHeader
        title="Products Available"
        description="Search rent products available between delivery and return dates"
        actions={
          <div className="flex items-center gap-2">
            {layout === 'list' ? <TableColumnPicker {...pickerProps} menuAlign="end" /> : null}
            <div className="flex items-center gap-1 border border-gray-200 rounded-md p-0.5 bg-white">
              <button
                type="button"
                title="Card view"
                aria-label="Card view"
                onClick={() => setLayoutMode('grid')}
                className={clsx(
                  'p-1.5 rounded transition',
                  layout === 'grid' ? 'bg-brand-light text-brand' : 'text-gray-500 hover:bg-gray-50'
                )}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                type="button"
                title="List view"
                aria-label="List view"
                onClick={() => setLayoutMode('list')}
                className={clsx(
                  'p-1.5 rounded transition',
                  layout === 'list' ? 'bg-brand-light text-brand' : 'text-gray-500 hover:bg-gray-50'
                )}
              >
                <List size={16} />
              </button>
            </div>
          </div>
        }
      />

      <div className="card p-2 mb-3 min-w-0 overflow-hidden">
        <div className="flex flex-nowrap items-end gap-1 w-full min-w-0">
          <div className="min-w-0 flex-[1.15] basis-0">
            <label
              htmlFor="products-available-code"
              className="block text-[10px] font-medium text-gray-600 mb-0.5 truncate"
            >
              Code, name, or design details
            </label>
            <div className="relative min-w-0">
              <input
                id="products-available-code"
                type="search"
                className="input w-full min-w-0 h-8 text-xs px-2 py-1 pr-8"
                placeholder="Code, name, or design details"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-brand p-0.5"
                title="Scan barcode"
                aria-label="Scan barcode"
              >
                <Camera size={14} />
              </button>
            </div>
          </div>

          <DatePicker
            label="Delivery"
            required
            value={deliveryDate}
            onChange={(e) => {
              const next = e.target.value;
              setDeliveryDate(next);
              setReturnDate(addDaysISO(next, returnOffsetDays));
            }}
            className="min-w-0 flex-1 basis-0 [&_.label]:text-[10px] [&_.label]:mb-0.5 [&_.label]:truncate"
            inputClassName="h-8 text-xs px-1.5 py-1"
          />

          <DatePicker
            label="Return"
            required
            value={returnDate}
            min={deliveryDate}
            onChange={(e) => setReturnDate(e.target.value)}
            className="min-w-0 flex-1 basis-0 [&_.label]:text-[10px] [&_.label]:mb-0.5 [&_.label]:truncate"
            inputClassName="h-8 text-xs px-1.5 py-1"
          />

          {categoryOptions?.length ? (
            <Select
              label=""
              aria-label="Category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              options={categoryOptions}
              className="min-w-0 flex-[0.85] basis-0 [&_select]:h-8 [&_select]:text-xs [&_select]:py-1 [&_select]:px-1.5 [&_select]:truncate"
            />
          ) : null}

          {sizeOptions?.length ? (
            <Select
              label=""
              aria-label="Size"
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              options={sizeOptions}
              className="min-w-0 flex-[0.55] basis-0 [&_select]:h-8 [&_select]:text-xs [&_select]:py-1 [&_select]:px-1.5"
            />
          ) : null}

          {colorOptions?.length ? (
            <Select
              label=""
              aria-label="Color"
              value={colorFilter}
              onChange={(e) => setColorFilter(e.target.value)}
              options={colorOptions}
              className="min-w-0 flex-[0.55] basis-0 [&_select]:h-8 [&_select]:text-xs [&_select]:py-1 [&_select]:px-1.5"
            />
          ) : null}

          <div className="min-w-0 flex-[0.9] basis-0">
            <span className="block text-[10px] font-medium text-gray-600 mb-0.5 truncate">
              Rent
            </span>
            <div className="flex min-w-0 items-center gap-0.5">
              <input
                id="products-available-rent-min"
                type="number"
                min="0"
                step="1"
                aria-label="Rent minimum"
                className="input min-w-0 flex-1 h-8 text-xs px-1.5 py-1"
                placeholder="Min"
                value={rentMin}
                onChange={(e) => setRentMin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
              <input
                id="products-available-rent-max"
                type="number"
                min="0"
                step="1"
                aria-label="Rent maximum"
                className="input min-w-0 flex-1 h-8 text-xs px-1.5 py-1"
                placeholder="Max"
                value={rentMax}
                onChange={(e) => setRentMax(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            icon={Search}
            className="h-8 shrink-0 px-2.5 text-xs whitespace-nowrap"
            onClick={runSearch}
            loading={isFetching && !!appliedFilters}
            aria-label="Search products"
          >
            Search
          </Button>
        </div>
      </div>

      {layout === 'grid' ? (
        <div className="card overflow-hidden">
          {listLoading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
          ) : showEmpty ? (
            <div className="p-8 text-center text-sm text-gray-600">{emptyMessage}</div>
          ) : (
            <div className="px-3 pt-3 pb-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {rows.map((p) => (
                <div key={p.id} className="card p-2 flex flex-col border border-gray-200 bg-white">
                  <SmartImage
                    src={p.main_image}
                    alt={p.name}
                    className="w-full aspect-square rounded border border-gray-200 object-contain bg-gray-50 mb-2"
                  />
                  <div className="flex gap-1 mb-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => openBook(p)}
                    >
                      Book
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => openHistory(p)}
                    >
                      History
                    </Button>
                  </div>
                  <div className="text-xs text-gray-600">Qty: {p.free_qty}</div>
                  <div className="text-xs font-medium text-gray-800 tabular-nums mt-0.5">
                    Rent: {formatProductRent(p.price_rent)}
                  </div>
                  <div className="text-xs font-mono text-gray-800 truncate mt-0.5">
                    Code: {formatProductCodeLabel(p)}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate mt-0.5">{p.name}</div>
                </div>
              ))}
            </div>
          )}
          <TableListFooter
            visibleCount={tableMeta.visibleCount}
            totalCount={tableMeta.totalCount}
            page={tableMeta.page}
            totalPages={tableMeta.totalPages}
            countLabel={tableMeta.countLabel}
            loading={isFetching}
            onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
            onNextPage={() => setPage((p) => p + 1)}
            disablePrevious={tableMeta.page <= 1}
            disableNext={tableMeta.page >= tableMeta.totalPages}
            className="rounded-b-lg shrink-0"
            perPage={perPage}
            onPerPageChange={(n) => {
              setPage(1);
              setPerPage(n);
            }}
          />
        </div>
      ) : (
        <DataTable
          columns={visibleColumns}
          rows={rows}
          loading={listLoading}
          emptyMessage={emptyMessage}
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

      <ProductsAvailableAddToCartModal
        isOpen={!!bookProduct}
        onClose={() => setBookProduct(null)}
        product={bookProduct}
        deliveryDate={appliedFilters?.from || deliveryDate}
        returnDate={appliedFilters?.to || returnDate}
      />

      <ProductRentalHistoryModal
        isOpen={!!historyProduct}
        onClose={() => setHistoryProduct(null)}
        product={historyProduct}
      />

      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(scanned) => {
          const trimmed = String(scanned || '').trim();
          if (!trimmed) return;
          setScannerOpen(false);
          window.clearTimeout(searchDebounceRef.current);
          setSearchInput(trimmed);
          setPage(1);
          setAppliedFilters({ ...buildAppliedFilters(), search: trimmed });
        }}
      />
    </>
  );
};

export default ProductsAvailable;
