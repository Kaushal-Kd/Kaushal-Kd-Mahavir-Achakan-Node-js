import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessoryRentableQty, formatCurrency, formatDate } from '@wrs/shared';
import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle,
  ClipboardList,
  Copy,
  Edit2,
  Plus,
  Printer,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import AccessoryOutOrdersModal from '../../components/accessories/AccessoryOutOrdersModal.jsx';
import CompactCatalogFilters from '../../components/list/CompactCatalogFilters.jsx';
import Badge from '../../components/ui/Badge.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import AdminPasswordModal from '../../components/ui/AdminPasswordModal.jsx';
import Button from '../../components/ui/Button.jsx';
import CategoryRail from '../../components/ui/CategoryRail.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { catalogDeleteModeForRow } from '../../lib/catalogDeleteIntent.js';
import { ACCESSORY_BASE_PATH } from '../../lib/accessoryRoutes.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import { catalogItemMobileCard } from '../../lib/listMobileCards.jsx';
import { fetchAllPages, omitPagination } from '../../lib/reportPdfExport.js';
import { invalidateCatalogDomain } from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';
import { printBarcodeLabels, printBarcodeLabelsBulk } from '../../utils/printBarcode.js';

const dash = (v) => (v == null || v === '' ? '—' : String(v));
const formatAccessoryType = (type) => {
  if (type === 'both') return 'Rent + Sell';
  if (type === 'rent') return 'Rent';
  if (type === 'sell') return 'Sell';
  return dash(type);
};
const trunc = (s, n) => {
  const t = String(s ?? '');
  if (!t) return '—';
  return t.length <= n ? t : `${t.slice(0, n)}…`;
};
const yn = (v) => (v ? 'Yes' : 'No');
const isAccessoryCatalogActive = (row) => catalogDeleteModeForRow(row) === 'deactivate';

/** Hidden until user enables (default: image, name, type, qty, sell, rent). */
const ACC_TYPE_OPTS = [
  { value: '', label: 'All types' },
  { value: 'rent', label: 'Rent' },
  { value: 'sell', label: 'Sell' },
  { value: 'both', label: 'Rent + Sell' },
];

const ACC_ORDER_OPTS = [
  { value: '', label: 'All order modes' },
  { value: 'regular', label: 'Regular' },
  { value: 'given_with_rent', label: 'Given with rent' },
  { value: 'pack_with_rent', label: 'Pack with rent' },
];

const CATALOG_ACTIVE_OPTS = [
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
  { value: 'all', label: 'All' },
];

const SEARCH_BY_OPTS = [
  { value: 'all', label: 'Code or name' },
  { value: 'code', label: 'Code only' },
  { value: 'name', label: 'Name only' },
];

const ACCESSORY_LIST_DEFAULT_HIDDEN = [
  'default_order_status',
  'unit',
  'color',
  'size',
  'spare_qty',
  'rentable_qty',
  'purchase_price',
  'notes',
  'is_active',
  'created_at',
  'updated_at',
];

