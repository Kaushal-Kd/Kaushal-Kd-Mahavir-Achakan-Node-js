import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate, PRODUCT_STATUS } from '@wrs/shared';
import {
  Edit2,
  Copy,
  FileSpreadsheet,
  Plus,
  Printer,
  Search,
  Trash2,
  CheckCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CompactCatalogFilters from '../../components/list/CompactCatalogFilters.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import AdminPasswordModal from '../../components/ui/AdminPasswordModal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import CategoryRail from '../../components/ui/CategoryRail.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import ExpandableNotesText from '../../components/ui/ExpandableNotesText.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import { productsApi } from '../../lib/api/products.js';
import { catalogDeleteModeForRow } from '../../lib/catalogDeleteIntent.js';
import { downloadProductExportCsv } from '../../lib/productExport.js';
import { invalidateCatalogDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';
import { catalogItemMobileCard } from '../../lib/listMobileCards.jsx';
import { fetchAllPages, omitPagination } from '../../lib/reportPdfExport.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { printBarcodeLabels, printBarcodeLabelsBulk } from '../../utils/printBarcode.js';

const dash = (v) => (v == null || v === '' ? '—' : String(v));
const trunc = (s, n) => {
  const t = String(s ?? '');
  if (!t) return '—';
  return t.length <= n ? t : `${t.slice(0, n)}…`;
};
const yn = (v) => (v ? 'Yes' : 'No');

function isProductCatalogActive(row) {
  return catalogDeleteModeForRow(row) === 'deactivate';
}

/** Hidden until user enables (default: image, code, name, size, color, rent, sell, status). */
const PRODUCT_LIST_DEFAULT_HIDDEN = [
  'category',
  'type',
  'purchase_price',
  'qty',
  'lifetime_gap',
  'count',
  'vendor_id',
  'photos_count',
  'notes',
  'created_at',
  'updated_at',
];

const PRODUCT_TYPE_OPTS = [
  { value: '', label: 'All types' },
  { value: 'rent', label: 'Rent' },
  { value: 'sell', label: 'Sell' },
  { value: 'both', label: 'Both' },
];

const CATALOG_ACTIVE_OPTS = [
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
  { value: 'all', label: 'All' },
];

const PRODUCT_INVENTORY_OPTS = [
  { value: '', label: 'All statuses' },
  { value: PRODUCT_STATUS.AVAILABLE, label: 'Available' },
  { value: PRODUCT_STATUS.BOOKED, label: 'Booked' },
  { value: PRODUCT_STATUS.DELIVERED, label: 'Delivered' },
  { value: PRODUCT_STATUS.RETURNED, label: 'Returned' },
  { value: PRODUCT_STATUS.WASHING, label: 'Washing' },
  { value: PRODUCT_STATUS.REPAIR, label: 'Repair' },
  { value: PRODUCT_STATUS.SOLD, label: 'Sold' },
  { value: PRODUCT_STATUS.LOST, label: 'Lost' },
];

/** Always list products by code descending (newest / highest codes first). */
const PRODUCT_LIST_SORT = '-p.code';

const INVENTORY_STATUS_TONE = {
  [PRODUCT_STATUS.AVAILABLE]: 'green',
  [PRODUCT_STATUS.BOOKED]: 'brand',
  [PRODUCT_STATUS.DELIVERED]: 'brand',
  [PRODUCT_STATUS.RETURNED]: 'gray',
  [PRODUCT_STATUS.WASHING]: 'yellow',
  [PRODUCT_STATUS.REPAIR]: 'yellow',
  [PRODUCT_STATUS.SOLD]: 'gray',
  [PRODUCT_STATUS.LOST]: 'red',
};

const ProductList = () => {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [typeFilter, setTypeFilter] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [catalogActiveFilter, setCatalogActiveFilter] = useState('active');
  /** id -> { code, name, qty } so barcodes can be printed for picks across pages */
  const [selection, setSelection] = useState({});
  /** After "select all", tracks every id in that filtered fetch so uncheck can clear without re-fetching */
  const [selectAllCandidates, setSelectAllCandidates] = useState(null);
  const [selectAllFilteredBusy, setSelectAllFilteredBusy] = useState(false);
  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);
  const [bulkDeactivateError, setBulkDeactivateError] = useState('');
  const [bulkActivateOpen, setBulkActivateOpen] = useState(false);
  const [bulkActivateError, setBulkActivateError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  /** Snapshot ids when bulk modal opens so confirm is not blocked by stale selection state */
  const pendingBulkDeactivateIdsRef = useRef([]);
  const pendingBulkActivateIdsRef = useRef([]);
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
    deleteFn: (row, admin_password) => productsApi.remove(row.id, { admin_password, mode: catalogDeleteModeForRow(row) }),
    onSuccess: async (res, item) => {
      toast.success(
        res?.data?.mode === 'permanently_deleted'
          ? 'Product permanently deleted'
          : 'Product deactivated'
      );
      setSelection((prev) => {
        if (!item?.id || !prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await invalidateCatalogDomain(queryClient);
    },
  });
  const buildListParams = useCallback(
    (page, perPage = 500) => {
      const params = { search, page, per_page: perPage, sort: PRODUCT_LIST_SORT };
      if (categoryId && categoryId !== 'all') params.category_id = categoryId;
      if (typeFilter) params.type = typeFilter;
      if (sizeFilter) params.size = sizeFilter;
      if (colorFilter) params.color = colorFilter;
      if (statusFilter) params.inventory_lane = statusFilter;
      if (catalogActiveFilter && catalogActiveFilter !== 'active') {
        params.catalog_active = catalogActiveFilter;
      }
      return params;
    },
    [search, categoryId, typeFilter, sizeFilter, colorFilter, statusFilter, catalogActiveFilter]
  );

  const { data, isLoading } = useQuery({
    queryKey: [
      'products',
      'list',
      {
        search,
        categoryId,
        typeFilter,
        sizeFilter,
        colorFilter,
        statusFilter,
        catalogActiveFilter,
        page,
        perPage,
      },
    ],
    queryFn: () => productsApi.list(buildListParams(page, perPage)),
    keepPreviousData: true,
  });

  const { data: colorsRes } = useQuery({
    queryKey: ['configurations', 'colors'],
    queryFn: () => configurationsApi.get('colors'),
  });
  const { data: sizesRes } = useQuery({
    queryKey: ['configurations', 'sizes'],
    queryFn: () => configurationsApi.get('sizes'),
  });

  const sizeSelectOptions = useMemo(() => {
    const items = sizesRes?.data?.items || [];
    return [{ value: '', label: 'All sizes' }, ...items.map((s) => ({ value: s, label: s }))];
  }, [sizesRes?.data?.items]);

  const colorSelectOptions = useMemo(() => {
    const items = sortColorsAZ(colorsRes?.data?.items);
    return [{ value: '', label: 'All colors' }, ...items.map((c) => ({ value: c, label: c }))];
  }, [colorsRes?.data?.items]);

  const sizeOptionsForUi = sizeSelectOptions.length > 1 ? sizeSelectOptions : null;
  const colorOptionsForUi = colorSelectOptions.length > 1 ? colorSelectOptions : null;

  const catalogFiltersClear =
    !typeFilter && !sizeFilter && !colorFilter && !statusFilter && catalogActiveFilter === 'active';
  const clearCatalogFilters = () => {
    setTypeFilter('');
    setSizeFilter('');
    setColorFilter('');
    setStatusFilter('');
    setCatalogActiveFilter('active');
    setPage(1);
  };

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        search,
        categoryId,
        typeFilter,
        sizeFilter,
        colorFilter,
        statusFilter,
        catalogActiveFilter,
      }),
    [search, categoryId, typeFilter, sizeFilter, colorFilter, statusFilter, catalogActiveFilter]
  );

  const selectionResetKey = useMemo(
    () =>
      JSON.stringify({
        categoryId,
        typeFilter,
        sizeFilter,
        colorFilter,
        statusFilter,
        catalogActiveFilter,
      }),
    [categoryId, typeFilter, sizeFilter, colorFilter, statusFilter, catalogActiveFilter]
  );

  useEffect(() => {
    setSelection({});
    setSelectAllCandidates(null);
  }, [selectionResetKey]);

  useEffect(() => {
    setPage(1);
  }, [filterKey]);

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

  const handlePrintSelectedBarcodes = useCallback(() => {
    const items = selectionToPrintItems(selection);
    if (!items.length) {
      toast.error('Choose products with a code, or clear filters and try again.');
      return;
    }
    try {
      printBarcodeLabelsBulk(items);
    } catch (err) {
      toast.error(err?.message || 'Failed to open print window');
    }
  }, [selection, selectionToPrintItems]);

  const bulkSelectionLabel = useMemo(() => {
    const entries = Object.entries(selection);
    if (!entries.length) return '';
    if (entries.length === 1) {
      const [, row] = entries[0];
      return row?.name || '1 product selected';
    }
    return `${entries.length} products selected`;
  }, [selection]);

  const { mutate: runBulkDeactivate, isPending: bulkDeactivateBusy } = useMutation({
    mutationFn: ({ ids, admin_password }) => productsApi.bulkDeactivate(ids, admin_password),
    onSuccess: async (res) => {
      const n = Number(res?.data?.deactivated || 0);
      const skipped = Number(res?.data?.skipped_blocked || 0);
      setBulkDeactivateOpen(false);
      setBulkDeactivateError('');
      pendingBulkDeactivateIdsRef.current = [];
      setSelection({});
      setSelectAllCandidates(null);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (skipped > 0) {
        toast.warning(
          n === 1 && skipped === 1
            ? '1 deactivated, 1 skipped (active booking)'
            : `${n} deactivated, ${skipped} skipped (active booking)`
        );
      } else {
        toast.success(n === 1 ? '1 product deactivated' : `${n} products deactivated`);
      }
      await invalidateCatalogDomain(queryClient);
    },
    onError: (err) => {
      setBulkDeactivateError(getApiErrorMessage(err, 'Could not deactivate products'));
    },
  });

  const { mutate: runBulkActivate, isPending: bulkActivateBusy } = useMutation({
    mutationFn: ({ ids, admin_password }) => productsApi.bulkActivate(ids, admin_password),
    onSuccess: async (res) => {
      const n = Number(res?.data?.activated || 0);
      setBulkActivateOpen(false);
      setBulkActivateError('');
      pendingBulkActivateIdsRef.current = [];
      setSelection({});
      setSelectAllCandidates(null);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      toast.success(n === 1 ? '1 product activated' : `${n} products activated`);
      await invalidateCatalogDomain(queryClient);
    },
    onError: (err) => {
      setBulkActivateError(getApiErrorMessage(err, 'Could not activate products'));
    },
  });

  const openBulkDeactivateModal = useCallback(() => {
    const ids = Object.keys(selection);
    if (!ids.length) {
      toast.error('Select at least one product.');
      return;
    }
    pendingBulkDeactivateIdsRef.current = ids;
    setBulkDeactivateError('');
    setBulkDeactivateOpen(true);
  }, [selection]);

  const confirmBulkDeactivate = useCallback(
    (adminPassword) => {
      const ids = pendingBulkDeactivateIdsRef.current;
      if (!ids.length) {
        setBulkDeactivateError('Selection expired. Close this dialog and select products again.');
        return;
      }
      if (bulkDeactivateBusy) return;
      setBulkDeactivateError('');
      runBulkDeactivate({ ids, admin_password: adminPassword });
    },
    [bulkDeactivateBusy, runBulkDeactivate]
  );

  const openBulkActivateModal = useCallback(() => {
    const ids = Object.keys(selection);
    if (!ids.length) {
      toast.error('Select at least one product.');
      return;
    }
    pendingBulkActivateIdsRef.current = ids;
    setBulkActivateError('');
    setBulkActivateOpen(true);
  }, [selection]);

  const confirmBulkActivate = useCallback(
    (adminPassword) => {
      const ids = pendingBulkActivateIdsRef.current;
      if (!ids.length) {
        setBulkActivateError('Selection expired. Close this dialog and select products again.');
        return;
      }
      if (bulkActivateBusy) return;
      setBulkActivateError('');
      runBulkActivate({ ids, admin_password: adminPassword });
    },
    [bulkActivateBusy, runBulkActivate]
  );

  const fetchAllFilteredRows = useCallback(
    () => fetchAllPages(productsApi.list, omitPagination(buildListParams(1))),
    [buildListParams]
  );

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
          const rows = await fetchAllFilteredRows();
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
        const rows = await fetchAllFilteredRows();
        const allIds = rows.map((r) => r.id);
        const codedIds = rows.filter((r) => String(r.code || '').trim()).map((r) => r.id);
        if (!rows.length) {
          toast.warning('No products in the current list.');
        }
        setSelection((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            next[r.id] = { code: r.code || '', name: r.name || '', qty: r.qty };
          }
          return next;
        });
        setSelectAllCandidates({ filterKey, allIds, codedIds });
      } catch (err) {
        toast.error(err?.message || 'Failed to select all products');
      } finally {
        setSelectAllFilteredBusy(false);
      }
    },
    [selectAllFilteredBusy, selectAllCandidates, filterKey, fetchAllFilteredRows]
  );

  const { data: catCounts, isLoading: countsLoading } = useQuery({
    queryKey: ['products', 'category-counts'],
    queryFn: () => productsApi.categoryCounts().then((r) => r.data),
  });

  const { data: cats } = useQuery({
    queryKey: ['categories', 'product'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const categoryLabelById = useMemo(() => {
    const m = {};
    for (const c of cats?.data || []) m[c.id] = c.label;
    return m;
  }, [cats]);

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
            aria-label="Select all products matching current filters (all pages)"
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
              aria-label={selection[r.id] ? 'Deselect product' : 'Select product'}
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
            src={r.main_image}
            alt={r.name}
            className="w-10 h-10 rounded bg-gray-50 object-contain border border-gray-100"
          />
        ),
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
        render: (r) => dash(r.category_id ? categoryLabelById[r.category_id] : null),
      },
      {
        key: 'type',
        header: 'Type',
        columnPickerLabel: 'Type (rent/sell)',
        render: (r) => <span className="capitalize">{dash(r.type)}</span>,
      },
      { key: 'size', header: 'Size', columnPickerLabel: 'Size' },
      { key: 'color', header: 'Color', columnPickerLabel: 'Color' },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Inventory status',
        render: (r) => {
          if (!isProductCatalogActive(r)) {
            return (
              <Badge tone="red">
                <span>Deactive</span>
              </Badge>
            );
          }
          const label = r.display_status || r.status || 'available';
          return (
            <Badge tone={INVENTORY_STATUS_TONE[label] || 'gray'}>
              <span className="capitalize">{String(label).replace(/_/g, ' ')}</span>
            </Badge>
          );
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
        key: 'price_sell',
        header: 'Sell',
        columnPickerLabel: 'Sell price',
        align: 'right',
        render: (r) => formatCurrency(r.price_sell),
      },
      {
        key: 'purchase_price',
        header: 'Purchase',
        columnPickerLabel: 'Purchase price',
        align: 'right',
        render: (r) => formatCurrency(r.purchase_price ?? 0),
      },
      {
        key: 'qty',
        header: 'Qty',
        columnPickerLabel: 'Quantity',
        align: 'right',
        render: (r) => dash(r.qty),
      },
      {
        key: 'lifetime_gap',
        header: 'Lifetime gap',
        columnPickerLabel: 'Lifetime gap',
        align: 'right',
        render: (r) => dash(r.lifetime_gap),
      },
      {
        key: 'count',
        header: 'Rent count',
        columnPickerLabel: 'Rental count',
        align: 'right',
        render: (r) => dash(r.count),
      },
      {
        key: 'vendor_id',
        header: 'Vendor ID',
        columnPickerLabel: 'Vendor ID',
        render: (r) => (
          <span className="font-mono text-[10px] text-gray-600">
            {r.vendor_id ? trunc(r.vendor_id, 12) : '—'}
          </span>
        ),
      },
      {
        key: 'photos_count',
        header: 'Gallery',
        columnPickerLabel: 'Gallery image count',
        align: 'right',
        render: (r) => {
          let n = 0;
          try {
            const p = r.photos;
            if (Array.isArray(p)) n = p.length;
            else if (typeof p === 'string' && p) n = (JSON.parse(p) || []).length;
          } catch {
            n = 0;
          }
          return n;
        },
      },
      {
        key: 'notes',
        header: 'Design Details',
        columnPickerLabel: 'Design Details',
        className: 'align-top whitespace-normal max-w-[14rem]',
        render: (r) => <ExpandableNotesText text={r.notes} maxLength={50} />,
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
        width: 150,
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
              onClick={() => navigate(`/products/${r.id}/edit`)}
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
              aria-label="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => navigate(`/products/new?duplicate=${encodeURIComponent(r.id)}`)}
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
              aria-label="Duplicate product"
              title="Duplicate product"
            >
              <Copy size={15} />
            </button>
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
      categoryLabelById,
      selection,
      allFilteredSelected,
      selectAllFilteredBusy,
      data?.meta?.total,
      handleSelectAllFilteredChange,
      toggleRowSelection,
      requestDelete,
    ]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('products', allColumns, {
    defaultHidden: PRODUCT_LIST_DEFAULT_HIDDEN,
  });

  const buildExportParams = useCallback(() => {
    const params = {};
    const q = String(search || '').trim();
    if (q) params.search = q;
    if (categoryId && categoryId !== 'all') params.category_id = categoryId;
    if (typeFilter) params.type = typeFilter;
    if (sizeFilter) params.size = sizeFilter;
    if (colorFilter) params.color = colorFilter;
    if (statusFilter) params.inventory_lane = statusFilter;
    if (catalogActiveFilter && catalogActiveFilter !== 'active') {
      params.catalog_active = catalogActiveFilter;
    }
    return params;
  }, [search, categoryId, typeFilter, sizeFilter, colorFilter, statusFilter, catalogActiveFilter]);

  const handleExportAll = useCallback(async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const res = await productsApi.exportAll(buildExportParams());
      const rows = res?.data || [];
      if (!rows.length) {
        toast.warning('No products to export for the current filters');
        return;
      }
      downloadProductExportCsv(rows);
      toast.success(`Exported ${rows.length} product${rows.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not export products'));
    } finally {
      setExportBusy(false);
    }
  }, [exportBusy, buildExportParams]);

  return (
    <>
      <PageHeader
        title="Products"
        description="Rental and sale catalog for the selected shop"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              icon={FileSpreadsheet}
              className="border-0 bg-green-600 text-white hover:bg-green-700"
              loading={exportBusy}
              disabled={exportBusy}
              onClick={() => void handleExportAll()}
            >
              Export
            </Button>
            <Button icon={Plus} onClick={() => navigate('/products/new')}>
              New product
            </Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4 min-w-0">
        <CategoryRail
          counts={catCounts}
          value={categoryId}
          onChange={(id) => {
            setCategoryId(id);
            setPage(1);
          }}
          loading={countsLoading}
          title="Categories"
          subtitle="Select a category to view products"
          emptyHint="No categories yet. Add them from Configuration -> Categories."
        />

        <div className="flex-1 min-w-0">
          <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="search"
              className="flex-1 min-w-[8rem] outline-none text-xs"
              placeholder="Search name, code, or design details…"
              value={search}
              name="product-catalog-search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Search products by name, code, or design details"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <TableColumnPicker {...pickerProps} />
          </div>

          <CompactCatalogFilters
            typeValue={typeFilter}
            typeOptions={PRODUCT_TYPE_OPTS}
            onTypeChange={(v) => {
              setTypeFilter(v);
              setPage(1);
            }}
            sizeValue={sizeFilter}
            sizeOptions={sizeOptionsForUi}
            onSizeChange={(v) => {
              setSizeFilter(v);
              setPage(1);
            }}
            colorValue={colorFilter}
            colorOptions={colorOptionsForUi}
            onColorChange={(v) => {
              setColorFilter(v);
              setPage(1);
            }}
            catalogActiveValue={catalogActiveFilter}
            catalogActiveOptions={CATALOG_ACTIVE_OPTS}
            onCatalogActiveChange={(v) => {
              setCatalogActiveFilter(v);
              setPage(1);
            }}
            statusValue={statusFilter}
            statusOptions={PRODUCT_INVENTORY_OPTS}
            statusLabel="Inventory"
            onStatusChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            onClear={clearCatalogFilters}
            disabledClear={catalogFiltersClear}
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
                {catalogActiveFilter !== 'inactive' ? (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    className="h-7 text-[11px]"
                    disabled={selectedCount === 0 || bulkDeactivateBusy}
                    onClick={openBulkDeactivateModal}
                  >
                    {selectedCount > 0
                      ? `Deactivate Selected (${selectedCount})`
                      : 'Deactivate Selected'}
                  </Button>
                ) : null}
                {catalogActiveFilter !== 'active' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    icon={CheckCircle}
                    className="h-7 text-[11px]"
                    disabled={selectedCount === 0 || bulkActivateBusy}
                    onClick={openBulkActivateModal}
                  >
                    {selectedCount > 0
                      ? `Activate Selected (${selectedCount})`
                      : 'Activate Selected'}
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
                  Print Selected Barcodes
                </Button>
              </>
            }
          />

          <DataTable
            columns={visibleColumns}
            rows={data?.data}
            loading={isLoading}
            emptyTitle="No products yet"
            emptyMessage="Start by adding your first product to the catalog."
            mobileCardRender={(row) => catalogItemMobileCard(row)}
            visibleCount={data?.data?.length ?? 0}
            totalCount={data?.meta?.total ?? 0}
            page={data?.meta?.page ?? page}
            totalPages={data?.meta?.total_pages ?? 1}
            countLabel="products"
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

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={close}
        onConfirm={confirmDelete}
        title={
          deleting && !isProductCatalogActive(deleting)
            ? 'Permanently delete product?'
            : 'Deactivate product?'
        }
        description={
          deleting && !isProductCatalogActive(deleting)
            ? 'This removes the inactive product permanently and cannot be undone. Existing booking snapshots are preserved.'
            : 'The product will move to the inactive section. Delete it there again only if permanent removal is required.'
        }
        itemLabel={deleting?.name}
        shopName={selectedShopName}
        errorMessage={error}
        onClearError={clearError}
        loading={loading}
        confirmLabel={
          deleting && !isProductCatalogActive(deleting) ? 'Delete permanently' : 'Deactivate'
        }
      />

      <AdminDeleteModal
        isOpen={bulkDeactivateOpen}
        onClose={() => {
          if (bulkDeactivateBusy) return;
          setBulkDeactivateOpen(false);
          setBulkDeactivateError('');
          pendingBulkDeactivateIdsRef.current = [];
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }}
        onConfirm={confirmBulkDeactivate}
        title={
          selectedCount === 1 ? 'Deactivate 1 product?' : `Deactivate ${selectedCount} products?`
        }
        description="Selected products will be hidden from the catalog. They can be restored from the recycle bin."
        itemLabel={bulkSelectionLabel}
        shopName={selectedShopName}
        errorMessage={bulkDeactivateError}
        onClearError={() => setBulkDeactivateError('')}
        loading={bulkDeactivateBusy}
        confirmLabel="Deactivate"
      />

      <AdminPasswordModal
        isOpen={bulkActivateOpen}
        onClose={() => {
          if (bulkActivateBusy) return;
          setBulkActivateOpen(false);
          setBulkActivateError('');
          pendingBulkActivateIdsRef.current = [];
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }}
        onConfirm={confirmBulkActivate}
        title={selectedCount === 1 ? 'Activate 1 product?' : `Activate ${selectedCount} products?`}
        description="Selected inactive products will be restored to the active catalog."
        itemLabel={bulkSelectionLabel}
        shopName={selectedShopName}
        errorMessage={bulkActivateError}
        onClearError={() => setBulkActivateError('')}
        loading={bulkActivateBusy}
        confirmLabel="Activate"
        confirmVariant="primary"
      />
    </>
  );
};

export default ProductList;
