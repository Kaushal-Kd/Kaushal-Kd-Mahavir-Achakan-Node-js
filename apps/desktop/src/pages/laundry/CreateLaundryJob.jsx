import { useQuery } from '@tanstack/react-query';
import {
  formatCurrency,
  formatDate,
  formatWallClockDateTime,
  splitDatetimeLocal,
  toDatetimeLocalValue,
  toISODate,
  parseWallClockDateTimeParts,
  toLocalISODate,
  nowDatetimeLocal,
} from '@wrs/shared';
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronRight,
  Package,
  Plus,
  Printer,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import BarcodeScannerModal from '../../components/ui/BarcodeScannerModal.jsx';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import VendorOutstandingSummary from '../../components/laundry/VendorOutstandingSummary.jsx';
import UpcomingPickupDates from '../../components/booking/UpcomingPickupDates.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import AdminPasswordModal from '../../components/ui/AdminPasswordModal.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useLaundryPrioritySettings } from '../../hooks/useLaundryPrioritySettings.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { useSubmitLock } from '../../hooks/useSubmitLock.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { laundryApi } from '../../lib/api/laundry.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { productsApi } from '../../lib/api/products.js';
import { washingQueueApi } from '../../lib/api/washingQueue.js';
import { toast } from '../../stores/uiStore.js';
import {
  filterWashingQueue,
  getDaysLeft,
  getPriority,
  groupLaundryAccessoriesByCategory,
  presentWashingQueueItem,
  PRIORITY_RANK,
  PRIORITY_TONE,
  QUEUE_SORT_OPTIONS,
  resolveNextBookingLink,
  sortWashingQueue,
} from './laundryQueueUtils.js';
import { printLaundrySlip } from './laundrySlipPrint.js';

const TODAY = toISODate(new Date());

function defaultLaundryDatetimeLocal() {
  return nowDatetimeLocal();
}

function apiDatetimeToLocal(value) {
  const parts = parseWallClockDateTimeParts(value);
  if (parts) {
    return toDatetimeLocalValue(
      `${parts.year}-${parts.month}-${parts.day}`,
      `${parts.hour}:${parts.minute}`
    );
  }
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized = raw.includes('T') ? raw.slice(0, 16) : raw.replace(' ', 'T').slice(0, 16);
  const { date, time } = splitDatetimeLocal(normalized);
  return toDatetimeLocalValue(date, time);
}

/** Normalize API/Date values to YYYY-MM-DD for save payloads; rejects display strings like "Mon Jun 01". */
function pickDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toLocalISODate(value);
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

