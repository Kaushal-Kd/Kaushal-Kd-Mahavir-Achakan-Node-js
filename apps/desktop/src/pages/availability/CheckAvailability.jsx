import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { earliestPickupAfterReturnGap, formatCurrency, formatDate, formatDateTime, isIndianPhone, latestReturnBeforePickupGap, normalizeProductCode, toLocalISODate } from '@wrs/shared';
import clsx from 'clsx';
import {
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  History,
  PackagePlus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  User,
  UserPlus,
  XCircle,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import { resolveNextBookingLink } from '../laundry/laundryQueueUtils.js';
import BookingDraftActions from '../../components/booking/BookingDraftActions.jsx';
import AvailabilityCartAccessoriesModal from '../../components/booking/AvailabilityCartAccessoriesModal.jsx';
import AvailabilityCartProductNotesModal from '../../components/booking/AvailabilityCartProductNotesModal.jsx';
import ProductRentalHistoryModal from '../../components/booking/ProductRentalHistoryModal.jsx';
import UpcomingPickupDates from '../../components/booking/UpcomingPickupDates.jsx';
import Badge from '../../components/ui/Badge.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import BarcodeScannerModal from '../../components/ui/BarcodeScannerModal.jsx';
import Button from '../../components/ui/Button.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import { customersApi } from '../../lib/api/customers.js';
import {
  addProductToAvailabilityCart,
  AVAILABILITY_CART_DRAFT_KIND,
  cartLineSortTime,
  draftToCartLine,
  sortCartLinesNewestFirst,
  stripAvailabilityCartDraftMeta,
} from '../../lib/availabilityCart.js';
import {
  fetchRelatedProductAvailability,
  relatedToCartProduct,
} from '../../lib/availabilityRelatedProducts.js';
import { draftsApi } from '../../lib/api/drafts.js';
import { productsApi } from '../../lib/api/products.js';
import { washingQueueApi } from '../../lib/api/washingQueue.js';
import { timeSlotsApi } from '../../lib/api/timeSlots.js';
import {
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
  FALLBACK_TIME_OPTIONS,
  resolveTimeSlotDefaults,
  timeSlotsToSelectOptions,
} from '../../lib/timeSelectOptions.js';
import { countSelectedAccessories } from '../../lib/bookingAccessoryCart.js';
import { useAppSettings } from '../../hooks/useAppSettings.js';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { validateRentProductQty } from '../../lib/productAvailability.js';
import { toast } from '../../stores/uiStore.js';
import { queryKeys } from '../../lib/queryKeys.js';

const STATUS_TONE = {
  booked: 'yellow',
  pending: 'yellow',
  confirmed: 'brand',
  item_to_collect: 'brand',
  in_preparation: 'brand',
  ready_for_delivery: 'brand',
  delivered: 'brand',
  partially_returned: 'yellow',
  returned: 'gray',
  cancelled: 'gray',
  closed: 'gray',
};

/** @param {{ code?: string } | null | undefined} product @param {string} input */
function productMatchesCodeInput(product, input) {
  const trimmed = String(input || '').trim();
  if (!trimmed || !product?.code) return false;
  const code = String(product.code);
  if (code.toLowerCase() === trimmed.toLowerCase()) return true;
  return normalizeProductCode(code).toLowerCase() === normalizeProductCode(trimmed).toLowerCase();
}

const AvailabilityHoldBadges = ({ badges, compact = false }) => {
  if (!Array.isArray(badges) || badges.length === 0) return null;
  return (
    <span className={clsx('inline-flex flex-wrap items-center justify-center gap-1', compact && 'max-w-full')}>
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={clsx(
            'inline-flex items-center gap-1 rounded-full border font-semibold shrink-0',
            compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
            badge.tone === 'orange' && 'border-orange-200 bg-orange-50 text-orange-800',
            badge.tone === 'brand' && 'border-brand/30 bg-brand/10 text-brand',
            (!badge.tone || badge.tone === 'gray') && 'border-gray-200 bg-gray-50 text-gray-700'
          )}
        >
          {badge.label} · {badge.qty}
        </span>
      ))}
    </span>
  );
};

AvailabilityHoldBadges.propTypes = {
  badges: PropTypes.arrayOf(
    PropTypes.shape({
      key: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      qty: PropTypes.number.isRequired,
      tone: PropTypes.string,
    })
  ),
  compact: PropTypes.bool,
};

AvailabilityHoldBadges.defaultProps = {
  badges: [],
  compact: false,
};