const AccessoryList = () => {
  const [search, setSearch] = useState('');
  const [searchBy, setSearchBy] = useState('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [outOrdersAccessory, setOutOrdersAccessory] = useState(null);
  const [categoryId, setCategoryId] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [catalogActiveFilter, setCatalogActiveFilter] = useState('active');
  const [activating, setActivating] = useState(null);
  const [activateError, setActivateError] = useState('');
  const [selection, setSelection] = useState({});
  const [selectAllCandidates, setSelectAllCandidates] = useState(null);
  const [selectAllFilteredBusy, setSelectAllFilteredBusy] = useState(false);
  const selectAllRef = useRef(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error,
    clearError,
    loading,
    close,
  } = useAdminDelete({
    deleteFn: (row, admin_password) => accessoriesApi.remove(row.id, { admin_password, mode: catalogDeleteModeForRow(row) }),
    onSuccess: async (res) => {
      toast.success(
        res?.data?.mode === 'permanently_deleted'
          ? 'Accessory permanently deleted'
          : 'Accessory deactivated'
      );
      await invalidateCatalogDomain(queryClient);
    },
  });
  const activateMut = useMutation({
    mutationFn: ({ id, admin_password }) => accessoriesApi.activate(id, admin_password),
    onSuccess: async () => {
      setActivating(null);
      setActivateError('');
      toast.success('Accessory activated');
      await invalidateCatalogDomain(queryClient);
    },
    onError: (err) => {
      setActivateError(getApiErrorMessage(err, 'Could not activate accessory'));
    },
  });
  const isLowStockFilter = categoryId === '__low_stock__';
  const isDamagedFilter = categoryId === '__damaged__';

  const buildFetchParams = useCallback(() => {
    const p = { include_active_count: '1', catalog_active: catalogActiveFilter };
    if (search.trim()) {
      p.search = search.trim();
      p.search_by = searchBy;
    }
    if (isLowStockFilter) p.low_stock = '1';
    else if (isDamagedFilter) p.damaged = '1';
    else if (categoryId && categoryId !== 'all') p.category_id = categoryId;
    if (typeFilter) p.default_type = typeFilter;
    if (orderStatusFilter) p.default_order_status = orderStatusFilter;
    return p;
  }, [
    search,
    searchBy,
    isLowStockFilter,
    isDamagedFilter,
    categoryId,
    typeFilter,
    orderStatusFilter,
    catalogActiveFilter,
  ]);

  const listParams = { ...buildFetchParams(), page, per_page: perPage };

  const { data, isLoading } = useQuery({
    queryKey: [
      'accessories',
      {
        search,
        searchBy,
        page,
        perPage,
        categoryId,
        typeFilter,
        orderStatusFilter,
        catalogActiveFilter,
      },
    ],
    queryFn: () => accessoriesApi.list(listParams),
    keepPreviousData: true,
  });

  const accFiltersClear =
    !typeFilter && !orderStatusFilter && catalogActiveFilter === 'active' && searchBy === 'all';
  const clearAccFilters = () => {
    setTypeFilter('');
    setOrderStatusFilter('');
    setCatalogActiveFilter('active');
    setSearchBy('all');
    setPage(1);
  };

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        search,
        searchBy,
        categoryId,
        typeFilter,
        orderStatusFilter,
        catalogActiveFilter,
      }),
    [search, searchBy, categoryId, typeFilter, orderStatusFilter, catalogActiveFilter]
  );

  useEffect(() => {
    setSelection({});
    setSelectAllCandidates(null);
  }, [filterKey]);

  const selectedCount = Object.keys(selection).length;

  const toggleRowSelection = useCallback((row) => {
    if (!row?.id) return;
    setSelection((prev) => {
      const next = { ...prev };
      if (next[row.id]) delete next[row.id];
      else next[row.id] = { code: row.code || '', name: row.name || '', qty: row.qty };
      return next;
    });
  }, []);

  const selectionToPrintItems = useCallback(
    (map) =>
      Object.values(map || {})
        .filter((x) => x && String(x.code || '').trim())
        .map((x) => ({
          value: x.code,
          name: x.name || '',
          count: Math.max(1, Number(x.qty) || 1),
        })),
    []
  );

  const handlePrintSelectedBarcodes = useCallback(async () => {
    const selectedIds = Object.keys(selection);
    if (!selectedIds.length) {
      toast.error('Select at least one accessory to print.');
      return;
    }

    let map = { ...selection };
    const needsRefresh = selectedIds.some((id) => !String(map[id]?.code || '').trim());
    if (needsRefresh) {
      try {
        const rows = await fetchAllPages(accessoriesApi.list, omitPagination(buildFetchParams()));
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const id of selectedIds) {
          const row = byId.get(id);
          if (row) {
            map[id] = { code: row.code || '', name: row.name || '', qty: row.qty };
          }
        }
        setSelection(map);
      } catch (err) {
        toast.error(err?.message || 'Could not refresh accessory codes');
        return;
      }
    }

    const items = selectionToPrintItems(map);
    if (!items.length) {
      toast.error('Choose accessories with a code, or clear filters and try again.');
      return;
    }
    try {
      printBarcodeLabelsBulk(items);
    } catch (err) {
      toast.error(err?.message || 'Failed to open print window');
    }
  }, [selection, selectionToPrintItems, buildFetchParams]);

  const allFilteredSelected = useMemo(() => {
    if (!selectAllCandidates || selectAllCandidates.filterKey !== filterKey) return false;
    const { allIds } = selectAllCandidates;
    return allIds.length > 0 && allIds.every((id) => Boolean(selection[id]));
  }, [selectAllCandidates, filterKey, selection]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (el) {
      const n = Object.keys(selection).length;
      el.indeterminate = n > 0 && !allFilteredSelected;
    }
  }, [selection, allFilteredSelected]);

  const handleSelectAllFilteredChange = useCallback(
    async (e) => {
      const wantChecked = e.target.checked;
      if (selectAllFilteredBusy) return;

      if (!wantChecked) {
        if (selectAllCandidates && selectAllCandidates.filterKey === filterKey) {
          setSelection((prev) => {
            const next = { ...prev };
            for (const id of selectAllCandidates.allIds) delete next[id];
            return next;
          });
          setSelectAllCandidates(null);
          return;
        }
        setSelectAllFilteredBusy(true);
        try {
          const rows = await fetchAllPages(accessoriesApi.list, omitPagination(buildFetchParams()));
          setSelection((prev) => {
            const next = { ...prev };
            for (const r of rows) delete next[r.id];
            return next;
          });
          setSelectAllCandidates(null);
        } catch (err) {
          toast.error(err?.message || 'Failed to update selection');
        } finally {
          setSelectAllFilteredBusy(false);
        }
        return;
      }

      setSelectAllFilteredBusy(true);
      try {
        const rows = await fetchAllPages(accessoriesApi.list, omitPagination(buildFetchParams()));
        const allIds = rows.map((r) => r.id);
        if (!rows.length) toast.warning('No accessories in the current list.');
        setSelection((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            next[r.id] = { code: r.code || '', name: r.name || '', qty: r.qty };
          }
          return next;
        });
        setSelectAllCandidates({ filterKey, allIds });
      } catch (err) {
        toast.error(err?.message || 'Failed to select all accessories');
      } finally {
        setSelectAllFilteredBusy(false);
      }
    },
    [selectAllFilteredBusy, selectAllCandidates, filterKey, buildFetchParams]
  );

  const { data: catCounts, isLoading: countsLoading } = useQuery({
    queryKey: ['accessories', 'category-counts', catalogActiveFilter],
    queryFn: () =>
      accessoriesApi.categoryCounts({ catalog_active: catalogActiveFilter }).then((r) => r.data),
  });

  const allColumns = useMemo(
    () => [
      {
        key: 'select',
        header: (
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allFilteredSelected}
            disabled={selectAllFilteredBusy || !Number(data?.meta?.total)}
            onChange={(e) => void handleSelectAllFilteredChange(e)}
            className="h-3.5 w-3.5 rounded border-gray-300 accent-brand"
            aria-label="Select all accessories matching current filters (all pages)"
          />
        ),
        columnPickerLabel: 'Select',
        locked: true,
        width: 40,
        className: 'align-middle',
        render: (r) => (
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={Boolean(selection[r.id])}
              onChange={() => toggleRowSelection(r)}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-brand"
              aria-label={selection[r.id] ? 'Deselect accessory' : 'Select accessory'}
            />
          </div>
        ),
      },
      {
        key: 'image',
        header: '',
        columnPickerLabel: 'Image',
        width: 56,
        render: (r) => (
          <SmartImage
            src={r.image_url}
            alt={r.name}
            className="w-10 h-10 rounded bg-gray-50 object-contain border border-gray-100"
          />
        ),
      },
      {
        key: 'code',
        header: 'Code',
        columnPickerLabel: 'Code',
        render: (r) => <span className="font-mono text-xs">{r.code || '—'}</span>,
      },
      {
        key: 'name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => <span className="font-medium">{r.name}</span>,
      },
      {
        key: 'default_type',
        header: 'Type',
        columnPickerLabel: 'Default type',
        render: (r) => (
          <Badge tone="brand">
            <span>{formatAccessoryType(r.default_type)}</span>
          </Badge>
        ),
      },
      {
        key: 'default_order_status',
        header: 'Order status',
        columnPickerLabel: 'Default order status',
        render: (r) => (
          <span className="text-xs capitalize text-gray-700">{dash(r.default_order_status)}</span>
        ),
      },
      { key: 'unit', header: 'Unit', columnPickerLabel: 'Unit' },
      {
        key: 'color',
        header: 'Color',
        columnPickerLabel: 'Color',
        render: (r) => dash(r.color),
      },
      {
        key: 'size',
        header: 'Size',
        columnPickerLabel: 'Size',
        render: (r) => dash(r.size),
      },
      {
        key: 'qty',
        header: 'Total qty',
        columnPickerLabel: 'Total quantity',
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">
            {r.qty} {r.unit}
          </span>
        ),
      },
      {
        key: 'spare_qty',
        header: 'Spare',
        columnPickerLabel: 'Spare qty (reserved)',
        align: 'right',
        render: (r) => {
          const spare = Number(r.spare_qty || 0);
          return spare > 0 ? (
            <span className="tabular-nums text-gray-700">{spare}</span>
          ) : (
            dash(spare)
          );
        },
      },
      {
        key: 'damaged_qty',
        header: 'Damaged',
        columnPickerLabel: 'Damaged qty',
        align: 'right',
        render: (r) => {
          const damaged = Number(r.damaged_qty || 0);
          return damaged > 0 ? (
            <span className="inline-flex items-center gap-1 tabular-nums font-semibold text-red-700">
              <AlertTriangle size={12} aria-hidden />
              {damaged}
            </span>
          ) : (
            dash(damaged)
          );
        },
      },
      {
        key: 'rentable_qty',
        header: 'Rentable',
        columnPickerLabel: 'Rentable qty (booking/sale)',
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">{Number(r.rentable_qty ?? accessoryRentableQty(r))}</span>
        ),
      },
      {
        key: 'active_out_qty',
        header: 'Out',
        columnPickerLabel: 'Out (on orders)',
        align: 'right',
        render: (r) => {
          const out = Number(r.active_out_qty || 0);
          return (
            <span
              className={clsx(
                'inline-flex items-center justify-end gap-1 tabular-nums',
                out > 0 && 'text-yellow-700 font-medium'
              )}
            >
              {out}
              {out > 0 ? (
                <button
                  type="button"
                  className="p-0.5 rounded text-yellow-700 hover:text-brand hover:bg-brand-light"
                  aria-label="View bookings with this accessory out"
                  title="View bookings"
                  onClick={() =>
                    setOutOrdersAccessory({
                      id: r.id,
                      name: r.name,
                      unit: r.unit,
                    })
                  }
                >
                  <ClipboardList size={14} aria-hidden />
                </button>
              ) : null}
            </span>
          );
        },
      },
      {
        key: 'in_shop_qty',
        header: 'In shop',
        columnPickerLabel: 'In shop (available)',
        align: 'right',
        render: (r) => {
          const inShop = Number(r.in_shop_qty ?? r.qty ?? 0);
          const low = r.is_low_stock === true;
          return (
            <span
              className={clsx(
                'inline-flex items-center gap-1 justify-end tabular-nums',
                low && 'text-red-800 font-semibold'
              )}
            >
              {low ? <AlertTriangle size={13} aria-hidden /> : null}
              {inShop}
            </span>
          );
        },
      },
      {
        key: 'threshold',
        header: 'Low stock alert',
        columnPickerLabel: 'Low stock alert',
        align: 'right',
        render: (r) => dash(r.threshold),
      },
      {
        key: 'price_sell',
        header: 'Sell',
        columnPickerLabel: 'Sell price',
        align: 'right',
        render: (r) => formatCurrency(r.price_sell),
      },
      {
        key: 'price_rent',
        header: 'Rent',
        columnPickerLabel: 'Rent price',
        align: 'right',
        render: (r) => formatCurrency(r.price_rent),
      },
      {
        key: 'purchase_price',
        header: 'Purchase',
        columnPickerLabel: 'Purchase price',
        align: 'right',
        render: (r) => formatCurrency(r.purchase_price ?? 0),
      },
      {
        key: 'notes',
        header: 'Notes',
        columnPickerLabel: 'Notes',
        render: (r) => trunc(r.notes, 50),
      },
      {
        key: 'is_active',
        header: 'Active',
        columnPickerLabel: 'Active (Yes/No)',
        render: (r) => yn(isAccessoryCatalogActive(r)),
      },
      {
        key: 'created_at',
        header: 'Created',
        columnPickerLabel: 'Created at',
        render: (r) => (r.created_at ? formatDate(r.created_at) : '—'),
      },
      {
        key: 'updated_at',
        header: 'Updated',
        columnPickerLabel: 'Updated at',
        render: (r) => (r.updated_at ? formatDate(r.updated_at) : '—'),
      },
      {
        key: 'actions',
        header: '',
        locked: true,
        align: 'right',
        width: 190,
        render: (r) => (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              disabled={!String(r.code || '').trim()}
              onClick={() => {
                try {
                  printBarcodeLabels({
                    value: r.code,
                    name: r.name,
                    count: Math.max(1, Number(r.qty) || 1),
                  });
                } catch (err) {
                  toast.error(err?.message || 'Failed to open print window');
                }
              }}
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Print barcode"
              title="Print barcode"
            >
              <Printer size={15} />
            </button>
            <button
              onClick={() => navigate(`${ACCESSORY_BASE_PATH}/${r.id}/edit`)}
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
              aria-label="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(`${ACCESSORY_BASE_PATH}/new?duplicate=${encodeURIComponent(r.id)}`)
              }
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
              aria-label="Duplicate accessory"
              title="Duplicate accessory"
            >
              <Copy size={15} />
            </button>
            {!isAccessoryCatalogActive(r) ? (
              <button
                type="button"
                onClick={() => {
                  setActivateError('');
                  setActivating(r);
                }}
                className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
                aria-label="Activate accessory"
                title="Activate accessory"
              >
                <CheckCircle size={15} />
              </button>
            ) : null}
            <button
              onClick={() => requestDelete(r)}
              className="p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
              aria-label="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
      },
    ],
    [
      navigate,
      requestDelete,
      selection,
      allFilteredSelected,
      selectAllFilteredBusy,
      data?.meta?.total,
      handleSelectAllFilteredChange,
      toggleRowSelection,
      setActivating,
    ]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('accessories', allColumns, {
    defaultHidden: ACCESSORY_LIST_DEFAULT_HIDDEN,
  });

  return (
    <>
      <PageHeader
        title="Accessories"
        description="Rent, sell, or both — track stock and pricing for add-ons like mojdi, safa, and brooch"
        actions={
          <Button icon={Plus} onClick={() => navigate(`${ACCESSORY_BASE_PATH}/new`)}>
            New accessory
          </Button>
        }
      />

      <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4 min-w-0">
        <CategoryRail
          counts={catCounts}
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
          loading={countsLoading}
          title="Categories"
          subtitle="Select a category to view accessories"
          emptyHint="No categories yet. Add them from Configuration -> Categories."
          extraItems={[
            ...(catCounts?.low_stock_count > 0
              ? [
                  {
                    id: '__low_stock__',
                    label: 'Low stock',
                    count: catCounts.low_stock_count,
                    tone: 'danger',
                  },
                ]
              : []),
            ...(catCounts?.damaged_count > 0
              ? [
                  {
                    id: '__damaged__',
                    label: 'Damaged',
                    count: catCounts.damaged_count,
                    tone: 'danger',
                  },
                ]
              : []),
          ]}
        />

        <div className="flex-1 min-w-0">
          <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              className="flex-1 min-w-[8rem] outline-none text-xs"
              placeholder={
                searchBy === 'code'
                  ? 'Search code…'
                  : searchBy === 'name'
                    ? 'Search name…'
                    : 'Search code or name…'
              }
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
            <select
              className="h-7 rounded border border-gray-200 bg-white px-1.5 text-[11px] text-gray-700"
              value={searchBy}
              aria-label="Search accessories by"
              onChange={(e) => {
                setPage(1);
                setSearchBy(e.target.value);
              }}
            >
              {SEARCH_BY_OPTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <TableColumnPicker {...pickerProps} />
          </div>

          <CompactCatalogFilters
            typeValue={typeFilter}
            typeOptions={ACC_TYPE_OPTS}
            onTypeChange={(v) => {
              setPage(1);
              setTypeFilter(v);
            }}
            orderStatusValue={orderStatusFilter}
            orderStatusOptions={ACC_ORDER_OPTS}
            onOrderStatusChange={(v) => {
              setPage(1);
              setOrderStatusFilter(v);
            }}
            catalogActiveValue={catalogActiveFilter}
            catalogActiveOptions={CATALOG_ACTIVE_OPTS}
            onCatalogActiveChange={(v) => {
              setPage(1);
              setCatalogActiveFilter(v);
            }}
            onClear={clearAccFilters}
            disabledClear={accFiltersClear}
            endActions={
              <>
                {selectedCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-[11px]"
                    onClick={() => {
                      setSelection({});
                      setSelectAllCandidates(null);
                    }}
                  >
                    Clear selection
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={Printer}
                  className="h-7 text-[11px]"
                  disabled={selectedCount === 0}
                  onClick={handlePrintSelectedBarcodes}
                >
                  {selectedCount > 0
                    ? `Print Selected Barcodes (${selectedCount})`
                    : 'Print Selected Barcodes'}
                </Button>
              </>
            }
          />

          <DataTable
            columns={visibleColumns}
            rows={data?.data}
            loading={isLoading}
            emptyTitle="No accessories yet"
            emptyMessage="Add your first accessory to track stock and sales."
            mobileCardRender={(row) =>
              catalogItemMobileCard(row, { imageKey: 'image_url', subtitleKey: 'code' })
            }
            getRowClassName={(row) => (row.is_low_stock === true ? 'acc-low-stock-row' : '')}
            visibleCount={data?.data?.length ?? 0}
            totalCount={data?.meta?.total ?? 0}
            page={data?.meta?.page ?? page}
            totalPages={data?.meta?.total_pages ?? 1}
            countLabel="accessories"
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
        </div>
      </div>

      <AccessoryOutOrdersModal
        isOpen={Boolean(outOrdersAccessory)}
        accessory={outOrdersAccessory}
        onClose={() => setOutOrdersAccessory(null)}
      />

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={close}
        onConfirm={confirmDelete}
        title={
          deleting && !isAccessoryCatalogActive(deleting)
            ? 'Permanently delete accessory?'
            : 'Deactivate accessory?'
        }
        description={
          deleting && !isAccessoryCatalogActive(deleting)
            ? 'This removes the inactive accessory permanently and cannot be undone. Existing order snapshots are preserved.'
            : 'The accessory will move to the inactive section. Delete it there again only if permanent removal is required.'
        }
        itemLabel={deleting?.name}
        shopName={selectedShopName}
        errorMessage={error}
        onClearError={clearError}
        loading={loading}
        confirmLabel={
          deleting && !isAccessoryCatalogActive(deleting) ? 'Delete permanently' : 'Deactivate'
        }
      />

      <AdminPasswordModal
        isOpen={Boolean(activating)}
        onClose={() => {
          if (activateMut.isPending) return;
          setActivating(null);
          setActivateError('');
        }}
        onConfirm={(adminPassword) => {
          if (!activating?.id || activateMut.isPending) return;
          setActivateError('');
          activateMut.mutate({ id: activating.id, admin_password: adminPassword });
        }}
        title="Activate accessory?"
        description="The accessory will be restored to the active catalog."
        itemLabel={activating?.name}
        shopName={selectedShopName}
        errorMessage={activateError}
        onClearError={() => setActivateError('')}
        loading={activateMut.isPending}
        confirmLabel="Activate"
      />
    </>
  );
};

export default AccessoryList;