const CreateLaundryJob = () => {
  const navigate = useNavigate();
  const { settings: prioritySettings } = useLaundryPrioritySettings();
  const [searchParams] = useSearchParams();
  const editingJobId = searchParams.get('jobId') || '';

  const [laundryDate, setLaundryDate] = useState(defaultLaundryDatetimeLocal);
  const [jobNo, setJobNo] = useState('');
  const [vendorAccountId, setVendorAccountId] = useState('');
  const [pickupBy, setPickupBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [discountMode, setDiscountMode] = useState('fixed');
  const [discountValue, setDiscountValue] = useState(0);
  const [overrideRisk, setOverrideRisk] = useState(false);
  const { busy: saveBusy, run: runSave } = useSubmitLock();

  const [productCategory, setProductCategory] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productRows, setProductRows] = useState([]);
  const [categoryWashRates, setCategoryWashRates] = useState({});
  const [accessoryCategoryPick, setAccessoryCategoryPick] = useState('');
  const [accessoryRows, setAccessoryRows] = useState([]);
  const [expandedAccessoryCategories, setExpandedAccessoryCategories] = useState(new Set());
  const [globalSearch, setGlobalSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pendingWashingOpen, setPendingWashingOpen] = useState(false);
  const [pendingWashingItems, setPendingWashingItems] = useState([]);
  const [pendingWashingSelected, setPendingWashingSelected] = useState(new Set());
  const [pendingWashingLoading, setPendingWashingLoading] = useState(false);
  const [pendingWashingSearch, setPendingWashingSearch] = useState('');
  const [pendingWashingSort, setPendingWashingSort] = useState('priority');
  const [bulkQueueRemoveOpen, setBulkQueueRemoveOpen] = useState(false);
  const [bulkQueueRemoveLoading, setBulkQueueRemoveLoading] = useState(false);
  const [usedQueueIds, setUsedQueueIds] = useState([]);
  const selectedShopName = useSelectedShopName();
  const {
    target: queueRemoveTarget,
    requestDelete: requestQueueRemove,
    confirmDelete: confirmQueueRemove,
    error: queueRemoveError,
    clearError: clearQueueRemoveError,
    loading: queueRemoveLoading,
    close: closeQueueRemoveModal,
  } = useAdminDelete({
    deleteFn: (item, admin_password) => washingQueueApi.remove(item.id, { admin_password }),
    onSuccess: (_data, item) => {
      setPendingWashingItems((prev) => prev.filter((p) => p.id !== item.id));
      setPendingWashingSelected((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      toast.success('Removed from washing queue — product is now available');
    },
  });

  const { data: editingJobResp } = useQuery({
    queryKey: ['laundry-job', editingJobId],
    queryFn: () => laundryApi.get(editingJobId),
    enabled: Boolean(editingJobId),
  });

  const { data: paymentAccountsResp } = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });
  const { data: productCatsResp } = useQuery({
    queryKey: ['categories', 'product', 'laundry-job'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });
  const { data: accessoryCatsResp } = useQuery({
    queryKey: ['categories', 'accessory', 'laundry-job'],
    queryFn: () => categoriesApi.list({ type: 'accessory' }),
  });
  const { data: productSearchResp, isLoading: productSearching } = useQuery({
    queryKey: ['laundry-job-products', productSearch, productCategory],
    queryFn: () =>
      productsApi.list({
        search: productSearch,
        category_id: productCategory || undefined,
        per_page: 30,
      }),
    enabled: productSearch.trim().length >= 1,
    keepPreviousData: true,
  });
  const laundryDateOnly = useMemo(() => pickDateOnly(laundryDate) || TODAY, [laundryDate]);

  const { data: productAvailabilityResp } = useQuery({
    queryKey: ['laundry-job-product-availability', productSearch, productCategory, laundryDateOnly],
    queryFn: () =>
      productsApi.bookingAvailability({
        search: productSearch,
        from: laundryDateOnly,
        to: laundryDateOnly,
        qty: 1,
        category_id: productCategory || undefined,
        per_page: 30,
      }),
    enabled: productSearch.trim().length >= 1,
    keepPreviousData: true,
  });
  const vendorAccounts = useMemo(() => {
    const raw = paymentAccountsResp?.data || [];
    return raw.filter((a) =>
      ['vendors', 'laundry vendor'].includes(String(a.account_group || '').toLowerCase())
    );
  }, [paymentAccountsResp?.data]);
  const selectedVendorName = useMemo(
    () => vendorAccounts.find((v) => v.id === vendorAccountId)?.name || '',
    [vendorAccounts, vendorAccountId]
  );
  const { data: vendorPreviewResp } = useQuery({
    queryKey: ['laundry-vendor-outstanding', vendorAccountId, editingJobId],
    queryFn: () =>
      laundryApi.vendorOutstanding({
        vendor_account_id: vendorAccountId,
        vendor_name: selectedVendorName,
        exclude_job_id: editingJobId || undefined,
      }),
    enabled: Boolean(vendorAccountId),
  });
  const productCategories = productCatsResp?.data || [];
  const accessoryCategories = accessoryCatsResp?.data || [];
  const washableAccessoryCategories = useMemo(
    () => accessoryCategories.filter((category) => Boolean(category.is_washable)),
    [accessoryCategories]
  );
  useEffect(() => {
    const job = editingJobResp?.data;
    if (!job) return;
    setLaundryDate(
      apiDatetimeToLocal(job.laundryAt || job.laundryDate) || defaultLaundryDatetimeLocal()
    );
    setJobNo(job.jobNo || '');
    const vendorId =
      job.vendorAccountId || vendorAccounts.find((v) => v.name === job.vendorName)?.id || '';
    setVendorAccountId(vendorId);
    setPickupBy(job.pickupBy || '');
    setRemarks(job.remarks || '');
    setProductRows(
      (job.productRows || []).map((row) => ({
        rowId: row.rowId || makeLocalId(),
        productId: row.productId || '',
        priority: row.priority || 'No Schedule',
        image: row.image || '',
        code: row.code || '',
        name: row.name || '',
        categoryId: row.categoryId || '',
        categoryLabel: row.categoryLabel || 'Uncategorized',
        qty: Number(row.qty || 1),
        maxQty: 9999,
        nextPickupDate: pickDateOnly(row.nextPickupDate) || '',
        daysLeft: row.daysLeft ?? null,
        scanStatus: 'Manual',
        bookingNo: row.bookingNo || '-',
        nextBookingOrderId: resolveNextBookingLink(row).orderId,
        upcomingBookings: row.upcomingBookings || [],
        customerName: '-',
        deliveryDate: '-',
        branchName: '-',
      }))
    );
    setAccessoryRows(
      (job.accessoryRows || []).map((row) => ({
        rowId: row.rowId || makeLocalId(),
        accessoryId: row.accessoryId || null,
        categoryId: row.categoryId || '',
        categoryLabel: row.categoryLabel || row.name || '',
        name: row.name || row.categoryLabel || '',
        qty: Number(row.qty || 1),
        rate: Number(row.rate || 0),
      }))
    );
    setCategoryWashRates(
      Object.fromEntries(
        (job.categorySummaries || []).map((row) => [row.key, Number(row.washPrice || 0)])
      )
    );
    setDiscountMode(job.discountMode || 'fixed');
    setDiscountValue(Number(job.discountValue || 0));
  }, [editingJobResp?.data, vendorAccounts, TODAY]);
  const productMatches = useMemo(() => {
    const listed = productSearchResp?.data || [];
    const availability = productAvailabilityResp?.data || [];
    if (!availability.length) return listed;
    const availabilityById = new Map(availability.map((row) => [row.id, row]));
    return listed.map((row) => ({ ...row, ...(availabilityById.get(row.id) || {}) }));
  }, [productSearchResp?.data, productAvailabilityResp?.data]);
  const productPool = useMemo(() => {
    return productMatches;
  }, [productMatches]);

  const categoryLabelById = useMemo(() => {
    const map = new Map();
    productCategories.forEach((c) => map.set(c.id, c.label));
    return map;
  }, [productCategories]);

  const accessoryCategoryLabelById = useMemo(() => {
    const map = new Map();
    accessoryCategories.forEach((c) => map.set(c.id, c.label));
    return map;
  }, [accessoryCategories]);

  const productCategoryDcPriceById = useMemo(() => {
    const map = new Map();
    productCategories.forEach((c) => map.set(c.id, Number(c.dc_price || 0)));
    return map;
  }, [productCategories]);

  const accessoryCategoryDcPriceById = useMemo(() => {
    const map = new Map();
    accessoryCategories.forEach((c) => map.set(c.id, Number(c.dc_price || 0)));
    return map;
  }, [accessoryCategories]);

  const sortedProductRows = useMemo(
    () =>
      [...productRows].sort(
        (a, b) => (PRIORITY_RANK[a.priority] || 99) - (PRIORITY_RANK[b.priority] || 99)
      ),
    [productRows]
  );

  const categorySummaries = useMemo(() => {
    const map = new Map();
    productRows.forEach((row) => {
      const key = row.categoryId || 'uncategorized';
      const label = row.categoryLabel || 'Uncategorized';
      const existing = map.get(key) || { key, label, productCount: 0, qtyTotal: 0 };
      existing.productCount += 1;
      existing.qtyTotal += Number(row.qty || 0);
      map.set(key, existing);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [productRows]);

  useEffect(() => {
    if (!categorySummaries.length) return;
    setCategoryWashRates((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const row of categorySummaries) {
        if (!row.key || row.key === 'uncategorized') continue;
        if (prev[row.key] !== undefined && prev[row.key] !== '') continue;
        const dc = productCategoryDcPriceById.get(row.key) ?? 0;
        next[row.key] = dc;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [categorySummaries, productCategoryDcPriceById]);

  const productTotal = useMemo(() => {
    return categorySummaries.reduce((sum, row) => {
      const rate = Number(categoryWashRates[row.key] || 0);
      return sum + row.qtyTotal * rate;
    }, 0);
  }, [categorySummaries, categoryWashRates]);
  const accessoryTotal = useMemo(
    () => accessoryRows.reduce((sum, row) => sum + Number(row.qty || 0) * Number(row.rate || 0), 0),
    [accessoryRows]
  );
  const accessoryGroups = useMemo(
    () => groupLaundryAccessoriesByCategory(accessoryRows),
    [accessoryRows]
  );
  const subtotal = productTotal + accessoryTotal;
  const discountAmount =
    discountMode === 'percent'
      ? (subtotal * Number(discountValue || 0)) / 100
      : Number(discountValue || 0);
  const payable = Math.max(0, subtotal - discountAmount);

  const vendorPreviewOutstanding = useMemo(() => {
    const prior = vendorPreviewResp?.data;
    const priorBills = prior?.bills || [];
    const priorRemaining = Number(prior?.totals?.totalRemaining || 0);
    if (payable <= 1e-6 && priorBills.length === 0) return null;

    const bills = [...priorBills];
    if (payable > 1e-6) {
      bills.push({
        id: editingJobId || 'draft',
        jobNo: jobNo || 'This bill (draft)',
        laundryDate: laundryDate || null,
        payable,
        paid: 0,
        remaining: payable,
      });
    }

    return {
      isLatestBill: true,
      bills,
      totals: {
        totalPayable: bills.reduce((sum, bill) => sum + Number(bill.payable || 0), 0),
        totalPaid: bills.reduce((sum, bill) => sum + Number(bill.paid || 0), 0),
        totalRemaining: priorRemaining + (payable > 1e-6 ? payable : 0),
        billCount: bills.length,
      },
    };
  }, [vendorPreviewResp?.data, payable, jobNo, laundryDate, editingJobId]);

  const riskRows = useMemo(() => {
    return productRows.filter((row) => {
      if (!row.nextPickupDate || !laundryDateOnly) return false;
      if (!['Urgent', 'High'].includes(row.priority)) return false;
      return laundryDateOnly > row.nextPickupDate;
    });
  }, [productRows, laundryDateOnly]);

  const filteredPendingWashingItems = useMemo(() => {
    const filtered = filterWashingQueue(pendingWashingItems, pendingWashingSearch);
    return sortWashingQueue(filtered, pendingWashingSort, prioritySettings);
  }, [pendingWashingItems, pendingWashingSearch, pendingWashingSort, prioritySettings]);

  const loadPendingWashing = useCallback(async () => {
    setPendingWashingLoading(true);
    try {
      const resp = await washingQueueApi.list();
      const items = resp?.data || [];
      setPendingWashingItems(items);
      setPendingWashingSearch('');
      setPendingWashingSort('priority');
      const existingProductIds = new Set(productRows.map((row) => row.productId).filter(Boolean));
      const existingAccessoryIds = new Set(
        accessoryRows.map((row) => row.accessoryId).filter(Boolean)
      );
      const existingQueueIds = new Set(accessoryRows.map((row) => row.queueId).filter(Boolean));
      setPendingWashingSelected(
        new Set(
          items
            .filter((item) => {
              const kind = String(item.item_kind || 'product').toLowerCase();
              if (kind === 'accessory') {
                return (
                  !existingQueueIds.has(item.id) && !existingAccessoryIds.has(item.accessory_id)
                );
              }
              return !existingProductIds.has(item.product_id);
            })
            .map((item) => item.id)
        )
      );
      setPendingWashingOpen(true);
    } catch (e) {
      toast.error(e?.message || 'Failed to load washing queue');
    } finally {
      setPendingWashingLoading(false);
    }
  }, [accessoryRows, productRows]);

  const addPendingWashingProducts = useCallback(() => {
    const selected = pendingWashingItems.filter((p) => pendingWashingSelected.has(p.id));
    const addedQueueIds = [];
    const newProductRows = [];
    const newAccessoryRows = [];

    for (const raw of selected) {
      const p = presentWashingQueueItem(raw, prioritySettings);
      const kind = String(p.item_kind || 'product').toLowerCase();
      addedQueueIds.push(p.id);

      if (kind === 'accessory') {
        const exists =
          accessoryRows.some((r) => r.accessoryId && r.accessoryId === p.accessory_id) ||
          accessoryRows.some((r) => r.queueId === p.id);
        if (exists) continue;
        const label =
          accessoryCategoryLabelById.get(p.category_id) || p.category_label || 'Uncategorized';
        const defaultRate = accessoryCategoryDcPriceById.get(p.category_id) ?? 0;
        newAccessoryRows.push({
          rowId: makeLocalId(),
          categoryId: p.category_id || '',
          categoryLabel: label,
          accessoryId: p.accessory_id || null,
          name: p.name || label,
          qty: Number(p.qty || 1),
          rate: defaultRate,
          queueId: p.id,
        });
      } else {
        const exists = productRows.find((r) => r.productId === p.product_id);
        if (exists) continue;
        const daysLeft = p.daysLeft;
        newProductRows.push({
          rowId: makeLocalId(),
          productId: p.product_id,
          priority: p.priority || getPriority(daysLeft, prioritySettings),
          image: p.image || '',
          code: p.code || '',
          name: p.name || 'Product',
          categoryId: p.category_id || '',
          categoryLabel: categoryLabelById.get(p.category_id) || 'Uncategorized',
          size: '-',
          color: '-',
          qty: Number(p.qty || 1),
          maxQty: Number(p.qty || 1),
          nextPickupDate: p.nextPickupDate || '',
          daysLeft,
          scanStatus: 'Manual',
          bookingNo: p.nextBookingNo || p.order_number || '-',
          nextBookingOrderId: resolveNextBookingLink(p).orderId,
          upcomingBookings: p.upcomingBookings || [],
          customerName: p.nextCustomerName || '-',
          deliveryDate: '-',
          branchName: '-',
        });
      }
    }

    if (newProductRows.length) setProductRows((prev) => [...prev, ...newProductRows]);
    if (newAccessoryRows.length) setAccessoryRows((prev) => [...prev, ...newAccessoryRows]);
    if (addedQueueIds.length) setUsedQueueIds((prev) => [...prev, ...addedQueueIds]);
    setPendingWashingOpen(false);
    const total = newProductRows.length + newAccessoryRows.length;
    if (total > 0) {
      toast.success(`Added ${total} item(s) from washing queue`);
    }
  }, [
    pendingWashingItems,
    pendingWashingSelected,
    productRows,
    accessoryRows,
    categoryLabelById,
    accessoryCategoryLabelById,
    accessoryCategoryDcPriceById,
    prioritySettings,
  ]);

  const confirmBulkQueueRemove = async (adminPassword) => {
    const ids = [...pendingWashingSelected];
    if (!ids.length) return;
    setBulkQueueRemoveLoading(true);
    try {
      await washingQueueApi.bulkRemove(ids, adminPassword);
      setPendingWashingItems((prev) => prev.filter((p) => !pendingWashingSelected.has(p.id)));
      setPendingWashingSelected(new Set());
      setBulkQueueRemoveOpen(false);
      toast.success(`Removed ${ids.length} item(s) from washing queue`);
    } catch (e) {
      toast.error(
        e?.response?.data?.error?.message || e?.message || 'Could not remove selected items'
      );
      throw e;
    } finally {
      setBulkQueueRemoveLoading(false);
    }
  };

  const addProductRow = (p, scanStatus = false) => {
    if (!p) return;
    setProductRows((prev) => {
      const idx = prev.findIndex((r) => r.productId === p.id);
      const maxQty = Math.max(1, Number(p.qty || p.free_qty || 1));
      if (idx >= 0) {
        const next = [...prev];
        if (Number(next[idx].qty || 0) + 1 > maxQty) {
          toast.warning(`${p.name} max qty is ${maxQty}`);
          return prev;
        }
        next[idx] = { ...next[idx], qty: Number(next[idx].qty || 0) + 1 };
        toast.success(`${p.name} quantity increased`);
        return next;
      }
      const nextPickupDate = p.next_pickup_date || p.next_available_date;
      const daysLeft = getDaysLeft(nextPickupDate);
      return [
        ...prev,
        {
          rowId: makeLocalId(),
          productId: p.id,
          priority: getPriority(daysLeft, prioritySettings),
          image: p.main_image || '',
          code: p.code || '',
          name: p.name || 'Product',
          categoryId: p.category_id || '',
          categoryLabel: categoryLabelById.get(p.category_id) || 'Uncategorized',
          size: p.size || '-',
          color: p.color || '-',
          qty: 1,
          maxQty,
          nextPickupDate: nextPickupDate || '',
          daysLeft,
          scanStatus: scanStatus ? 'Scanned' : 'Manual',
          bookingNo: p.next_booking_no || '-',
          nextBookingOrderId: resolveNextBookingLink({
            upcoming_bookings: p.upcoming_bookings,
            upcomingBookings: p.upcomingBookings,
            bookingNo: p.next_booking_no,
          }).orderId,
          upcomingBookings: Array.isArray(p.upcoming_bookings)
            ? p.upcoming_bookings
            : Array.isArray(p.upcomingBookings)
              ? p.upcomingBookings
              : [],
          customerName: p.next_customer_name || '-',
          deliveryDate: p.next_delivery_date || '-',
          branchName: p.next_branch_name || '-',
        },
      ];
    });
  };

  const addAccessoryCategory = (categoryId) => {
    if (!categoryId) {
      toast.warning('Select an accessory category');
      return;
    }
    const label = accessoryCategoryLabelById.get(categoryId) || 'Category';
    const defaultRate = accessoryCategoryDcPriceById.get(categoryId) ?? 0;
    setAccessoryRows((prev) => [
      ...prev,
      {
        rowId: makeLocalId(),
        categoryId,
        categoryLabel: label,
        qty: 1,
        rate: defaultRate,
      },
    ]);
    setAccessoryCategoryPick('');
  };

  const resolveScanAndAdd = async (raw) => {
    const trimmed = String(raw || '').trim();
    const qLower = trimmed.toLowerCase();
    if (!trimmed) return;

    const matchRow = (row) =>
      [row.code, row.name, row.barcode, row.qr_code].some(
        (v) =>
          String(v || '')
            .trim()
            .toLowerCase() === qLower
      );

    let product = productPool.find(matchRow);
    if (!product) {
      try {
        const [listResp, availResp] = await Promise.all([
          productsApi.list({
            search: trimmed,
            category_id: productCategory || undefined,
            per_page: 30,
          }),
          productsApi.bookingAvailability({
            search: trimmed,
            from: laundryDateOnly,
            to: laundryDateOnly,
            qty: 1,
            category_id: productCategory || undefined,
            per_page: 30,
          }),
        ]);
        const listed = listResp?.data || [];
        const availability = availResp?.data || [];
        const byId = new Map(availability.map((r) => [r.id, r]));
        const merged = listed.map((row) => ({ ...row, ...byId.get(row.id) }));
        product = merged.find(matchRow);
        if (!product && merged.length === 1) product = merged[0];
      } catch {
        /* noop */
      }
    }
    if (product) {
      addProductRow(product, true);
      return;
    }

    toast.warning('No product found for scan/search');
  };

  const runGlobalAdd = (text) => {
    void resolveScanAndAdd(text);
  };

  const validateBeforeSave = () => {
    if (!vendorAccountId) return 'Select vendor account';
    if (productRows.length === 0 && accessoryRows.length === 0)
      return 'Add at least one product/accessory';
    const badProduct = productRows.find(
      (r) => Number(r.qty || 0) < 1 || Number(r.qty || 0) > Number(r.maxQty || 1)
    );
    if (badProduct) return `Invalid qty for ${badProduct.name}`;
    const badAccessory = accessoryRows.find((r) => Number(r.qty || 0) < 1);
    if (badAccessory) return `Invalid qty for ${badAccessory.categoryLabel}`;
    if (riskRows.length > 0 && !overrideRisk) {
      return 'Urgent pickup risk exists. Tick override to continue.';
    }
    return '';
  };

  const saveJob = (mode) =>
    runSave(async () => {
      const err = validateBeforeSave();
      if (err) {
        toast.error(err);
        return;
      }
      let savedJobNo = jobNo;
      let savedJob = null;
      try {
        const payload = {
          laundryDate: laundryDate || defaultLaundryDatetimeLocal(),
          vendorAccountId: vendorAccountId || null,
          vendorName: vendorAccounts.find((v) => v.id === vendorAccountId)?.name || '-',
          pickupBy,
          pickupAt: null,
          returnAt: null,
          remarks,
          productRows: productRows.map((row) => ({
            productId: row.productId || null,
            categoryId: row.categoryId || null,
            categoryLabel: row.categoryLabel || null,
            code: row.code || null,
            name: row.name,
            image: row.image || null,
            nextPickupDate: pickDateOnly(row.nextPickupDate),
            daysLeft: row.daysLeft ?? null,
            priority: row.priority || 'No Schedule',
            qty: Number(row.qty || 1),
            bookingNo: row.bookingNo && row.bookingNo !== '-' ? row.bookingNo : null,
          })),
          accessoryRows: accessoryRows.map((row) => ({
            categoryId: row.categoryId,
            categoryLabel: row.categoryLabel,
            name: row.categoryLabel,
            qty: Number(row.qty || 1),
            rate: Number(row.rate || 0),
          })),
          categorySummaries: categorySummaries.map((row) => ({
            ...row,
            washPrice: Number(categoryWashRates[row.key] || 0),
          })),
          productTotal,
          accessoryTotal,
          subtotal,
          discountMode,
          discountValue,
          discountAmount,
          payable,
          queueIds: usedQueueIds,
        };
        if (editingJobId) {
          const resp = await laundryApi.update(editingJobId, payload);
          savedJob = resp?.data || null;
          savedJobNo = savedJob?.jobNo || jobNo;
        } else {
          const resp = await laundryApi.create(payload);
          savedJob = resp?.data || null;
          savedJobNo = savedJob?.jobNo || '';
          setJobNo(savedJobNo);
        }
      } catch (e) {
        const msg = e?.response?.data?.error?.message || e?.message || 'Failed to save laundry job';
        toast.error(msg);
        return;
      }
      const msg =
        mode === 'print'
          ? 'Laundry job saved and print opened'
          : mode === 'new'
            ? 'Laundry job saved, ready for new entry'
            : 'Laundry job saved';
      toast.success(msg);
      if (mode === 'print') {
        if (savedJob) {
          printLaundrySlip(savedJob);
        } else {
          printLaundrySlip({
            jobNo: savedJobNo,
            laundryDate,
            vendor: selectedVendorName || '-',
            pickupBy,
            remarks,
            productRows,
            accessoryRows: accessoryRows.map((row) => ({
              categoryId: row.categoryId,
              categoryLabel: row.categoryLabel,
              name: row.categoryLabel,
              qty: Number(row.qty || 1),
              rate: Number(row.rate || 0),
            })),
            categorySummaries,
            categoryWashRates,
            productTotal,
            accessoryTotal,
            subtotal,
            discountAmount,
            payable,
          });
        }
      }
      if (mode === 'new') {
        setJobNo('');
        setVendorAccountId('');
        setPickupBy('');
        setLaundryDate(defaultLaundryDatetimeLocal());
        setRemarks('');
        setProductRows([]);
        setCategoryWashRates({});
        setAccessoryRows([]);
        setDiscountValue(0);
        setOverrideRisk(false);
        setUsedQueueIds([]);
        setGlobalSearch('');
        setProductSearch('');
        setAccessoryCategoryPick('');
      } else if (mode === 'save') {
        navigate('/laundry');
      }
    });

  return (
    <>
      <PageHeader
        title={`Laundry Management / ${editingJobId ? 'Edit Laundry Job' : 'Create Laundry Job'}`}
        description="Dashboard / Laundry / Create Job"
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" icon={ArrowLeft} onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button size="sm" icon={Save} loading={saveBusy} onClick={() => saveJob('save')}>
              Save
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={Printer}
              loading={saveBusy}
              onClick={() => saveJob('print')}
            >
              Save & Print
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={Plus}
              loading={saveBusy}
              onClick={() => saveJob('new')}
            >
              Save & New
            </Button>
          </div>
        }
      />

      <div className="space-y-2 pb-20">
        <section className="card p-2">
          <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">Basic Information</h3>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <Field label="Laundry date & time">
                <input
                  className="input h-8 text-xs"
                  type="datetime-local"
                  value={laundryDate}
                  onChange={(e) => setLaundryDate(e.target.value)}
                />
              </Field>
              <Field label="Laundry Job No">
                <input className="input h-8 text-xs" value={jobNo || 'Assigned on save'} readOnly />
              </Field>
              <Field label="Vendor Account">
                <select
                  className="input h-8 text-xs"
                  value={vendorAccountId}
                  onChange={(e) => setVendorAccountId(e.target.value)}
                >
                  <option value="">Select vendor account</option>
                  {vendorAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.contact_no ? ` · ${a.contact_no}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Pickup By">
                <input
                  className="input h-8 text-xs"
                  value={pickupBy}
                  onChange={(e) => setPickupBy(e.target.value)}
                  placeholder="Staff name"
                />
              </Field>
              <Field label="Remarks">
                <input
                  className="input h-8 text-xs"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </div>
            {vendorPreviewOutstanding ? (
              <VendorOutstandingSummary
                vendorOutstanding={vendorPreviewOutstanding}
                currentBillAmount={payable}
                currentBillId={editingJobId || 'draft'}
                compact
              />
            ) : null}
            {riskRows.length > 0 ? (
              <div className="border border-amber-200 bg-amber-50 rounded px-2 py-1.5 text-[11px] text-amber-900">
                <div className="font-medium flex items-center gap-1">
                  <AlertTriangle size={12} /> Urgent return risk detected
                </div>
                <div>
                  {riskRows[0].name} pickup {riskRows[0].nextPickupDate} may conflict with laundry
                  date.
                </div>
                <label className="inline-flex items-center gap-1 mt-1">
                  <input
                    type="checkbox"
                    checked={overrideRisk}
                    onChange={(e) => setOverrideRisk(e.target.checked)}
                  />
                  Override with permission
                </label>
              </div>
            ) : null}
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-2">
          <section className="card p-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-900 uppercase">
                Products Send to Laundry
              </h3>
              <Button
                size="sm"
                variant="secondary"
                icon={Package}
                onClick={loadPendingWashing}
                disabled={pendingWashingLoading}
              >
                {pendingWashingLoading ? 'Loading...' : 'Load Washing Queue'}
              </Button>
            </div>
            <div className="grid grid-cols-[180px_1fr_auto] gap-2 mb-2">
              <select
                className="input h-8 text-xs"
                value={productCategory}
                onChange={(e) => setProductCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {productCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-2 text-gray-400" />
                <input
                  className="input h-8 text-xs pl-7"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && productMatches[0]) addProductRow(productMatches[0]);
                  }}
                  placeholder="Search name/code/barcode/QR"
                />
                {productSearch.trim().length >= 1 ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] border border-gray-200 rounded bg-white max-h-40 overflow-auto z-20 shadow-sm">
                    {productSearching ? (
                      <div className="px-2 py-1 text-[11px] text-gray-500">Searching...</div>
                    ) : null}
                    {!productSearching && productMatches.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-gray-500">No products found</div>
                    ) : null}
                    {productMatches.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="w-full px-2 py-1 text-left hover:bg-gray-50 text-[11px] border-b border-gray-100 last:border-b-0"
                        onClick={() => {
                          addProductRow(p);
                          setProductSearch('');
                        }}
                      >
                        {p.code} · {p.name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={Camera}
                onClick={() => setScannerOpen(true)}
              >
                Scan
              </Button>
            </div>

            <div className="max-h-[46vh] overflow-auto border border-gray-200 rounded">
              <table className="table w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                  <tr className="h-7">
                    <th className="px-1">
                      <TableHeaderLabel align="left" nowrap>
                        Remove
                      </TableHeaderLabel>
                    </th>
                    <th className="px-1">
                      <TableHeaderLabel align="left">Priority</TableHeaderLabel>
                    </th>
                    <th className="px-1 text-left">
                      <TableHeaderLabel align="left">Code</TableHeaderLabel>
                    </th>
                    <th className="px-1">
                      <TableHeaderLabel align="left">Image</TableHeaderLabel>
                    </th>
                    <th className="px-1 text-left">
                      <TableHeaderLabel align="left">Name</TableHeaderLabel>
                    </th>
                    <th className="px-1">
                      <TableHeaderLabel align="left">Next booking</TableHeaderLabel>
                    </th>
                    <th className="px-1">
                      <TableHeaderLabel align="left">Next Pickup</TableHeaderLabel>
                    </th>
                    <th className="px-1">
                      <TableHeaderLabel align="left">Days Left</TableHeaderLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProductRows.map((row) => (
                    <tr key={row.rowId} className="border-b border-gray-100 h-8">
                      <td className="text-center">
                        <button
                          type="button"
                          aria-label={`Remove ${row.name}`}
                          onClick={() =>
                            setProductRows((p) => p.filter((r) => r.rowId !== row.rowId))
                          }
                        >
                          <Trash2 size={13} className="text-gray-500 hover:text-red-600" />
                        </button>
                      </td>
                      <td className="text-center">
                        <span className={`rounded px-1 py-0.5 ${PRIORITY_TONE[row.priority]}`}>
                          {row.priority}
                        </span>
                      </td>
                      <td className="px-1 font-mono">{row.code}</td>
                      <td className="text-center">
                        {row.image ? (
                          <SmartImage
                            src={row.image}
                            alt={row.name}
                            className="w-6 h-6 rounded object-contain inline-block border border-gray-200"
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="px-1"
                        title={`Customer: ${row.customerName}\nPickup: ${row.nextPickupDate || '-'}\nDelivery: ${row.deliveryDate || '-'}\nBranch: ${row.branchName || '-'}`}
                      >
                        {row.name}
                      </td>
                      <td className="px-1 font-mono">
                        {(() => {
                          const next = resolveNextBookingLink(row);
                          return (
                            <BookingBillLink orderId={next.orderId}>
                              {next.label || '—'}
                            </BookingBillLink>
                          );
                        })()}
                      </td>
                      <td className="text-center">{formatDate(row.nextPickupDate) || '-'}</td>
                      <td className="text-center">{row.daysLeft ?? '-'}</td>
                    </tr>
                  ))}
                  {sortedProductRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-5 text-gray-500">
                        No products selected.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {categorySummaries.length > 0 ? (
              <div className="mt-2 border border-gray-200 rounded">
                <div className="px-2 py-1 text-[11px] font-semibold text-gray-700 bg-gray-50">
                  Category Wash Price
                </div>
                <table className="table w-full text-[11px]">
                  <thead className="border-b border-gray-200">
                    <tr className="h-7">
                      <th className="px-2 text-left">
                        <TableHeaderLabel align="left">Category</TableHeaderLabel>
                      </th>
                      <th className="px-2 text-center">
                        <TableHeaderLabel align="center">Products</TableHeaderLabel>
                      </th>
                      <th className="px-2 text-center">
                        <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                      </th>
                      <th className="px-2 text-right">
                        <TableHeaderLabel align="right">Wash Price</TableHeaderLabel>
                      </th>
                      <th className="px-2 text-right">
                        <TableHeaderLabel align="right">Total</TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {categorySummaries.map((row) => {
                      const rate = Number(categoryWashRates[row.key] || 0);
                      const total = row.qtyTotal * rate;
                      return (
                        <tr key={row.key} className="border-b border-gray-100 last:border-b-0 h-8">
                          <td className="px-2">{row.label}</td>
                          <td className="px-2 text-center">{row.productCount}</td>
                          <td className="px-2 text-center">{row.qtyTotal}</td>
                          <td className="px-2 text-right">
                            <input
                              className="w-20 border border-gray-200 rounded text-right px-1 h-7"
                              type="number"
                              min="0"
                              value={rate}
                              onChange={(e) =>
                                setCategoryWashRates((prev) => ({
                                  ...prev,
                                  [row.key]:
                                    e.target.value === '' ? '' : Number(e.target.value) || 0,
                                }))
                              }
                            />
                          </td>
                          <td className="px-2 text-right">{formatCurrency(total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="card p-2">
            <h3 className="text-xs font-semibold text-gray-900 mb-2 uppercase">
              Accessories Send to Laundry
            </h3>
            <p className="text-[11px] text-gray-500 mb-2">
              Add by accessory category — enter qty and rate per category.
            </p>
            <div className="grid grid-cols-[1fr_auto] gap-2 mb-2">
              <select
                className="input h-8 text-xs"
                value={accessoryCategoryPick}
                onChange={(e) => setAccessoryCategoryPick(e.target.value)}
              >
                <option value="">Select category</option>
                {washableAccessoryCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                icon={Plus}
                onClick={() => addAccessoryCategory(accessoryCategoryPick)}
              >
                Add category
              </Button>
            </div>

            <div className="max-h-[46vh] overflow-auto border border-gray-200 rounded">
              <table className="table w-full text-[11px]">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                  <tr className="h-7">
                    <th className="px-1">
                      <TableHeaderLabel align="left" nowrap>
                        Remove
                      </TableHeaderLabel>
                    </th>
                    <th className="px-2 text-left">
                      <TableHeaderLabel align="left">Category</TableHeaderLabel>
                    </th>
                    <th className="px-1 text-center">
                      <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                    </th>
                    <th className="px-1 text-right">
                      <TableHeaderLabel align="right">Rate</TableHeaderLabel>
                    </th>
                    <th className="px-1 text-right">
                      <TableHeaderLabel align="right">Total</TableHeaderLabel>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accessoryGroups.map((group) => {
                    const rowIds = new Set(group.rows.map((row) => row.rowId));
                    const detailRows = group.rows.filter(
                      (row) => row.accessoryId || row.name !== row.categoryLabel
                    );
                    const expanded = expandedAccessoryCategories.has(group.key);
                    const onlyManualRow = group.rows.length === 1 && !group.rows[0].accessoryId;
                    const rate = Number(group.rows[0]?.rate || 0);
                    return (
                      <Fragment key={group.key}>
                        <tr className="border-b border-gray-100 h-8">
                          <td className="text-center">
                            <button
                              type="button"
                              aria-label={`Remove ${group.label}`}
                              onClick={() =>
                                setAccessoryRows((rows) =>
                                  rows.filter((row) => !rowIds.has(row.rowId))
                                )
                              }
                            >
                              <Trash2 size={13} className="text-gray-500 hover:text-red-600" />
                            </button>
                          </td>
                          <td className="px-2 font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-left hover:text-brand disabled:cursor-default disabled:text-gray-900"
                              disabled={detailRows.length === 0}
                              onClick={() =>
                                setExpandedAccessoryCategories((current) => {
                                  const next = new Set(current);
                                  if (next.has(group.key)) next.delete(group.key);
                                  else next.add(group.key);
                                  return next;
                                })
                              }
                              aria-expanded={expanded}
                            >
                              {detailRows.length > 0 ? (
                                expanded ? (
                                  <ChevronDown size={13} />
                                ) : (
                                  <ChevronRight size={13} />
                                )
                              ) : null}
                              {group.label}
                            </button>
                          </td>
                          <td className="text-center">
                            {onlyManualRow ? (
                              <input
                                className="w-12 border border-gray-200 rounded text-center h-7"
                                type="number"
                                min="1"
                                value={group.rows[0].qty}
                                onChange={(event) =>
                                  setAccessoryRows((rows) =>
                                    rows.map((row) =>
                                      row.rowId === group.rows[0].rowId
                                        ? {
                                            ...row,
                                            qty:
                                              event.target.value === ''
                                                ? ''
                                                : Math.max(1, Number(event.target.value) || 1),
                                          }
                                        : row
                                    )
                                  )
                                }
                              />
                            ) : (
                              <span className="tabular-nums">{group.qty}</span>
                            )}
                          </td>
                          <td className="text-right px-1">
                            <input
                              className="w-16 border border-gray-200 rounded text-right px-1 h-7"
                              type="number"
                              min="0"
                              value={rate}
                              onChange={(event) =>
                                setAccessoryRows((rows) =>
                                  rows.map((row) =>
                                    rowIds.has(row.rowId)
                                      ? {
                                          ...row,
                                          rate:
                                            event.target.value === ''
                                              ? ''
                                              : Number(event.target.value) || 0,
                                        }
                                      : row
                                  )
                                )
                              }
                            />
                          </td>
                          <td className="text-right px-2 tabular-nums">
                            {formatCurrency(group.lineTotal)}
                          </td>
                        </tr>
                        {expanded && detailRows.length > 0 ? (
                          <tr className="border-b border-gray-100 bg-gray-50">
                            <td />
                            <td colSpan={4} className="px-3 py-2">
                              <div className="space-y-1">
                                {detailRows.map((row) => (
                                  <div
                                    key={row.rowId}
                                    className="flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <span>{row.name || 'Accessory'}</span>
                                    <span className="tabular-nums text-gray-500">
                                      Qty {Number(row.qty || 0)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {accessoryRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-5 text-gray-500">
                        No accessory categories added.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-1 text-[11px] text-gray-600">
              Accessory total: <b>{formatCurrency(accessoryTotal)}</b>
            </div>
          </section>
        </div>
      </div>

      <div className="fixed bottom-0 left-60 right-0 bg-white border-t border-gray-200 px-3 py-2 z-20">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs items-center">
          <Metric label="Product Total" value={formatCurrency(productTotal)} />
          <Metric label="Accessory Total" value={formatCurrency(accessoryTotal)} />
          <Metric label="Subtotal" value={formatCurrency(subtotal)} />
          <div>
            <div className="text-gray-500">Discount</div>
            <div className="flex items-center gap-1">
              <select
                className="border border-gray-200 rounded h-7 text-[11px]"
                value={discountMode}
                onChange={(e) => setDiscountMode(e.target.value)}
              >
                <option value="fixed">Rs</option>
                <option value="percent">%</option>
              </select>
              <input
                className="border border-gray-200 rounded h-7 w-16 text-right px-1"
                type="number"
                min="0"
                value={discountValue}
                onChange={(e) =>
                  setDiscountValue(e.target.value === '' ? '' : Number(e.target.value) || 0)
                }
              />
            </div>
          </div>
          <Metric label="Payable Amount" value={formatCurrency(payable)} strong />
          <div>
            <div className="text-gray-500">Quick Add Search</div>
            <input
              className="border border-gray-200 rounded h-7 w-full px-1"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runGlobalAdd(globalSearch);
              }}
              placeholder="Code/barcode/name"
            />
          </div>
        </div>
      </div>

      {pendingWashingOpen ? (
        <Modal
          isOpen={pendingWashingOpen}
          onClose={() => setPendingWashingOpen(false)}
          title="Washing Queue"
          size="xl"
          closeOnBackdrop={false}
          bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pendingWashingSelected.size === 0 || bulkQueueRemoveLoading}
                onClick={() => setBulkQueueRemoveOpen(true)}
              >
                Remove selected ({pendingWashingSelected.size})
              </Button>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPendingWashingOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={addPendingWashingProducts}
                  disabled={pendingWashingSelected.size === 0}
                >
                  Add Selected ({pendingWashingSelected.size})
                </Button>
              </div>
            </div>
          }
        >
          <div className="flex flex-nowrap items-center gap-2 border-b border-gray-200 px-4 py-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={14}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                className="input h-8 w-full pl-7 text-xs"
                value={pendingWashingSearch}
                onChange={(e) => setPendingWashingSearch(e.target.value)}
                placeholder="Search code / name / order / next booking"
                aria-label="Search washing queue"
              />
            </div>
            <select
              className="input h-8 w-36 shrink-0 bg-surface text-xs"
              value={pendingWashingSort}
              onChange={(e) => setPendingWashingSort(e.target.value)}
              aria-label="Sort washing queue"
            >
              {QUEUE_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  Sort by {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 overflow-auto px-4 py-2">
              {pendingWashingItems.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">No items in washing queue.</p>
              ) : filteredPendingWashingItems.length === 0 ? (
                <p className="text-xs text-gray-500 py-6 text-center">
                  No items match your search.
                </p>
              ) : (
                <table className="table w-full text-[11px]">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                    <tr className="h-7">
                      <th className="px-1 w-8">
                        <input
                          type="checkbox"
                          checked={
                            filteredPendingWashingItems.length > 0 &&
                            filteredPendingWashingItems.every((item) =>
                              pendingWashingSelected.has(item.id)
                            )
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPendingWashingSelected((prev) => {
                                const next = new Set(prev);
                                filteredPendingWashingItems.forEach((item) => next.add(item.id));
                                return next;
                              });
                            } else {
                              setPendingWashingSelected((prev) => {
                                const next = new Set(prev);
                                filteredPendingWashingItems.forEach((item) => next.delete(item.id));
                                return next;
                              });
                            }
                          }}
                        />
                      </th>
                      <th className="px-1 text-center">
                        <TableHeaderLabel align="center">Priority</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">Type</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">Code</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">Name</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">Category</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-center">
                        <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">From Order</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">Next Booking</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-center">
                        <TableHeaderLabel align="center">Next Pickup</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-center">
                        <TableHeaderLabel align="center">Days Left</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-left">
                        <TableHeaderLabel align="left">Queued At</TableHeaderLabel>
                      </th>
                      <th className="px-1 text-center">
                        <TableHeaderLabel align="center" nowrap>
                          Action
                        </TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPendingWashingItems.map((item) => {
                      const presented = presentWashingQueueItem(item, prioritySettings);
                      const isAccessory =
                        String(item.item_kind || 'product').toLowerCase() === 'accessory';
                      const alreadyAdded = isAccessory
                        ? accessoryRows.some(
                            (r) =>
                              r.queueId === item.id ||
                              (r.accessoryId && r.accessoryId === item.accessory_id)
                          )
                        : productRows.some((r) => r.productId === item.product_id);
                      return (
                        <tr
                          key={item.id}
                          className={`border-b border-gray-100 h-8 ${alreadyAdded ? 'opacity-50' : ''}`}
                        >
                          <td className="px-1 text-center">
                            <input
                              type="checkbox"
                              disabled={alreadyAdded}
                              checked={pendingWashingSelected.has(item.id)}
                              onChange={(e) => {
                                setPendingWashingSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(item.id);
                                  else next.delete(item.id);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td className="px-1 text-center">
                            <span
                              className={`rounded px-1 py-0.5 ${PRIORITY_TONE[item.priority] || PRIORITY_TONE['No Schedule']}`}
                            >
                              {item.priority}
                            </span>
                          </td>
                          <td className="px-1 text-center">
                            <span
                              className={`rounded px-1 py-0.5 text-[10px] ${isAccessory ? 'bg-brand-light text-brand' : 'bg-gray-100 text-gray-700'}`}
                            >
                              {isAccessory ? 'Accessory' : 'Product'}
                            </span>
                          </td>
                          <td className="px-1 font-mono">{item.code}</td>
                          <td
                            className="px-1"
                            title={`Next Booking: ${item.nextBookingNo || '-'}\nCustomer: ${item.nextCustomerName || '-'}\nPickup: ${item.nextPickupDate || '-'}`}
                          >
                            {item.name}
                            {alreadyAdded ? ' (already added)' : ''}
                          </td>
                          <td className="px-1">{item.category_label || 'Uncategorized'}</td>
                          <td className="px-1 text-center">{item.qty}</td>
                          <td className="px-1">
                            <BookingBillLink
                              orderId={item.order_id}
                              onNavigate={() => setPendingWashingOpen(false)}
                            >
                              {item.order_number || '-'}
                            </BookingBillLink>
                          </td>
                          <td className="px-1 font-mono">
                            {(() => {
                              const next = resolveNextBookingLink(item);
                              return (
                                <BookingBillLink
                                  orderId={next.orderId}
                                  onNavigate={() => setPendingWashingOpen(false)}
                                >
                                  {next.label || '-'}
                                </BookingBillLink>
                              );
                            })()}
                          </td>
                          <td className="px-1 text-center">
                            <UpcomingPickupDates bookings={item.upcomingBookings} />
                          </td>
                          <td className="px-1 text-center">{item.daysLeft ?? '-'}</td>
                          <td className="px-1 whitespace-nowrap tabular-nums">
                            {formatWallClockDateTime(item.queued_at) || '-'}
                          </td>
                          <td className="px-1 text-center">
                            <button
                              type="button"
                              className="text-red-600 hover:underline text-[10px] disabled:opacity-50"
                              disabled={queueRemoveLoading}
                              onClick={() => requestQueueRemove(item)}
                            >
                              {queueRemoveLoading && queueRemoveTarget?.id === item.id
                                ? 'Removing...'
                                : 'Remove'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        </Modal>
      ) : null}

      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuousScan
        onDetected={(value) => {
          setGlobalSearch(value);
          void resolveScanAndAdd(value);
        }}
        title="Scan Product / Accessory"
      />

      <AdminPasswordModal
        isOpen={bulkQueueRemoveOpen}
        onClose={() => setBulkQueueRemoveOpen(false)}
        onConfirm={confirmBulkQueueRemove}
        title="Remove selected from washing queue?"
        description="Enter Shop Admin password to remove all selected queue items at once."
        confirmLabel="Remove selected"
        confirmVariant="danger"
        loading={bulkQueueRemoveLoading}
        shopName={selectedShopName}
      />

      <AdminDeleteModal
        isOpen={Boolean(queueRemoveTarget)}
        onClose={closeQueueRemoveModal}
        onConfirm={confirmQueueRemove}
        title="Remove from washing queue?"
        description="This product will be removed from the washing queue and become available again."
        itemLabel={
          queueRemoveTarget
            ? `${queueRemoveTarget.code || ''} ${queueRemoveTarget.name || ''}`.trim()
            : ''
        }
        shopName={selectedShopName}
        errorMessage={queueRemoveError}
        onClearError={clearQueueRemoveError}
        loading={queueRemoveLoading}
        confirmLabel="Remove"
      />
    </>
  );
};

const Field = ({ label, children }) => (
  <div>
    <div className="text-[11px] text-gray-500 mb-0.5">{label}</div>
    {children}
  </div>
);

const Metric = ({ label, value, strong = false }) => (
  <div>
    <div className="text-gray-500">{label}</div>
    <div className={strong ? 'font-semibold text-gray-900' : 'text-gray-800'}>{value}</div>
  </div>
);

function makeLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `lj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export default CreateLaundryJob;