const CheckAvailability = () => {
  const navigate = useNavigate();
  const appSettings = useAppSettings();
  const allowProductAutocomplete = appSettings.isYes('ALLOW_AUTOCOMPLETE_FOR_CODE', 'Yes');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const [tab, setTab] = useState(searchParams.get('tab') === 'cart' ? 'cart' : 'check');

  const switchTab = (nextTab) => {
    setTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    if (nextTab === 'cart') nextParams.set('tab', 'cart');
    else nextParams.delete('tab');
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    const nextTab = searchParams.get('tab') === 'cart' ? 'cart' : 'check';
    setTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [searchParams]);

  const [code, setCode] = useState('');
  const [qty, setQty] = useState(1);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState(FALLBACK_DEFAULT_DELIVERY_TIME);
  const [returnTime, setReturnTime] = useState(FALLBACK_DEFAULT_RETURN_TIME);

  const [codeOpen, setCodeOpen] = useState(false);
  const [codeHighlight, setCodeHighlight] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProductSnapshot, setHistoryProductSnapshot] = useState(null);

  const [customerQuery, setCustomerQuery] = useState('');
  const [customer, setCustomer] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);

  const [checkResult, setCheckResult] = useState(null);
  /** Linked products with availability for the same date window. */
  const [relatedRows, setRelatedRows] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [productDetailsOpen, setProductDetailsOpen] = useState(true);

  const [cart, setCart] = useState([]);
  const [cartLoading, setCartLoading] = useState(true);
  const [cartSaving, setCartSaving] = useState(false);
  const [clearCartConfirmOpen, setClearCartConfirmOpen] = useState(false);
  const [accessoryModalLine, setAccessoryModalLine] = useState(null);
  const [noteModalLine, setNoteModalLine] = useState(null);
  // Customer chosen from the existing cart for the Quick Bill action.
  const [billCustomerId, setBillCustomerId] = useState('');

  // Hydrate the cart from the drafts table on mount so it survives refreshes
  // and so every user of the shop sees the same in-progress cart.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await draftsApi.list({ kind: AVAILABILITY_CART_DRAFT_KIND });
        if (cancelled) return;
        const rows = sortCartLinesNewestFirst((res?.data || []).map(draftToCartLine));
        setCart(rows);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err?.response?.data?.error?.message || 'Could not load saved cart'
          );
        }
      } finally {
        if (!cancelled) setCartLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await productsApi.checkAvailability(payload);
      const data = res?.data || res;
      const productId = data?.product?.id;
      let related = [];
      if (productId && payload.from && payload.to) {
        related = await fetchRelatedProductAvailability({
          productId,
          from: payload.from,
          to: payload.to,
          qty: 1,
        });
      }
      return { data, related };
    },
    onSuccess: ({ data, related }) => {
      setCheckResult(data);
      setRelatedRows(
        (related || []).map((row) => {
          const available = !!row.result?.available;
          return {
            ...row,
            selected: available,
          };
        })
      );
      setRelatedLoading(false);
      setProductDetailsOpen(true);
    },
    onError: (err) => {
      setCheckResult(null);
      setRelatedRows([]);
      setRelatedLoading(false);
      toast.error(
        err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err.message ||
          'Lookup failed'
      );
    },
  });

  const { data: customerResults } = useQuery({
    queryKey: ['customer-search', customerQuery],
    queryFn: () => customersApi.search(customerQuery),
    enabled: customerQuery.trim().length >= 2,
  });

  const timeSlotsQuery = useQuery({
    queryKey: ['time-slots'],
    queryFn: () => timeSlotsApi.list(),
  });
  const defaultBookingTimes = useMemo(
    () => resolveTimeSlotDefaults(timeSlotsQuery.data),
    [timeSlotsQuery.data]
  );
  const defaultTimesAppliedRef = useRef(false);
  const timeSelectOptions = useMemo(() => {
    const rows = timeSlotsQuery.data?.data || [];
    return rows.length ? timeSlotsToSelectOptions(rows) : FALLBACK_TIME_OPTIONS;
  }, [timeSlotsQuery.data?.data]);

  useEffect(() => {
    if (defaultTimesAppliedRef.current) return;
    if (!timeSlotsQuery.isSuccess) return;
    defaultTimesAppliedRef.current = true;
    setDeliveryTime(defaultBookingTimes.delivery);
    setReturnTime(defaultBookingTimes.return);
  }, [timeSlotsQuery.isSuccess, defaultBookingTimes.delivery, defaultBookingTimes.return]);

  const quickCustomerCreateMutation = useMutation({
    mutationFn: (payload) => customersApi.quickAvailabilityCreate(payload),
    onSuccess: (res) => {
      const created = res?.data || res;
      toast.success(`Created ${created.name}`);
      setCustomer(created);
      setCustomerQuery('');
      setCustomerOpen(false);
      queryClient.invalidateQueries({ queryKey: ['customer-search'] });
    },
    onError: (err) => {
      const msg =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err.message ||
        'Failed to create customer';
      toast.error(msg);
    },
  });

  const tryInlineCreateCustomerFromSearch = () => {
    const q = customerQuery.trim();
    if (!q) {
      toast.warning('Enter customer name or mobile number');
      return;
    }
    if (/^\d+$/.test(q) && !isIndianPhone(q)) {
      toast.warning('Enter valid 10-digit mobile number or customer name');
      return;
    }
    if (isIndianPhone(q)) {
      quickCustomerCreateMutation.mutate({ name: '', phone1: q });
      return;
    }
    quickCustomerCreateMutation.mutate({ name: q, phone1: '' });
  };

  const productSearchQuery = useQuery({
    queryKey: ['product-code-search', code],
    queryFn: () => {
      const q = code.trim();
      return productsApi.list({ search: q, per_page: 20 }).then((r) => r.data || []);
    },
    enabled: allowProductAutocomplete && code.trim().length >= 1,
    keepPreviousData: true,
  });

  const pickProductCode = (picked) => {
    setCode(picked?.code || '');
    setCodeOpen(false);
    setCheckResult(null);
    setRelatedRows([]);
  };

  const selectedRelatedCount = useMemo(
    () => relatedRows.filter((r) => r.selected && r.result?.available).length,
    [relatedRows]
  );

  const toggleRelatedSelected = (relatedProductId, nextSelected) => {
    const id = String(relatedProductId || '');
    setRelatedRows((prev) =>
      prev.map((row) => {
        if (String(row.related?.related_product_id || '') !== id) return row;
        if (!row.result?.available) return { ...row, selected: false };
        return { ...row, selected: nextSelected };
      })
    );
  };

  const productMatches = productSearchQuery.data || [];

  const selectedCodeProduct = useMemo(() => {
    const trimmed = code.trim();
    if (!trimmed) return null;
    const exact = productMatches.find((p) => productMatchesCodeInput(p, trimmed));
    if (exact) return exact;
    if (checkResult?.product && productMatchesCodeInput(checkResult.product, trimmed)) {
      return checkResult.product;
    }
    return null;
  }, [code, productMatches, checkResult?.product]);
  const selectedCodeAvailability = useMemo(() => {
    if (!checkResult?.product || !selectedCodeProduct) return null;
    if (checkResult.product.id !== selectedCodeProduct.id) return null;
    const summary = summarizeProductAvailability(checkResult);
    return {
      available: summary.available,
      free: summary.free,
      requested: summary.requested,
      reason: summary.reason,
      holdBadges: summary.holdBadges,
    };
  }, [checkResult, selectedCodeProduct]);

  useEffect(() => {
    if (!checkResult) return;
    const washingQueue = Number(checkResult.washing_queue_qty || 0);
    const laundryWashing = Number(checkResult.laundry_washing_qty || 0);
    if (washingQueue > 0 || laundryWashing > 0) {
      setProductDetailsOpen(true);
    }
  }, [checkResult]);
  const selectedProductLifeWarning = useMemo(() => {
    if (!selectedCodeProduct) return null;
    const lifetimeGap = Number(selectedCodeProduct.lifetime_gap || 0);
    const currentCount = Number(selectedCodeProduct.count || 0);
    if (lifetimeGap > 0 && currentCount >= lifetimeGap) {
      return {
        currentCount,
        lifetimeGap,
      };
    }
    return null;
  }, [selectedCodeProduct]);

  const openProductHistory = useCallback(
    (productRow) => {
      const row = productRow || selectedCodeProduct;
      if (!row?.id) return;
      setHistoryProductSnapshot({
        id: row.id,
        code: row.code,
        name: row.name,
        qty: row.qty,
        color: row.color,
        size: row.size,
        status: checkResult?.product?.id === row.id ? checkResult.product.status : row.status,
        total_qty: row.qty ?? row.total_qty,
      });
      setHistoryOpen(true);
    },
    [selectedCodeProduct, checkResult?.product]
  );

  const handleCheck = () => {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.warning('Enter a product code');
      return;
    }
    if (!deliveryDate || !returnDate) {
      toast.warning('Select delivery and return dates');
      return;
    }
    if (deliveryDate > returnDate) {
      toast.error('Return date must be after delivery date');
      return;
    }
    setRelatedLoading(true);
    setRelatedRows([]);
    checkMutation.mutate({
      code: trimmed,
      from: deliveryDate,
      to: returnDate,
      qty: Number(qty) || 1,
    });
  };

  const refreshCheckedProduct = () => {
    const trimmed = code.trim();
    if (!trimmed || !deliveryDate || !returnDate) return;
    setRelatedLoading(true);
    checkMutation.mutate({
      code: trimmed,
      from: deliveryDate,
      to: returnDate,
      qty: Number(qty) || 1,
    });
  };

  const removeFromQueue = useAdminDelete({
    deleteFn: (item, admin_password) => washingQueueApi.remove(item.id, { admin_password }),
    onSuccess: () => {
      toast.success('Removed from washing queue — product is now available');
      queryClient.invalidateQueries({ queryKey: ['washing-queue'] });
      refreshCheckedProduct();
    },
  });

  const removeCartDraft = useAdminDelete({
    deleteFn: (line, admin_password) => draftsApi.remove(line.draft_id, { admin_password }),
    onSuccess: (_data, line) => {
      setCart((prev) => prev.filter((c) => c.id !== line.id));
    },
  });

  const upsertCartLine = (lines, line) => {
    const idx = lines.findIndex((c) => String(c.draft_id || c.id) === String(line.draft_id || line.id));
    if (idx === -1) return [...lines, line];
    return lines.map((c, i) => (i === idx ? line : c));
  };

  const handleAddToCart = async () => {
    if (!customer) {
      toast.warning('Please select a customer before adding to cart');
      setCustomerOpen(true);
      return;
    }
    if (!checkResult) {
      toast.warning('Check availability first');
      return;
    }
    if (!checkResult.available) {
      const why = summarizeProductAvailability(checkResult).reason;
      toast.error(why || `Only ${checkResult.free_qty} available in this range`);
      return;
    }

    const relatedToAdd = relatedRows.filter((r) => r.selected && r.result?.available);
    const requiredMissing = relatedRows.filter(
      (r) => r.related?.is_required && !r.result?.available
    );
    if (requiredMissing.length > 0) {
      const names = requiredMissing
        .map((r) => r.related?.name || r.related?.code || 'Related product')
        .join(', ');
      toast.error(`Required related product(s) not available: ${names}`);
      return;
    }

    setCartSaving(true);
    try {
      let workingCart = [...cart];
      let addedCount = 0;

      const primaryLine = await addProductToAvailabilityCart({
        cart: workingCart,
        customer,
        product: checkResult.product,
        from: deliveryDate,
        to: returnDate,
        qty: Number(qty) || 1,
        deliveryTime,
        returnTime,
      });
      workingCart = sortCartLinesNewestFirst(upsertCartLine(workingCart, primaryLine));
      addedCount += 1;

      for (const row of relatedToAdd) {
        const product = relatedToCartProduct(row.related, row.result);
        if (!product.id) continue;
        const relatedLine = await addProductToAvailabilityCart({
          cart: workingCart,
          customer,
          product,
          from: deliveryDate,
          to: returnDate,
          qty: 1,
          deliveryTime,
          returnTime,
        });
        workingCart = sortCartLinesNewestFirst(upsertCartLine(workingCart, relatedLine));
        addedCount += 1;
      }

      setCart(workingCart);
      toast.success(
        relatedToAdd.length > 0
          ? `Added ${addedCount} product(s) to ${customer.name}'s cart (including related)`
          : `Added to ${customer.name}'s cart`
      );
      queryClient.invalidateQueries({
          queryKey: queryKeys.drafts.availabilityCart,
      });
      setCode('');
      setQty(1);
      setCheckResult(null);
      setRelatedRows([]);
      setBillCustomerId(customer.id);
    } catch (err) {
      toast.error(
        err?.response?.data?.error?.message || err.message || 'Failed to save cart'
      );
    } finally {
      setCartSaving(false);
    }
  };

  const removeCartLine = (line) => {
    if (line.draft_id) {
      removeCartDraft.requestDelete(line);
      return;
    }
    setCart((prev) => prev.filter((c) => c.id !== line.id));
  };

  // Change qty — optimistic UI + persisted to the draft row.
  const saveCartLineNotes = async (line, notes) => {
    const updatedData = {
      ...stripAvailabilityCartDraftMeta(line),
      tailor_notes: String(notes?.tailor_notes ?? '').trim().slice(0, 500),
      tailor_note_image: String(notes?.tailor_note_image ?? '').trim().slice(0, 500) || '',
    };
    try {
      const res = await draftsApi.update(line.draft_id, {
        kind: AVAILABILITY_CART_DRAFT_KIND,
        data: updatedData,
        title: `${updatedData.customer_name} · ${updatedData.name}`,
      });
      const updatedLine = draftToCartLine(res?.data || res);
      setCart((prev) =>
        sortCartLinesNewestFirst(prev.map((c) => (c.id === line.id ? updatedLine : c)))
      );
      toast.success(
        updatedData.tailor_notes || updatedData.tailor_note_image
          ? 'Product note saved'
          : 'Product note cleared'
      );
    } catch (err) {
      toast.error(
        err?.response?.data?.error?.message || err.message || 'Could not save product note'
      );
    }
  };

  const saveCartLineAccessories = async (line, accessories) => {
    const updatedData = { ...stripAvailabilityCartDraftMeta(line), accessories: accessories || [] };
    try {
      const res = await draftsApi.update(line.draft_id, {
        kind: AVAILABILITY_CART_DRAFT_KIND,
        data: updatedData,
        title: `${updatedData.customer_name} · ${updatedData.name}`,
      });
      const updatedLine = draftToCartLine(res?.data || res);
      setCart((prev) =>
        sortCartLinesNewestFirst(prev.map((c) => (c.id === line.id ? updatedLine : c)))
      );
      const n = countSelectedAccessories(accessories);
      toast.success(n > 0 ? `Saved ${n} accessory selection${n === 1 ? '' : 's'}` : 'Accessories cleared');
    } catch (err) {
      toast.error(
        err?.response?.data?.error?.message || err.message || 'Could not save accessories'
      );
    }
  };

  const changeCartQty = async (line, nextQtyRaw) => {
    const nextQty = Math.max(1, Number(nextQtyRaw) || 1);
    if (nextQty === Number(line.qty)) return;
    const stockCheck = await validateRentProductQty({
      productId: line.product_id,
      code: line.code,
      from: line.from,
      to: line.to,
      qty: nextQty,
      label: line.name || line.code || 'Product',
    });
    if (!stockCheck.ok) {
      toast.warning(stockCheck.message);
      return;
    }
    setCart((prev) => prev.map((c) => (c.id === line.id ? { ...c, qty: nextQty } : c)));
    try {
      const res = await draftsApi.update(line.draft_id, {
        kind: AVAILABILITY_CART_DRAFT_KIND,
        data: { ...stripAvailabilityCartDraftMeta(line), qty: nextQty },
        title: `${line.customer_name || 'Customer'} · ${line.name || 'Item'}`,
      });
      const updatedLine = draftToCartLine(res?.data || res);
      setCart((prev) =>
        sortCartLinesNewestFirst(prev.map((c) => (c.id === line.id ? updatedLine : c)))
      );
    } catch (err) {
      setCart((prev) => prev.map((c) => (c.id === line.id ? { ...c, qty: line.qty } : c)));
      toast.error(
        err?.response?.data?.error?.message || 'Could not update cart qty'
      );
    }
  };

  const proceedQuickBill = (mine, customerName) => {
    const first = mine[0];
    const customerId = first?.customer_id || null;
    if (!customerId) {
      toast.warning('Cart line has no customer — cannot open Quick Bill');
      return;
    }
    const billCustomer = {
      id: customerId,
      name: String(customerName || first?.customer_name || '').trim(),
      phone1: first?.customer_phone || null,
    };
    try {
      sessionStorage.setItem(
        'wrs.quickBillDraft',
        JSON.stringify({
          customer: billCustomer,
          cart: mine,
          draft_ids: mine.map((c) => c.draft_id).filter(Boolean),
          createdAt: Date.now(),
        })
      );
    } catch {
      /* ignore quota errors */
    }
    // No location.state.fresh — cart handoff via sessionStorage must load on Create Booking.
    navigate('/booking/new');
  };

  const handleQuickBill = async () => {
    if (cart.length === 0) {
      toast.warning('Cart is empty');
      return;
    }
    if (!billCustomerId) {
      toast.warning('Select a customer from the cart to bill');
      return;
    }
    // Only bill this customer's lines — leave other customers' carts intact
    // so another staff member can continue working with them.
    const mine = cart.filter((c) => c.customer_id === billCustomerId);
    if (mine.length === 0) {
      toast.warning('No cart items for the selected customer');
      return;
    }
    const currentName = String(mine[0].customer_name || '').trim();
    proceedQuickBill(mine, currentName);
  };

  const clearEntireCart = () => {
    if (cart.length === 0) return;
    setClearCartConfirmOpen(true);
  };

  const confirmClearEntireCart = async () => {
    try {
      await draftsApi.bulkDelete({ kind: AVAILABILITY_CART_DRAFT_KIND });
      setCart([]);
      setClearCartConfirmOpen(false);
      toast.success('Cart cleared');
    } catch (err) {
      toast.error(
        err?.response?.data?.error?.message || 'Could not clear the cart'
      );
    }
  };

  const cartTotals = useMemo(() => {
    const lines = cart.length;
    const totalQty = cart.reduce((s, c) => s + Number(c.qty || 0), 0);
    const amount = cart.reduce(
      (s, c) => s + Number(c.price_rent || 0) * Number(c.qty || 0),
      0
    );
    return { lines, totalQty, amount };
  }, [cart]);

  // Distinct customers represented in the cart — used to populate the
  // "Quick Bill" customer selector.
  const cartCustomers = useMemo(() => {
    const map = new Map();
    cart.forEach((c) => {
      if (!c.customer_id) return;
      if (!map.has(c.customer_id)) {
        const subset = cart.filter((x) => x.customer_id === c.customer_id);
        const amount = subset.reduce(
          (s, x) => s + Number(x.price_rent || 0) * Number(x.qty || 0),
          0
        );
        map.set(c.customer_id, {
          id: c.customer_id,
          name: c.customer_name,
          phone1: c.customer_phone,
          lines: subset.length,
          qty: subset.reduce((s, x) => s + Number(x.qty || 0), 0),
          amount,
        });
      }
    });
    return Array.from(map.values());
  }, [cart]);

  // Clear Quick Bill customer when cart is empty or the chosen customer has no lines left.
  useEffect(() => {
    if (cartCustomers.length === 0) {
      if (billCustomerId) setBillCustomerId('');
      return;
    }
    if (billCustomerId && !cartCustomers.find((c) => c.id === billCustomerId)) {
      setBillCustomerId('');
    }
  }, [cartCustomers, billCustomerId]);

  return (
    <div>
      <PageHeader
        title="Available"
        description="Check product availability for a rental window. Booking drafts save on this device — use New draft to save the current form and start another booking."
        actions={<BookingDraftActions mode="navigate" />}
      />

      {/* Tabs */}
      <div className="rounded-lg border border-gray-200 bg-surface shadow-card mb-3">
        <div className="flex items-stretch border-b border-gray-200 rounded-t-lg overflow-hidden">
          <TabButton
            active={tab === 'check'}
            onClick={() => switchTab('check')}
            label="Check Availability"
          />
          <TabButton
            active={tab === 'cart'}
            onClick={() => switchTab('cart')}
            label={`Cart List${cart.length ? ` (${cart.length})` : ''}`}
            icon={ShoppingCart}
          />
        </div>

        {tab === 'check' ? (
          <div className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
              {/* Code + Qty share first column (same width as Customer below) */}
              <div className="relative min-w-0">
                <div className="flex flex-nowrap items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor="availability-check-code" className="label">
                      Code<span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <div className="relative">
                      <input
                        id="availability-check-code"
                        name="availability_check_product_code"
                        className="input w-full pr-[4.75rem]"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        data-form-type="other"
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value);
                          setCodeOpen(true);
                          setCodeHighlight(0);
                          setCheckResult(null);
                          setRelatedRows([]);
                        }}
                        onFocus={() => setCodeOpen(true)}
                        onBlur={() => {
                          // slight delay so click handlers fire
                          window.setTimeout(() => setCodeOpen(false), 120);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setCodeOpen(true);
                            setCodeHighlight((h) =>
                              Math.min(h + 1, Math.max(productMatches.length - 1, 0))
                            );
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setCodeHighlight((h) => Math.max(h - 1, 0));
                          } else if (e.key === 'Enter') {
                            if (codeOpen && productMatches[codeHighlight]) {
                              pickProductCode(productMatches[codeHighlight]);
                            } else {
                              handleCheck();
                            }
                          } else if (e.key === 'Escape') {
                            setCodeOpen(false);
                          }
                        }}
                        placeholder="Code"
                      />
                      <div className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setScannerOpen(true)}
                          className="pointer-events-auto rounded-md p-1 text-gray-500 hover:bg-brand-light/60 hover:text-brand"
                          title="Scan barcode"
                          aria-label="Scan barcode"
                        >
                          <Camera size={16} className="shrink-0" />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          disabled={!selectedCodeProduct?.id}
                          onClick={() => openProductHistory()}
                          className="pointer-events-auto rounded-md p-1 text-gray-500 hover:bg-brand-light/60 hover:text-brand disabled:pointer-events-none disabled:opacity-40"
                          title="Product history"
                          aria-label="Product history"
                        >
                          <History size={16} className="shrink-0" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="w-[3.25rem] shrink-0">
                    <Input
                      label="Qty"
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => {
                        setQty(e.target.value);
                        setCheckResult(null);
                      }}
                    />
                  </div>
                </div>
                {allowProductAutocomplete && codeOpen && code.trim().length >= 1 ? (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
                    {productSearchQuery.isLoading && productMatches.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
                    ) : productMatches.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
                    ) : (
                      productMatches.map((p, idx) => (
                        <button
                          type="button"
                          key={p.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickProductCode(p)}
                          className={clsx(
                            'w-full min-w-0 text-left px-3 py-2 text-sm',
                            idx === codeHighlight ? 'bg-brand-light' : 'hover:bg-gray-50'
                          )}
                        >
                          <div className="min-w-0 font-medium text-gray-900 truncate">{p.name}</div>
                          <div className="min-w-0 truncate text-[10px] font-mono text-gray-500">
                            {p.code}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <Input
                label="Delivery"
                required
                type="date"
                value={deliveryDate}
                onChange={(e) => {
                  const nextDelivery = e.target.value;
                  setDeliveryDate(nextDelivery);
                  setReturnDate(addDaysISO(nextDelivery, 3));
                  setCheckResult(null);
                  setRelatedRows([]);
                }}
              />
              <Input
                label="Return"
                required
                type="date"
                value={returnDate}
                onChange={(e) => {
                  setReturnDate(e.target.value);
                  setCheckResult(null);
                  setRelatedRows([]);
                }}
              />
              <Button
                variant="primary"
                className="h-9 w-full text-xs"
                onClick={handleCheck}
                loading={checkMutation.isLoading || relatedLoading}
              >
                Check Availability
              </Button>
            </div>
            {selectedCodeProduct ? (
              <div className="mt-2 space-y-1.5">
                <div className="border border-gray-200 rounded-md px-2.5 py-2 bg-gray-50 flex flex-wrap items-center gap-2 min-h-[52px]">
                  <div className="flex items-center gap-3 min-w-0 shrink-0">
                    <SmartImage
                      src={selectedCodeProduct.main_image}
                      alt={selectedCodeProduct.name}
                      className="w-10 h-10 rounded border border-gray-200 bg-white object-contain shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {selectedCodeProduct.name}
                      </div>
                      <div className="text-[11px] text-gray-500 font-mono">
                        {selectedCodeProduct.code}
                      </div>
                    </div>
                  </div>
                  {selectedCodeAvailability !== null ? (
                    <div className="flex flex-1 flex-row flex-wrap items-center justify-center gap-1.5 min-w-0 max-w-[min(100%,42rem)]">
                      <span
                        className={clsx(
                          'inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border shrink-0',
                          selectedCodeAvailability.available
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        )}
                      >
                        {selectedCodeAvailability.available ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        {selectedCodeAvailability.available ? 'Available' : 'Not available'} —{' '}
                        {selectedCodeAvailability.free} free / need {selectedCodeAvailability.requested}
                      </span>
                      {selectedCodeAvailability.holdBadges?.length > 0 ? (
                        <AvailabilityHoldBadges badges={selectedCodeAvailability.holdBadges} compact />
                      ) : null}
                      {selectedCodeAvailability.reason ? (
                        <span
                          className={clsx(
                            'text-[11px] leading-snug shrink-0',
                            selectedCodeAvailability.available ? 'text-gray-600' : 'text-red-800'
                          )}
                          title={selectedCodeAvailability.reason}
                        >
                          {selectedCodeAvailability.reason}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {relatedLoading ? (
                  <div className="border border-dashed border-gray-200 rounded-md px-2.5 py-2 text-[11px] text-gray-500 bg-white">
                    Checking linked related products…
                  </div>
                ) : null}
                {!relatedLoading && relatedRows.length > 0 ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 px-0.5">
                      Related products availability ({relatedRows.filter((r) => r.result?.available).length}/
                      {relatedRows.length} available)
                    </div>
                    {relatedRows.map((row) => {
                      const relatedId = row.related?.related_product_id;
                      const summary = summarizeProductAvailability(row.result);
                      const available = !!row.result?.available;
                      const name = row.related?.name || row.result?.product?.name || 'Related product';
                      const codeLabel = row.related?.code || row.result?.product?.code || '—';
                      const image = row.related?.main_image || row.result?.product?.main_image || '';
                      return (
                        <div
                          key={`summary-${relatedId || codeLabel}`}
                          className={clsx(
                            'border rounded-md px-2.5 py-2 flex flex-wrap items-center gap-2 min-h-[52px]',
                            available
                              ? 'border-gray-200 bg-white'
                              : 'border-red-200 bg-red-50/50'
                          )}
                        >
                          <div className="flex items-center gap-3 min-w-0 shrink-0">
                            <SmartImage
                              src={image}
                              alt={name}
                              className="w-10 h-10 rounded border border-gray-200 bg-white object-contain shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1">
                                <div className="text-sm font-medium text-gray-900 truncate">{name}</div>
                                {row.related?.is_required ? (
                                  <Badge tone="red" className="text-[10px]">
                                    Required
                                  </Badge>
                                ) : null}
                                {row.related?.is_recommended ? (
                                  <Badge tone="brand" className="text-[10px]">
                                    Recommended
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="text-[11px] text-gray-500 font-mono">{codeLabel}</div>
                            </div>
                          </div>
                          <div className="flex flex-1 flex-row flex-wrap items-center justify-center gap-1.5 min-w-0">
                            {row.error ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-red-200 bg-red-50 text-red-700">
                                <XCircle size={13} />
                                Check failed
                              </span>
                            ) : (
                              <span
                                className={clsx(
                                  'inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border shrink-0',
                                  available
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                                )}
                              >
                                {available ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                                {available ? 'Available' : 'Not available'} — {summary.free} free / need{' '}
                                {summary.requested}
                              </span>
                            )}
                            {summary.holdBadges?.length > 0 ? (
                              <AvailabilityHoldBadges badges={summary.holdBadges} compact />
                            ) : null}
                            {(row.error || summary.reason) ? (
                              <span
                                className={clsx(
                                  'text-[11px] leading-snug shrink-0',
                                  available ? 'text-gray-600' : 'text-red-800'
                                )}
                                title={row.error || summary.reason}
                              >
                                {row.error || summary.reason}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            {selectedProductLifeWarning ? (
              <div className="mt-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                Warning: This product life is not good and may not be perfect for rent.
                {' '}Current count {selectedProductLifeWarning.currentCount} / Lifetime gap{' '}
                {selectedProductLifeWarning.lifetimeGap}.
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mt-3">
              {/* Customer search with dropdown — required for Add to Cart */}
              <div className="relative">
                <div className="label flex items-center justify-between gap-2">
                  <span>
                    Customer<span className="text-red-500 ml-0.5">*</span>
                  </span>
                  {!customer ? (
                    <button
                      type="button"
                      onClick={tryInlineCreateCustomerFromSearch}
                      disabled={quickCustomerCreateMutation.isPending}
                      className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline disabled:opacity-50"
                    >
                      <UserPlus size={12} /> New customer
                    </button>
                  ) : null}
                </div>

                {customer ? (
                  <div className="flex items-center gap-2 border border-brand/40 bg-brand-light/60 text-brand-700 rounded-md px-2.5 py-1.5 h-9">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900 truncate">
                        {customer.name}
                      </div>
                      {customer.phone1 ? (
                        <div className="text-[11px] text-gray-500 leading-tight">
                          {customer.phone1}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomer(null);
                        setCustomerQuery('');
                      }}
                      className="text-gray-400 hover:text-red-600 shrink-0"
                      title="Change customer"
                      aria-label="Change customer"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      id="availability-customer-search"
                      className="input pl-9"
                      value={customerQuery}
                      aria-label="Search customer by name or phone"
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setCustomerOpen(true);
                      }}
                      onFocus={() => setCustomerOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setCustomerOpen(false), 120);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const rows = customerResults?.data || customerResults || [];
                        const q = customerQuery.trim().toLowerCase();
                        const exact = rows.find(
                          (c) =>
                            String(c.name || '').trim().toLowerCase() === q ||
                            String(c.phone1 || '').trim().toLowerCase() === q
                        );
                        if (exact) {
                          setCustomer(exact);
                          setCustomerQuery('');
                          setCustomerOpen(false);
                          return;
                        }
                        if (rows.length === 0) {
                          tryInlineCreateCustomerFromSearch();
                        }
                      }}
                      placeholder="Search name / phone"
                    />
                  </div>
                )}
                {!customer && customerOpen && customerQuery.trim().length >= 2 ? (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                    {(customerResults?.data || customerResults || []).length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
                    ) : (
                      (customerResults?.data || customerResults || []).map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCustomer(c);
                            setCustomerQuery('');
                            setCustomerOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                        >
                          <span className="font-medium text-gray-800">{c.name}</span>
                          <span className="text-xs text-gray-500">{c.phone1}</span>
                        </button>
                      ))
                    )}
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => tryInlineCreateCustomerFromSearch()}
                      disabled={quickCustomerCreateMutation.isPending}
                      className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 bg-brand-light/40 hover:bg-brand-light text-brand-700 flex items-center gap-2 disabled:opacity-50"
                    >
                      <Plus size={14} />
                      <span className="font-medium">Create new customer</span>
                    </button>
                  </div>
                ) : null}

                
              </div>
              <Select
                label="Delivery Time"
                value={deliveryTime}
                onChange={(e) => setDeliveryTime(e.target.value)}
                options={timeSelectOptions}
              />
              <Select
                label="Return Time"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
                options={timeSelectOptions}
              />
              <Button
                variant="primary"
                className="h-9 w-full text-xs"
                onClick={handleAddToCart}
                loading={cartSaving}
                disabled={
                  cartSaving ||
                  relatedLoading ||
                  !customer ||
                  !checkResult ||
                  !checkResult.available
                }
                title={
                  !customer
                    ? 'Select a customer first'
                    : !checkResult
                      ? 'Check availability first'
                      : !checkResult.available
                        ? summarizeProductAvailability(checkResult).reason || 'Not available in this range'
                        : selectedRelatedCount > 0
                          ? `Add this product plus ${selectedRelatedCount} available related product(s)`
                          : 'Add this product to cart'
                }
              >
                {selectedRelatedCount > 0
                  ? `Add to Cart (+${selectedRelatedCount} related)`
                  : 'Add to Cart'}
              </Button>
            </div>

            {/* Quick Bill uses cart lines — related products added with Add to Cart are included */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end mt-3">
              <div className="md:col-span-2">
                <Select
                  label="Customer"
                  id="availability-quick-bill-customer"
                  value={billCustomerId}
                  onChange={(e) => setBillCustomerId(e.target.value)}
                  disabled={cartCustomers.length === 0}
                  options={[
                    {
                      value: '',
                      label:
                        cartCustomers.length === 0
                          ? 'Cart is empty'
                          : 'Select customer from cart',
                    },
                    ...cartCustomers.map((c) => ({
                      value: c.id,
                      label: `${c.name}${c.phone1 ? ` · ${c.phone1}` : ''}`,
                    })),
                  ]}
                />
              </div>
              <div className="md:col-span-1">
                <Button
                  className="h-9 w-full text-xs"
                  onClick={handleQuickBill}
                  disabled={cart.length === 0 || !billCustomerId}
                  title={
                    cart.length === 0
                      ? 'Cart is empty'
                      : !billCustomerId
                        ? 'Pick a customer from the cart first'
                        : ''
                  }
                >
                  Quick Bill
                </Button>
              </div>
              {billCustomerId ? (
                <div className="md:col-span-2 text-xs text-gray-500 pb-2">
                  {(() => {
                    const picked = cartCustomers.find((c) => c.id === billCustomerId);
                    if (!picked) return null;
                    return (
                      <>
                        Billing <span className="font-semibold text-gray-800">{picked.name}</span>
                        {' '}· {picked.lines} line{picked.lines === 1 ? '' : 's'} ·{' '}
                        {picked.qty} item{picked.qty === 1 ? '' : 's'} ·{' '}
                        <span className="font-semibold text-gray-800">
                          {formatCurrency(picked.amount)}
                        </span>
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <CartListView
            cart={cart}
            loading={cartLoading}
            totals={cartTotals}
            onChangeQty={changeCartQty}
            onRemove={removeCartLine}
            onClearAll={clearEntireCart}
            onQuickBillForCustomer={(c) => {
              const mine = cart.filter((x) => x.customer_id === c.customer_id);
              if (mine.length === 0) {
                toast.warning('No cart items for this customer');
                return;
              }
              const currentName = String(mine[0].customer_name || '').trim();
              setBillCustomerId(c.customer_id || '');
              proceedQuickBill(mine, currentName);
            }}
            onAddMoreForCustomer={(c) => {
              setCustomer({
                id: c.customer_id,
                name: c.customer_name,
                phone1: c.customer_phone,
              });
              switchTab('check');
            }}
            onAddAccessories={(line) => setAccessoryModalLine(line)}
            onAddNotes={(line) => setNoteModalLine(line)}
          />
        )}
      </div>

      <AvailabilityCartProductNotesModal
        isOpen={!!noteModalLine}
        cartLine={noteModalLine}
        onClose={() => setNoteModalLine(null)}
        onSave={(notes) => {
          if (!noteModalLine) return;
          saveCartLineNotes(noteModalLine, notes);
          setNoteModalLine(null);
        }}
      />

      <AvailabilityCartAccessoriesModal
        isOpen={!!accessoryModalLine}
        cartLine={accessoryModalLine}
        onClose={() => setAccessoryModalLine(null)}
        onSave={(accessories) => {
          if (!accessoryModalLine) return;
          saveCartLineAccessories(accessoryModalLine, accessories);
          setAccessoryModalLine(null);
        }}
      />

      <ConfirmDialog
        isOpen={clearCartConfirmOpen}
        onClose={() => setClearCartConfirmOpen(false)}
        onConfirm={confirmClearEntireCart}
        title="Clear shared cart?"
        message="Remove all items from the shared cart? This cannot be undone."
        confirmLabel="Clear cart"
        cancelLabel="Cancel"
        danger
      />

      {/* Product Details collapsible */}
      {tab === 'check' ? (
        <div className="card p-0 overflow-hidden mb-3">
          <button
            type="button"
            onClick={() => setProductDetailsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 border-b border-gray-200 bg-gray-50"
          >
            <span className="text-xs font-semibold text-gray-800">Product Details</span>
            <ChevronDown
              size={16}
              className={clsx(
                'transition-transform text-gray-500',
                productDetailsOpen ? 'rotate-180' : ''
              )}
            />
          </button>
          {productDetailsOpen ? (
            <div className="p-3 space-y-4">
              {!checkResult ? (
                <EmptyProductHint />
              ) : (
                <>
                  <AvailabilityResult
                    result={checkResult}
                    onRemoveFromQueue={(row) => removeFromQueue.requestDelete(row)}
                    removingQueueId={
                      removeFromQueue.loading ? removeFromQueue.target?.id : null
                    }
                    onOpenLaundryJob={(jobId) => navigate(`/laundry/new?jobId=${jobId}`)}
                    onOpenHistory={() => openProductHistory(checkResult?.product)}
                  />
                  <RelatedAvailabilitySection
                    rows={relatedRows}
                    loading={relatedLoading}
                    onToggleSelected={toggleRelatedSelected}
                    onOpenHistory={(row) => {
                      const product = relatedToCartProduct(row.related, row.result);
                      openProductHistory(product);
                    }}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <ProductRentalHistoryModal
        isOpen={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryProductSnapshot(null);
        }}
        product={historyProductSnapshot}
        windowFrom={deliveryDate}
        windowTo={returnDate}
      />

      <AdminDeleteModal
        isOpen={Boolean(removeFromQueue.target)}
        onClose={removeFromQueue.close}
        onConfirm={removeFromQueue.confirmDelete}
        title="Remove from washing queue?"
        description="The product will be marked available for rent again."
        itemLabel={
          removeFromQueue.target?.order_number
            ? `Order ${removeFromQueue.target.order_number} · qty ${removeFromQueue.target.qty ?? '—'}`
            : undefined
        }
        shopName={selectedShopName}
        errorMessage={removeFromQueue.error}
        onClearError={removeFromQueue.clearError}
        loading={removeFromQueue.loading}
        confirmLabel="Remove"
      />

      <AdminDeleteModal
        isOpen={Boolean(removeCartDraft.target)}
        onClose={removeCartDraft.close}
        onConfirm={removeCartDraft.confirmDelete}
        title="Remove cart line?"
        description="This removes the saved cart line for this customer."
        itemLabel={
          removeCartDraft.target?.product_code || removeCartDraft.target?.product_name || undefined
        }
        shopName={selectedShopName}
        errorMessage={removeCartDraft.error}
        onClearError={removeCartDraft.clearError}
        loading={removeCartDraft.loading}
        confirmLabel="Remove"
      />

      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(scanned) => {
          const trimmed = String(scanned || '').trim();
          if (!trimmed) return;
          setScannerOpen(false);
          setCode(trimmed);
          setCodeOpen(false);
          setCheckResult(null);
          setRelatedRows([]);
          toast.success(`Scanned ${trimmed} — set dates and click Check Availability`);
        }}
      />

    </div>
  );
};

const TabButton = ({ active, onClick, label, icon: Icon }) => (
  <button
    type="button"
    onClick={onClick}
    className={clsx(
      'px-3 py-2 text-xs font-medium flex items-center gap-1.5 border-b-2 transition',
      active
        ? 'border-brand text-brand bg-white'
        : 'border-transparent text-gray-500 hover:text-gray-800'
    )}
  >
    {Icon ? <Icon size={14} /> : null}
    {label}
  </button>
);

const EmptyProductHint = () => (
  <div className="text-center text-sm text-gray-500 py-8">
    <Calendar size={28} className="mx-auto text-gray-300 mb-2" />
    Enter a product code and date range, then click{' '}
    <span className="font-medium text-gray-700">Check Available</span> to see booking history.
  </div>
);

const AvailabilityResult = ({
  result,
  onRemoveFromQueue,
  removingQueueId,
  onOpenLaundryJob,
  onOpenHistory,
}) => {
  const {
    product,
    from,
    to,
    total_qty,
    booked_qty,
    washing_queue_qty,
    laundry_washing_qty,
    washing_queue: washingQueue = [],
    laundry_washing: laundryWashing = [],
    free_qty,
    conflicts,
    upcoming_bookings: upcomingBookings = [],
  } = result;
  const lifetimeGap = Number(product?.lifetime_gap || 0);
  const currentCount = Number(product?.count || 0);
  const showLifeWarning = lifetimeGap > 0 && currentCount >= lifetimeGap;
  const gapConflict = useMemo(() => {
    if (!from || !to || !Array.isArray(conflicts) || conflicts.length === 0) return null;
    for (const c of conflicts) {
      const baseDate = c.return_date || c.pickup_date;
      const nextGapDays = Math.max(0, Number(c.next_booking_gap_days || 0));
      if (baseDate) {
        const nextAllowed = earliestPickupAfterReturnGap(baseDate, c.pickup_date, nextGapDays);
        if (nextAllowed && from < nextAllowed) {
          return { kind: 'next', date: nextAllowed, gapDays: nextGapDays };
        }
      }
      const prevGapDays = Math.max(0, Number(c.previous_booking_gap_days || 0));
      if (c.pickup_date && prevGapDays > 0) {
        const lastAllowedReturn = latestReturnBeforePickupGap(c.pickup_date, prevGapDays);
        if (lastAllowedReturn && to > lastAllowedReturn) {
          return { kind: 'previous', date: lastAllowedReturn, gapDays: prevGapDays, pickupDate: c.pickup_date };
        }
      }
    }
    return null;
  }, [conflicts, from, to]);
  const availabilitySummary = useMemo(() => summarizeProductAvailability(result), [result]);
  const bannerTone = useMemo(
    () => resolveAvailabilityBannerTone(result, availabilitySummary),
    [result, availabilitySummary]
  );
  const nextBookingLink = useMemo(
    () => resolveNextBookingLink({ upcomingBookings }),
    [upcomingBookings]
  );

  return (
    <div className="space-y-5">
      <div
        className={clsx(
          'rounded-md border px-3 py-2.5 flex flex-row flex-wrap items-center justify-center gap-1.5 text-center',
          bannerTone === 'available' && 'border-green-200 bg-green-50',
          bannerTone === 'unavailable' && 'border-red-200 bg-red-50',
          bannerTone === 'washing_queue' && 'border-orange-200 bg-orange-50',
          bannerTone === 'in_washing' && 'border-brand/30 bg-brand/10',
          bannerTone === 'washing_mixed' && 'border-orange-200 bg-orange-50'
        )}
      >
        <span
          className={clsx(
            'inline-flex items-center justify-center gap-1 text-xs font-semibold',
            bannerTone === 'available' && 'text-green-800',
            bannerTone === 'unavailable' && 'text-red-800',
            bannerTone === 'washing_queue' && 'text-orange-800',
            bannerTone === 'in_washing' && 'text-brand',
            bannerTone === 'washing_mixed' && 'text-orange-800'
          )}
        >
          {availabilitySummary.available ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {availabilitySummary.available ? 'Available' : 'Not available'} — {availabilitySummary.free} free / need{' '}
          {availabilitySummary.requested}
        </span>
        {availabilitySummary.holdBadges?.length > 0 ? (
          <AvailabilityHoldBadges badges={availabilitySummary.holdBadges} />
        ) : null}
        {availabilitySummary.reason ? (
          <span
            className={clsx(
              'text-xs leading-snug shrink-0',
              bannerTone === 'available' && 'text-gray-700',
              bannerTone === 'unavailable' && 'text-red-900',
              (bannerTone === 'washing_queue' || bannerTone === 'washing_mixed') && 'text-orange-900',
              bannerTone === 'in_washing' && 'text-brand'
            )}
          >
            {availabilitySummary.reason}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4 min-w-0">
        <SmartImage
          src={product.main_image}
          alt={product.name}
          className="w-24 h-24 rounded border border-gray-200 bg-gray-50 object-contain"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 flex-wrap justify-between w-full">
            <div>
              <div className="text-base font-semibold text-gray-900">{product.name}</div>
              <div className="text-xs text-gray-500">
                Code: <span className="font-mono">{product.code}</span>
                {product.color ? <> · {product.color}</> : null}
                {product.size ? <> · {product.size}</> : null}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Rent {formatCurrency(product.price_rent)}
              </div>
            </div>
            {onOpenHistory ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={History}
                onClick={onOpenHistory}
              >
                History
              </Button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Stat label="Total" value={total_qty} tone="gray" />
            <Stat label="Booked (in range)" value={booked_qty} tone="yellow" />
            {Number(washing_queue_qty || 0) > 0 ? (
              <Stat label="In Washing Queue" value={washing_queue_qty} tone="orange" />
            ) : null}
            {Number(laundry_washing_qty || 0) > 0 ? (
              <Stat label="In Washing" value={laundry_washing_qty} tone="brand" />
            ) : null}
            <Stat label="Free (in range)" value={free_qty} tone={free_qty > 0 ? 'green' : 'red'} />
            <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
              <span className="uppercase text-[10px] tracking-wider">Next pickup</span>
              <span className="font-semibold text-xs">
                <UpcomingPickupDates bookings={upcomingBookings} />
              </span>
            </span>
            <Stat label="Current Count" value={currentCount} tone="gray" />
            <Stat label="Lifetime Gap" value={lifetimeGap} tone="gray" />
            <Stat label="Window" value={`${formatDate(from)} → ${formatDate(to)}`} tone="brand" />
          </div>
          {showLifeWarning ? (
            <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
              Warning: This product life is not good and may not be perfect for rent.
            </div>
          ) : null}
          {gapConflict ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {gapConflict.kind === 'previous' ? (
                <>
                  Gap warning: return on or before {formatDate(gapConflict.date)} (gap {gapConflict.gapDays} day
                  {gapConflict.gapDays === 1 ? '' : 's'} before delivery {formatDate(gapConflict.pickupDate)}).
                </>
              ) : (
                <>
                  Gap warning: use delivery date {formatDate(gapConflict.date)} or later (gap {gapConflict.gapDays}{' '}
                  day{gapConflict.gapDays === 1 ? '' : 's'}).
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {washingQueue.length > 0 ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            In Washing Queue
          </div>
          <div className="mb-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
            This product is waiting in the washing queue. Remove it here to make it available for rent again.
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-md">
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">
                    <TableHeaderLabel>Order</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Queued At</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Next booking</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right" nowrap>
                      Action
                    </TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {washingQueue.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">
                      <BookingBillLink orderId={row.order_id}>{row.order_number || '—'}</BookingBillLink>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{row.qty}</td>
                    <td className="px-3 py-2 text-gray-700">{formatDate(row.queued_at) || '—'}</td>
                    <td className="px-3 py-2 font-mono">
                      <BookingBillLink orderId={nextBookingLink.orderId}>
                        {nextBookingLink.label || '—'}
                      </BookingBillLink>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        loading={removingQueueId === row.id}
                        disabled={removingQueueId === row.id}
                        onClick={() => onRemoveFromQueue?.(row)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {laundryWashing.length > 0 ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
            In Washing
          </div>
          <div className="mb-2 rounded-md border border-brand/20 bg-brand/10 px-3 py-2 text-xs text-brand">
            This product is already with the laundry vendor. Contact the vendor or pickup person below for return timing.
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-md">
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">
                    <TableHeaderLabel>Job No</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Job ID</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Vendor</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Pickup By</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Laundry Date</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right" nowrap>
                      Action
                    </TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {laundryWashing.map((row) => (
                  <tr key={row.line_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{row.job_no || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.laundry_job_id || '—'}</td>
                    <td className="px-3 py-2">{row.vendor_name || '—'}</td>
                    <td className="px-3 py-2">{row.pickup_by || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">{formatDate(row.laundry_date) || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{row.qty}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenLaundryJob?.(row.laundry_job_id)}
                      >
                        View Job
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Booking history overlapping this window
        </div>
        {conflicts.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No active bookings in this window.</div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-md">
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">
                    <TableHeaderLabel>Bill #</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Order</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Customer</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Pickup</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Return</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Status</TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {conflicts.map((c) => (
                  <tr key={c.order_item_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">
                      <BookingBillLink orderId={c.order_id}>{c.bill_no}</BookingBillLink>
                    </td>
                    <td className="px-3 py-2">
                      <BookingBillLink orderId={c.order_id}>{c.order_number}</BookingBillLink>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">
                        {c.customer_name || '—'}
                      </div>
                      {c.customer_phone ? (
                        <div className="text-xs text-gray-500">{c.customer_phone}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{formatDate(c.pickup_date)}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {c.return_date ? formatDate(c.return_date) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{c.booked_qty}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[c.status] || 'gray'}>
                        {c.status.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

AvailabilityResult.propTypes = {
  result: PropTypes.shape({
    product: PropTypes.object.isRequired,
    from: PropTypes.string,
    to: PropTypes.string,
    total_qty: PropTypes.number,
    booked_qty: PropTypes.number,
    washing_queue_qty: PropTypes.number,
    laundry_washing_qty: PropTypes.number,
    washing_queue: PropTypes.arrayOf(PropTypes.object),
    laundry_washing: PropTypes.arrayOf(PropTypes.object),
    free_qty: PropTypes.number,
    conflicts: PropTypes.arrayOf(PropTypes.object),
    upcoming_bookings: PropTypes.arrayOf(PropTypes.object),
  }).isRequired,
  onRemoveFromQueue: PropTypes.func,
  removingQueueId: PropTypes.string,
  onOpenLaundryJob: PropTypes.func,
  onOpenHistory: PropTypes.func,
};

AvailabilityResult.defaultProps = {
  onRemoveFromQueue: undefined,
  removingQueueId: null,
  onOpenLaundryJob: undefined,
  onOpenHistory: undefined,
};

const RelatedAvailabilitySection = ({ rows, loading, onToggleSelected, onOpenHistory }) => {
  if (loading) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
        Checking related products…
      </div>
    );
  }
  if (!rows?.length) return null;

  const availableCount = rows.filter((r) => r.result?.available).length;

  return (
    <div className="rounded-md border border-gray-200 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 border-b border-gray-200">
        <div>
          <div className="text-xs font-semibold text-gray-800">Related products</div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Full availability for each linked item · {availableCount} of {rows.length} available ·
            selected ones are added with Add to Cart / Quick Bill
          </p>
        </div>
        <Badge tone={availableCount > 0 ? 'green' : 'red'}>
          {availableCount}/{rows.length} available
        </Badge>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((row) => {
          const relatedId = row.related?.related_product_id;
          const result = row.result;
          const summary = summarizeProductAvailability(result);
          const available = !!result?.available;
          const name = row.related?.name || result?.product?.name || 'Related product';
          const code = row.related?.code || result?.product?.code || '—';
          const image = row.related?.main_image || result?.product?.main_image || '';
          const product = result?.product || {};
          const totalQty = Number(result?.total_qty ?? product.qty ?? 0);
          const bookedQty = Number(result?.booked_qty || 0);
          const freeQty = Number(result?.free_qty || 0);
          const washingQueueQty = Number(result?.washing_queue_qty || 0);
          const laundryWashingQty = Number(result?.laundry_washing_qty || 0);
          const upcomingBookings = result?.upcoming_bookings || [];
          const from = result?.from;
          const to = result?.to;
          return (
            <div
              key={relatedId || code}
              className={clsx('px-3 py-3 space-y-2.5', available ? 'bg-white' : 'bg-red-50/40')}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <label className="flex items-start gap-2.5 min-w-0 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0 accent-brand"
                    checked={!!row.selected && available}
                    disabled={!available}
                    onChange={(e) => onToggleSelected(relatedId, e.target.checked)}
                    aria-label={`Include ${name} in cart`}
                  />
                  <SmartImage
                    src={image}
                    alt={name}
                    className="w-12 h-12 rounded border border-gray-200 bg-white object-contain shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 break-words">{name}</span>
                      {row.related?.is_required ? (
                        <Badge tone="red" className="text-[10px]">
                          Required
                        </Badge>
                      ) : null}
                      {row.related?.is_recommended ? (
                        <Badge tone="brand" className="text-[10px]">
                          Recommended
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-[11px] font-mono text-gray-500">{code}</div>
                    <div className="text-[11px] text-gray-600 mt-0.5">
                      Rent {formatCurrency(row.related?.price_rent ?? product.price_rent ?? 0)}
                      {product.color ? <> · {product.color}</> : null}
                      {product.size ? <> · {product.size}</> : null}
                    </div>
                  </div>
                </label>
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end shrink-0">
                  {row.error ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                      <XCircle size={13} />
                      Check failed
                    </span>
                  ) : (
                    <span
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold',
                        available
                          ? 'border-green-200 bg-green-50 text-green-700'
                          : 'border-red-200 bg-red-50 text-red-700'
                      )}
                    >
                      {available ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      {available ? 'Available' : 'Not available'} — {summary.free} free / need{' '}
                      {summary.requested}
                    </span>
                  )}
                  {summary.holdBadges?.length > 0 ? (
                    <AvailabilityHoldBadges badges={summary.holdBadges} compact />
                  ) : null}
                  {onOpenHistory ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={History}
                      onClick={() => onOpenHistory(row)}
                    >
                      History
                    </Button>
                  ) : null}
                </div>
              </div>

              {result && !row.error ? (
                <div className="flex flex-wrap gap-2 text-xs pl-0 sm:pl-7">
                  <Stat label="Total" value={totalQty} tone="gray" />
                  <Stat label="Booked (in range)" value={bookedQty} tone="yellow" />
                  {washingQueueQty > 0 ? (
                    <Stat label="In Washing Queue" value={washingQueueQty} tone="orange" />
                  ) : null}
                  {laundryWashingQty > 0 ? (
                    <Stat label="In Washing" value={laundryWashingQty} tone="brand" />
                  ) : null}
                  <Stat label="Free (in range)" value={freeQty} tone={freeQty > 0 ? 'green' : 'red'} />
                  <span className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
                    <span className="uppercase text-[10px] tracking-wider">Next pickup</span>
                    <span className="font-semibold text-xs">
                      <UpcomingPickupDates bookings={upcomingBookings} />
                    </span>
                  </span>
                  {from && to ? (
                    <Stat label="Window" value={`${formatDate(from)} → ${formatDate(to)}`} tone="brand" />
                  ) : null}
                </div>
              ) : null}

              {(row.error || summary.reason) ? (
                <div
                  className={clsx(
                    'text-[11px] leading-snug pl-0 sm:pl-7',
                    available ? 'text-gray-600' : 'text-red-800'
                  )}
                >
                  {row.error || summary.reason}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

RelatedAvailabilitySection.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.object).isRequired,
  loading: PropTypes.bool,
  onToggleSelected: PropTypes.func.isRequired,
  onOpenHistory: PropTypes.func,
};

RelatedAvailabilitySection.defaultProps = {
  loading: false,
  onOpenHistory: undefined,
};

const Stat = ({ label, value, tone }) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 rounded border px-2 py-1',
      tone === 'green' && 'border-green-200 bg-green-50 text-green-700',
      tone === 'red' && 'border-red-200 bg-red-50 text-red-700',
      tone === 'yellow' && 'border-yellow-200 bg-yellow-50 text-yellow-700',
      tone === 'orange' && 'border-orange-200 bg-orange-50 text-orange-700',
      tone === 'brand' && 'border-brand/30 bg-brand/10 text-brand',
      (!tone || tone === 'gray') && 'border-gray-200 bg-gray-50 text-gray-700'
    )}
  >
    <span className="uppercase text-[10px] tracking-wider">{label}</span>
    <span className="font-semibold">{value}</span>
  </span>
);

function cartLineHasNote(line) {
  return Boolean(
    String(line?.tailor_notes || '').trim() || String(line?.tailor_note_image || '').trim()
  );
}

const CartListView = ({
  cart,
  loading,
  totals,
  onChangeQty,
  onRemove,
  onClearAll,
  onQuickBillForCustomer,
  onAddMoreForCustomer,
  onAddAccessories,
  onAddNotes,
}) => {
  const sortedCart = useMemo(() => sortCartLinesNewestFirst(cart), [cart]);

  // Group by customer; newest lines (and recently updated) appear first.
  const groups = useMemo(() => {
    const map = new Map();
    sortedCart.forEach((line) => {
      const key = line.customer_id || '__none__';
      if (!map.has(key)) {
        map.set(key, {
          customer_id: line.customer_id || null,
          customer_name: line.customer_name || 'Unassigned',
          customer_phone: line.customer_phone || '',
          items: [],
          qty: 0,
          amount: 0,
          sortTime: 0,
          contributors: new Map(),
        });
      }
      const group = map.get(key);
      group.items.push(line);
      group.qty += Number(line.qty || 0);
      group.amount += Number(line.price_rent || 0) * Number(line.qty || 0);
      const lineTime = cartLineSortTime(line);
      if (lineTime > group.sortTime) group.sortTime = lineTime;
      if (line.added_by_id) {
        group.contributors.set(line.added_by_id, {
          id: line.added_by_id,
          name: line.added_by_name,
          avatar: line.added_by_avatar,
        });
      }
    });
    return Array.from(map.values())
      .map((g) => ({
        ...g,
        items: sortCartLinesNewestFirst(g.items),
        contributors: Array.from(g.contributors.values()),
      }))
      .sort((a, b) => b.sortTime - a.sortTime);
  }, [sortedCart]);

  if (loading) {
    return (
      <div className="p-6 text-center text-xs text-gray-500">
        Loading saved cart…
      </div>
    );
  }
  if (cart.length === 0) {
    return (
      <div className="p-6 text-center text-xs text-gray-500">
        <ShoppingCart size={28} className="mx-auto text-gray-300 mb-2" />
        Cart is empty. Add products from the availability checker to see them here.
      </div>
    );
  }
  return (
    <div className="p-2.5 space-y-2.5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-gray-500">
          Cart is saved in the database — it won&apos;t disappear on refresh and
          is shared with everyone at this shop.
        </div>
        {onClearAll ? (
          <Button
            size="sm"
            variant="secondary"
            icon={Trash2}
            iconPosition="left"
            onClick={onClearAll}
          >
            Clear all
          </Button>
        ) : null}
      </div>

      {groups.map((group) => (
        <div
          key={group.customer_id || 'none'}
          className="border border-gray-200 rounded-lg overflow-hidden bg-white"
        >
          {/* Customer header */}
          <div className="flex flex-wrap items-center gap-2 bg-brand-light/40 border-b border-gray-200 px-2.5 py-1.5">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-900 truncate">
                {group.customer_name}
              </div>
              {group.customer_phone ? (
                <div className="text-[11px] text-gray-500 leading-tight">
                  {group.customer_phone}
                </div>
              ) : null}
              {group.items[0]?.created_at ? (
                <div className="text-[11px] text-gray-500 mt-0.5 whitespace-nowrap">
                  {formatDateTime(group.items[0].created_at)}
                </div>
              ) : null}
            </div>
            <div className="text-[11px] text-gray-600">
              {group.items.length} line{group.items.length === 1 ? '' : 's'} ·{' '}
              {group.qty} item{group.qty === 1 ? '' : 's'}
            </div>
            <div className="text-xs font-semibold text-gray-900">
              {formatCurrency(group.amount)}
            </div>
            <div className="flex items-center gap-2">
              {group.customer_id && onQuickBillForCustomer ? (
                <Button
                  size="sm"
                  icon={ShoppingCart}
                  iconPosition="left"
                  onClick={() => onQuickBillForCustomer(group.items[0])}
                >
                  Quick Bill
                </Button>
              ) : null}
              {group.customer_id && onAddMoreForCustomer ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Plus}
                  iconPosition="left"
                  onClick={() => onAddMoreForCustomer(group.items[0])}
                >
                  Add more
                </Button>
              ) : null}
            </div>
          </div>

          {/* Per-customer items */}
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">
                    <TableHeaderLabel>Image</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Code</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Name</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Delivery</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Return</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Rent</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Line Total</TableHeaderLabel>
                  </th>
                  <th className="text-center">
                    <TableHeaderLabel align="center">Accessories</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Added by</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Actions</TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {group.items.map((c) => (
                  <tr key={c.id}>
                    <td className="px-2.5 py-1.5">
                      <SmartImage
                        src={c.main_image}
                        alt={c.name}
                        className="w-7 h-7 rounded border border-gray-200 bg-gray-50 object-contain"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-[11px]">{c.code}</td>
                    <td className="px-2.5 py-1.5 font-medium text-gray-800">{c.name}</td>
                    <td className="px-2.5 py-1.5">
                      {formatDate(c.from)}
                      {c.delivery_time ? ` · ${c.delivery_time}` : ''}
                    </td>
                    <td className="px-2.5 py-1.5">
                      {formatDate(c.to)}
                      {c.return_time ? ` · ${c.return_time}` : ''}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <input
                        type="number"
                        min={1}
                        value={c.qty}
                        onChange={(e) => onChangeQty?.(c, e.target.value)}
                        className="input h-7 w-16 text-right text-xs"
                      />
                    </td>
                    <td className="px-2.5 py-1.5 text-right">{formatCurrency(c.price_rent)}</td>
                    <td className="px-2.5 py-1.5 text-right font-semibold">
                      {formatCurrency(Number(c.price_rent || 0) * Number(c.qty || 0))}
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      {countSelectedAccessories(c.accessories) > 0 ? (
                        <Badge tone="brand" className="tabular-nums">
                          {countSelectedAccessories(c.accessories)}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5">
                      {c.added_by_name ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-gray-700"
                          title={c.added_by_email || ''}
                        >
                          {c.added_by_avatar ? (
                            <img
                              src={c.added_by_avatar}
                              alt=""
                              className="w-5 h-5 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <span className="w-4 h-4 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                              <User size={12} />
                            </span>
                          )}
                          <span className="truncate max-w-[140px]">{c.added_by_name}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onAddNotes ? (
                          <button
                            type="button"
                            onClick={() => onAddNotes(c)}
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                              cartLineHasNote(c)
                                ? 'border-brand bg-brand-light text-brand'
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                            }`}
                            title="Add or edit product note"
                            aria-label="Add or edit product note"
                          >
                            Note
                          </button>
                        ) : null}
                        {onAddAccessories ? (
                          <button
                            type="button"
                            onClick={() => onAddAccessories(c)}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand-light"
                            title="Add accessories"
                          >
                            <PackagePlus size={14} />
                            <span className="hidden sm:inline">Accessories</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onRemove?.(c)}
                          className="text-red-600 hover:text-red-800 p-0.5"
                          aria-label="Remove from cart"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

function addDaysISO(isoLike, days) {
  const raw = String(isoLike || '').slice(0, 10);
  if (!raw) return '';
  const d = new Date(raw);
  d.setDate(d.getDate() + Number(days || 0));
  return toLocalISODate(d);
}

/** @param {object|null} result */
function buildAvailabilityHoldBadges(result) {
  if (!result) return [];
  const badges = [];
  const washingQueue = Number(result.washing_queue_qty || 0);
  const laundryWashing = Number(result.laundry_washing_qty || 0);
  if (washingQueue > 0) {
    badges.push({ key: 'washing_queue', label: 'Washing Queue', qty: washingQueue, tone: 'orange' });
  }
  if (laundryWashing > 0) {
    badges.push({ key: 'in_washing', label: 'In Washing', qty: laundryWashing, tone: 'brand' });
  }
  return badges;
}

/** @param {object} result @param {{ available: boolean }} summary */
function isUnavailableOnlyBecauseOfWashing(result, summary) {
  if (summary.available) return false;
  const washingQueue = Number(result.washing_queue_qty || 0);
  const laundryWashing = Number(result.laundry_washing_qty || 0);
  if (washingQueue <= 0 && laundryWashing <= 0) return false;

  const status = String(result.product?.status || '').toLowerCase();
  if (status === 'repair' || status === 'sold' || status === 'lost') return false;
  if (Number(result.total_qty || 0) <= 0) return false;
  if (Number(result.booked_qty || 0) > 0) return false;

  if (result.from && result.to && Array.isArray(result.conflicts)) {
    for (const c of result.conflicts) {
      const baseDate = c.return_date || c.pickup_date;
      const nextGapDays = Math.max(0, Number(c.next_booking_gap_days || 0));
      if (baseDate) {
        const nextAllowed = earliestPickupAfterReturnGap(baseDate, c.pickup_date, nextGapDays);
        if (nextAllowed && result.from < nextAllowed) return false;
      }
      const prevGapDays = Math.max(0, Number(c.previous_booking_gap_days || 0));
      if (c.pickup_date && prevGapDays > 0) {
        const lastAllowedReturn = latestReturnBeforePickupGap(c.pickup_date, prevGapDays);
        if (lastAllowedReturn && result.to > lastAllowedReturn) return false;
      }
    }
  }

  return true;
}

/** @param {object} result @param {{ available: boolean }} summary */
function resolveAvailabilityBannerTone(result, summary) {
  if (summary.available) return 'available';
  if (!isUnavailableOnlyBecauseOfWashing(result, summary)) return 'unavailable';

  const washingQueue = Number(result.washing_queue_qty || 0);
  const laundryWashing = Number(result.laundry_washing_qty || 0);
  if (washingQueue > 0 && laundryWashing <= 0) return 'washing_queue';
  if (laundryWashing > 0 && washingQueue <= 0) return 'in_washing';
  return 'washing_mixed';
}

/**
 * Human-readable availability status for check-availability UI.
 * @param {object|null} result
 */
function summarizeProductAvailability(result) {
  const available = !!result?.available;
  const free = Number(result?.free_qty || 0);
  const requested = Number(result?.requested_qty || 1);
  if (!result) {
    return { available: false, free: 0, requested: 1, reason: '', holdBadges: [] };
  }

  const holdBadges = buildAvailabilityHoldBadges(result);

  if (available) {
    return {
      available: true,
      free,
      requested,
      reason: free > requested ? `${free - requested} extra free in this window` : '',
      holdBadges,
    };
  }

  const reasons = [];
  const status = String(result.product?.status || '').toLowerCase();
  const statusReasons = {
    repair: 'In repair',
    sold: 'Sold',
    lost: 'Marked lost',
  };
  if (statusReasons[status]) reasons.push(statusReasons[status]);

  const total = Number(result.total_qty || 0);
  const booked = Number(result.booked_qty || 0);
  const washingQueue = Number(result.washing_queue_qty || 0);
  const laundryWashing = Number(result.laundry_washing_qty || 0);

  if (total <= 0) reasons.push('No stock on hand');

  if (booked > 0) {
    const orderCount = Array.isArray(result.conflicts) ? result.conflicts.length : 0;
    const windowLabel =
      result.from && result.to
        ? `${formatDate(result.from)}–${formatDate(result.to)}`
        : 'selected dates';
    reasons.push(
      orderCount > 0
        ? `${booked} booked for ${windowLabel} (${orderCount} order${orderCount === 1 ? '' : 's'})`
        : `${booked} booked for ${windowLabel}`
    );
  }

  if (washingQueue > 0) {
    reasons.push(`${washingQueue} in washing queue`);
  }
  if (laundryWashing > 0) {
    reasons.push(`${laundryWashing} out for washing`);
  }

  if (result.from && result.to && Array.isArray(result.conflicts)) {
    for (const c of result.conflicts) {
      const baseDate = c.return_date || c.pickup_date;
      const nextGapDays = Math.max(0, Number(c.next_booking_gap_days || 0));
      if (baseDate) {
        const nextAllowed = earliestPickupAfterReturnGap(baseDate, c.pickup_date, nextGapDays);
        if (result.from < nextAllowed) {
          reasons.push(`Gap rule: deliver on or after ${formatDate(nextAllowed)}`);
          break;
        }
      }
      const prevGapDays = Math.max(0, Number(c.previous_booking_gap_days || 0));
      if (c.pickup_date && prevGapDays > 0) {
        const lastAllowedReturn = latestReturnBeforePickupGap(c.pickup_date, prevGapDays);
        if (lastAllowedReturn && result.to > lastAllowedReturn) {
          reasons.push(
            `Gap rule: return on or before ${formatDate(lastAllowedReturn)} (before delivery ${formatDate(c.pickup_date)})`
          );
          break;
        }
      }
    }
  }

  if (reasons.length === 0 && free < requested) {
    reasons.push(`Only ${free} free, need ${requested}`);
  }

  return {
    available: false,
    free,
    requested,
    reason: reasons.length > 0 ? reasons.join(' · ') : 'Not available for selected dates',
    holdBadges,
  };
}

// Consumed by parent; nothing exported beyond default.
export default CheckAvailability;
