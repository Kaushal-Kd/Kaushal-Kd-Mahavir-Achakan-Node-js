import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accessoryRentableQty, collectIndianPhones, formatAccessoryQtyExceededMessage, formatAccessorySpareMessage, formatCurrency, formatDate, formatDateTime, getIndiaDateTimeParts, isIndianPhone, normalizeBookingTime, normalizeOrderTime, normalizeTime12, formatOrderTime12, normalizePhone, normalizeCustomOrderSqlDate, phoneInputDigits, nowDatetimeLocal, round2, splitDatetimeLocal, syncAccessoryStageFlagsForGivenStatusChange, toDatetimeLocalValue, toISODate, ACTIONS, MODULES, hasPermission, toLocalISODate } from '@wrs/shared';
import clsx from 'clsx';
import { Camera, GripVertical, History, Info, Minus, PackagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import BarcodeScannerModal from '../../components/ui/BarcodeScannerModal.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import EditableAdvanceAmountField from '../../components/booking/EditableAdvanceAmountField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import ImageUploader from '../../components/ui/ImageUploader.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import BookingAuditBadge from '../../components/booking/BookingAuditBadge.jsx';
import BookingDraftActions from '../../components/booking/BookingDraftActions.jsx';
import BookingLogsModal from '../../components/booking/BookingLogsModal.jsx';
import SettlementModal from './SettlementModal.jsx';
import ProductRentalHistoryModal from '../../components/booking/ProductRentalHistoryModal.jsx';
import LineNotesCell from '../../components/booking/LineNotesCell.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { customersApi } from '../../lib/api/customers.js';
import { draftsApi } from '../../lib/api/drafts.js';
import { creditNotesApi } from '../../lib/api/creditNotes.js';
import { ordersApi } from '../../lib/api/orders.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { buildBookingEditSettlement } from '../../lib/bookingEditSettlement.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { createQueueId, syncService } from '../../services/syncService.js';
import { productsApi } from '../../lib/api/products.js';
import { customOrdersApi } from '../../lib/api/customOrders.js';
import {
  clearCustomOrderBookingHandoff,
  linkHandoffCustomerToCustomOrder,
  readCustomOrderBookingHandoff,
  resolveHandoffCustomer,
} from '../../lib/customOrderBookingHandoff.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { timeSlotsApi } from '../../lib/api/timeSlots.js';
import { useAppSettings } from '../../hooks/useAppSettings.js';
import { invalidateCustomersDomain, invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { stashTokenDownloadPrompt } from '../../lib/bookingTokenDownloadPrompt.js';
import { queryKeys } from '../../lib/queryKeys.js';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import { hydrateBookingCustomerFields } from '../../lib/bookingCustomerHydration.js';
import { buildCustomerContactPatch } from '../../lib/customerContactPatch.js';
import { printBill } from '../../utils/printBill.js';
import {
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
  FALLBACK_TIME_OPTIONS,
  resolveTimeSlotDefaults,
  timeSlotsToSelectOptions,
} from '../../lib/timeSelectOptions.js';
import {
  draftLabelFromSnapshot,
  getActiveDraftId,
  isSnapshotTriviallyEmpty,
  readDraftList,
  removeBookingDraft,
  setActiveDraftId as persistActiveDraftStorageKey,
  upsertBookingDraft,
} from '../../lib/bookingDraftStorage.js';
import {
  accessoryPickerAvailableQty,
  compositeAccessoryDisplayOrder,
  ensureAccessoryLineIds,
  formatAccessoryDateAvailability,
  isAccessoryPickerOutOfStock,
  canGrandfatherAccessorySelection,
  deselectAccessoryRow,
  reactivateAccessoryRow,
  overlayAccessoryCatalogAvailability,
  mergeSavedCartAccessoriesWithCatalog,
  nextAccessoryDisplayOrder,
  normalizeBookingLinesFromDraft,
  productLineIsSaleOnly,
  resolveAccessoryPickerType,
  sortAccessoriesByDisplayOrder,
  sortAccessoriesRentThenSell,
  sortLinesForBookingTable,
  reorderBookingLines,
  moveLinkedAccessory,
  nextLineDisplayOrder,
  lineBookingSection,
  givenRentBooleansFromStatus,
  defaultHandedOverAccessoryStageFlags,
  isCounterHandoverAccessory,
} from '../../lib/bookingAccessoryCart.js';
import { buildSalesmanSelectOptions, isSalesmanEligibleUser } from '../../lib/salesmanOptions.js';
import { usersApi } from '../../lib/api/users.js';
import { getApiErrorMessage } from '../../lib/apiError.js';
import {
  refreshRentAccessoryLinesAvailability,
  validateRentAccessoryQty,
} from '../../lib/accessoryAvailability.js';
import {
  refreshRentLinesAvailability,
  validateRentProductQty,
  validateReconcileProductLines,
  validateSellProductQty,
} from '../../lib/productAvailability.js';
import { validateOrderRentAvailability } from '../../lib/orderSubmitAvailability.js';
import { useAuthStore } from '../../stores/authStore.js';
import { clearFieldError, fieldShellClass, rejectSubmit } from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';

const todayISO = toISODate(new Date());
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
}
/** Modal open target when there is no product line (accessories-only booking). */
const ACCESSORY_ONLY_MODAL_LINE_ID = '__accessories_only__';

const ACCESSORY_GIVE_STATUS = 'given_with_rent';
const ACCESSORY_GIVE_TYPE = 'rent';
const ACCESSORY_ORDER_STATUS_OPTIONS = [
  { value: 'regular', label: 'Regular' },
  { value: 'given_with_rent', label: 'Given with rent' },
  { value: 'pack_with_rent', label: 'Pack with rent' },
];

function sumPaymentsByCategory(payments, category) {
  return (Array.isArray(payments) ? payments : [])
    .filter((p) => p?.category === category && !p?.is_deleted)
    .reduce((s, p) => s + Number(p?.amount || 0), 0);
}

/** Advance net from payment rows (matches edit hydrate / deltaAdv on save). */
function netAdvanceFromPayments(payments) {
  return round2(
    Math.max(0, sumPaymentsByCategory(payments, 'advance') - sumPaymentsByCategory(payments, 'refund'))
  );
}

/** Rent bill paid total — aligned with backend recomputeOrderPayment income/expense categories. */
function netBillPaidFromPayments(payments) {
  const income =
    sumPaymentsByCategory(payments, 'advance') +
    sumPaymentsByCategory(payments, 'partial') +
    sumPaymentsByCategory(payments, 'final') +
    sumPaymentsByCategory(payments, 'credit_note_apply');
  const expense =
    sumPaymentsByCategory(payments, 'refund') + sumPaymentsByCategory(payments, 'credit_note_issue');
  return round2(Math.max(0, income - expense));
}

const toNonNegativeAmount = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

/** Controlled money input: empty allowed, minus values clamped to 0. */
const parseAmountInput = (raw) => {
  if (raw === '' || raw == null) return '';
  return toNonNegativeAmount(raw);
};

function normalizeAccessoryOrderStatus(v) {
  const s = String(v || '').trim();
  if (s === 'given_with_rent' || s === 'pack_with_rent' || s === 'regular') return s;
  return 'regular';
}

/** Sync stage_flags in update payload when persisted accessory given status changed on edit. */
function buildPersistedAccessoryStageFlagsPayload(accessoryRow) {
  if (!accessoryRow?.persisted_id) return {};
  const newStatus = normalizeAccessoryOrderStatus(accessoryRow.accessory_order_status);
  const oldStatus = normalizeAccessoryOrderStatus(
    accessoryRow._hydrated_given_status ?? newStatus
  );
  if (oldStatus === newStatus) return {};
  return {
    stage_flags: syncAccessoryStageFlagsForGivenStatusChange(
      oldStatus,
      newStatus,
      accessoryRow._hydrated_stage_flags,
      { isSell: isSellAccessoryLine(accessoryRow) }
    ),
  };
}

function accessoryDefaultType(accessory) {
  const kind = String(accessory?.default_type || '').toLowerCase();
  if (kind === 'sell') return 'sell';
  return 'rent';
}

function getDefaultProductLineType(product) {
  const kind = String(product?.type || '').toLowerCase();
  if (kind === 'sell') return 'sell';
  return 'rent';
}

function catalogPriceForType(catalog, type) {
  const rent = Number(catalog?.catalog_price_rent ?? catalog?.price_rent ?? 0);
  const sell = Number(catalog?.catalog_price_sell ?? catalog?.price_sell ?? 0);
  const selected = type === 'sell' ? sell : rent;
  if (Number.isFinite(selected)) return selected;
  return Number(catalog?.price ?? 0) || 0;
}

function accessoryPriceForType(catalog, type) {
  return catalogPriceForType(catalog, type);
}

function accessoryDefaultOrderStatus(accessory) {
  return normalizeAccessoryOrderStatus(accessory?.default_order_status || ACCESSORY_GIVE_STATUS);
}

function filterRecommendedGroupItems(items, searchTerm) {
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return items;
  return items.filter((a) => String(a.name_snapshot || '').toLowerCase().includes(term));
}

function formatAccessoryBillingSummaryForLine(a) {
  const typeLabel = a.type === 'sell' ? 'Sell' : 'Rent';
  const s = normalizeAccessoryOrderStatus(a.accessory_order_status);
  const statusLabel = s === ACCESSORY_GIVE_STATUS ? 'Give' : s === 'pack_with_rent' ? 'Pack w/ rent' : 'Regular';
  return `${typeLabel} · ${statusLabel}`;
}

function normPaymentAccountGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

/** Shared width/style for Advance + Security account selects in the booking summary. */
const BOOKING_ACCOUNT_SELECT_CLASS = 'input min-w-[11rem] flex-1 text-xs py-1.5 pr-8';

const BOOKING_FIELD_SCROLL_ORDER = [
  'customer',
  'customerName',
  'contactNo1',
  'contactNo2',
  'whatsapp',
  'address',
  'pickupDate',
  'returnDate',
  'pickupTime',
  'returnTime',
  'lines',
  'advanceAmount',
  'advanceAccountId',
  'securityAccountId',
  'applyCreditAmount',
  'bookingDateTime',
];

const NEXT_BOOKING_GAP_TOOLTIP = [
  'Minimum days between the previous return and the next delivery for cleaning and preparation.',
  'Each product has gap (days) on its catalog record; availability uses return date + gap to compute the earliest next delivery.',
  'Example: gap 2 days — return 20 Jan → earliest next delivery 22 Jan+. If delivery is 21 Jan, you should see a warning below.',
];

const PREVIOUS_BOOKING_GAP_TOOLTIP = [
  'Minimum days before this delivery when another booking ends — blocks earlier bookings placed too close.',
  'Availability extends this booking backward from delivery date by the gap you enter.',
  'Example: delivery 13 with gap 3 → a prior booking must return by 9. Return 10–12 would not be allowed.',
];

function resolveWhatsappValue({ whatsappSource, whatsappManual, phone1, phone2 }) {
  const p1 = phoneInputDigits(phone1);
  const p2 = phoneInputDigits(phone2);
  if (whatsappSource === 'phone1') return p1 || '';
  if (whatsappSource === 'phone2') return p2.length === 10 ? p2 : '';
  return phoneInputDigits(whatsappManual);
}

const CreateOrder = ({ mode, orderId }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const deliveredEditUnlock = location.state?.deliveredEditUnlock;
  const deliveredEditAdminPassword = location.state?.adminPassword;
  const reconcileUnlock = location.state?.reconcileUnlock;
  const reconcileAdminPassword = location.state?.adminPassword;
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const appSettings = useAppSettings();
  const wa = useWhatsAppOutbound();
  const sendAfterCreateRef = useRef(null);
  const submitLockRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const returnOffsetDays = appSettings.getNumber('AUTO_SELECT_RETURN_DATE_DAYS', 3);
  const gapDaysDefault = appSettings.getNumber('CHECK_AVAILABILITY_GAP_DAYS_BETWEEN_TWO_ORDERS', 2);
  const previousGapDaysDefault = appSettings.getNumber(
    'CHECK_AVAILABILITY_PREVIOUS_GAP_DAYS_BETWEEN_TWO_ORDERS',
    2
  );
  const maxReturnDays = appSettings.getNumber('DELIVERY_TO_RETURN_DATE_MAX_DAYS', 10);
  const maxFutureBookingDays = appSettings.getNumber('MAXIMUM_FUTURE_BOOKING_DURATION', 3);
  const allowProductAutocomplete = appSettings.isYes('ALLOW_AUTOCOMPLETE_FOR_CODE', 'Yes');
  const displaySalesman = appSettings.isYes('DISPLAY_SALESMAN_IN_CREATE_BOOKING', 'Yes');
  const advanceMandatory = appSettings.isYes('MAKE_ADVANCE_MANDATORY', 'No');
  const timeSlotMandatory = appSettings.isYes('TIME_SLOT_MANDATORY', 'No');
  const saveAndPrintBooking = appSettings.isYes('SAVE_AND_PRINT_BOOKING', 'No');
  const isEditMode = mode === 'edit' && !!orderId;
  const canViewLogs = hasPermission(currentUser, MODULES.AUDIT_LOGS, ACTIONS.VIEW);
  const [auditLogsOpen, setAuditLogsOpen] = useState(false);
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const wasDeliveredEditRef = useRef(false);
  const wasReconcileRef = useRef(false);
  /** Advance net when edit form loaded — used to preview paid/remaining when Advance field changes. */
  const initialEditAdvanceNetRef = useRef(0);
  const editFinancialBaselineRef = useRef(null);
  const editCommandRef = useRef(null);
  const isOnline = useOnlineStatus();
  /** Full edit hydrate runs once per order id (settlement refetch must not reset lines). */
  const editHydratedForOrderIdRef = useRef(null);
  /** Original delivery/return dates on edit load — grandfather unchanged past dates on save. */
  const editOriginalPickupRef = useRef(null);
  const editExpectedProductsRef = useRef([]);
  const editOriginalReturnRef = useRef(null);
  const [editingDeliveredOrder, setEditingDeliveredOrder] = useState(false);
  const [editingReconcileOrder, setEditingReconcileOrder] = useState(false);
  const [customer, setCustomer] = useState(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [editingCustomerName, setEditingCustomerName] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productOpen, setProductOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProductSnapshot, setHistoryProductSnapshot] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [lineQty, setLineQty] = useState(1);
  const [lines, setLines] = useState([]);
  const [bookingDateTime, setBookingDateTime] = useState(() => nowDatetimeLocal());
  const [pickupDate, setPickupDate] = useState(todayISO);
  const [returnDate, setReturnDate] = useState(addDaysISO(todayISO, 3));
  const [pickupTime, setPickupTime] = useState(FALLBACK_DEFAULT_DELIVERY_TIME);
  const [returnTime, setReturnTime] = useState(FALLBACK_DEFAULT_RETURN_TIME);
  const [deposit, setDeposit] = useState(0);
  const [paidSecurityAmt, setPaidSecurityAmt] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [applyCustomerCredit, setApplyCustomerCredit] = useState(false);
  const [applyCreditAmount, setApplyCreditAmount] = useState('');
  const [contactNo1, setContactNo1] = useState('');
  const [contact2Name, setContact2Name] = useState('');
  const [contactNo2, setContactNo2] = useState('');
  const [contactNo2SameAsPhone1, setContactNo2SameAsPhone1] = useState(false);
  const [whatsappSource, setWhatsappSource] = useState('phone1');
  const [whatsappManual, setWhatsappManual] = useState('');
  const [address, setAddress] = useState('');
  const [igstBill, setIgstBill] = useState(false);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [gstDefaultRate, setGstDefaultRate] = useState(0);
  const [taxMode, setTaxMode] = useState('exclusive');
  const [referenceName, setReferenceName] = useState('');
  const [nextBookingGapDaysInput, setNextBookingGapDaysInput] = useState('');
  const [previousBookingGapDaysInput, setPreviousBookingGapDaysInput] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [bookingDiscountType, setBookingDiscountType] = useState('flat');
  const [bookingDiscountValue, setBookingDiscountValue] = useState(0);
  const [quickBillDraftIds, setQuickBillDraftIds] = useState([]);
  const [advanceAccountId, setAdvanceAccountId] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const customerFieldRef = useRef(null);
  const linesCardRef = useRef(null);
  const pickupDateFieldRef = useRef(null);
  const returnDateFieldRef = useRef(null);
  const advanceSummaryRef = useRef(null);
  const bookingDateTimeFieldRef = useRef(null);
  const fieldRefs = useMemo(
    () => ({
      customer: customerFieldRef,
      customerName: customerFieldRef,
      contactNo1: customerFieldRef,
      contactNo2: customerFieldRef,
      whatsapp: customerFieldRef,
      address: customerFieldRef,
      pickupDate: pickupDateFieldRef,
      returnDate: returnDateFieldRef,
      pickupTime: pickupDateFieldRef,
      returnTime: returnDateFieldRef,
      lines: linesCardRef,
      advanceAmount: advanceSummaryRef,
      advanceAccountId: advanceSummaryRef,
      securityAccountId: advanceSummaryRef,
      applyCreditAmount: advanceSummaryRef,
      bookingDateTime: bookingDateTimeFieldRef,
    }),
    []
  );
  const err = (key) => fieldErrors[key];
  const touch = (key) => () => clearFieldError(setFieldErrors, key);
  const [initializingEdit, setInitializingEdit] = useState(false);
  const [qtyValidatingLineId, setQtyValidatingLineId] = useState('');
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const [addAccessoryForLineId, setAddAccessoryForLineId] = useState('');
  const [accessoryModalMode, setAccessoryModalMode] = useState('recommended');
  const [accessoryCategoryId, setAccessoryCategoryId] = useState('all');
  const [openRecommendedCategoryKey, setOpenRecommendedCategoryKey] = useState('');
  const [recommendedCategorySearch, setRecommendedCategorySearch] = useState({});
  const [accessorySearch, setAccessorySearch] = useState('');
  const [manualAccessoryDraft, setManualAccessoryDraft] = useState({});
  /** Catalog rows checked in modal — committed on Save. */
  const [pendingAccessoryPicks, setPendingAccessoryPicks] = useState({});
  /** Recommended accessory line_id → selected; committed on Save. */
  const [pendingRecommendedSelections, setPendingRecommendedSelections] = useState({});
  /** Applied when adding an accessory from the modal (search / all); cleared after add. Editable per line in the grid. */
  const [accessoryModalRemarks, setAccessoryModalRemarks] = useState('');
  const [noteEditorLineId, setNoteEditorLineId] = useState('');
  const [noteEditorValue, setNoteEditorValue] = useState('');
  const [noteEditorImageUrl, setNoteEditorImageUrl] = useState('');
  const [bookingDraftId, setBookingDraftId] = useState(null);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const draftHydrateDoneRef = useRef(false);
  const skipDraftPersistRef = useRef(false);
  const justStartedBlankDraftRef = useRef(false);
  const quickBillHandoffAppliedRef = useRef(false);
  const customOrderHandoffAppliedRef = useRef(false);
  const customOrderHandoffIdRef = useRef(null);
  const lastHandledFreshRef = useRef(null);
  const lastHandledStartNewDraftRef = useRef(null);
  const lastHandledManualSaveRef = useRef(null);
  const bookingDraftIdRef = useRef(null);
  const recommendedDropdownWrapRef = useRef(null);
  const recommendedAccessoryInitKeyRef = useRef('');
  const productCodeFieldRef = useRef(null);
  const productSearchInputRef = useRef(null);
  const addingProductLineRef = useRef(false);
  const [addingProductLine, setAddingProductLine] = useState(false);
  const [productDropdownPos, setProductDropdownPos] = useState(null);

  const syncProductDropdownPos = useCallback(() => {
    const el = productCodeFieldRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setProductDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 224),
    });
  }, []);

  const resetProductSearchBar = useCallback(() => {
    setProductQuery('');
    setSelectedProduct(null);
    setProductOpen(false);
    setLineQty(1);
    window.requestAnimationFrame(() => {
      productSearchInputRef.current?.focus?.();
    });
  }, []);

  const restoreProductSearchBar = useCallback((product) => {
    if (!product) return;
    setSelectedProduct(product);
    setProductQuery(String(product.code || product.name || '').trim());
    setProductOpen(false);
  }, []);

  useEffect(() => {
    if (!productOpen || productQuery.trim().length < 1) {
      setProductDropdownPos(null);
      return undefined;
    }
    syncProductDropdownPos();
    const onReposition = () => syncProductDropdownPos();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [productOpen, productQuery, syncProductDropdownPos]);

  useEffect(() => {
    bookingDraftIdRef.current = bookingDraftId;
  }, [bookingDraftId]);

  useEffect(() => {
    if (!addAccessoryForLineId) return;
    setProductOpen(false);
  }, [addAccessoryForLineId]);

  useEffect(() => {
    if (!openRecommendedCategoryKey) return undefined;
    const onOutsidePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const activeDropdownNode = target.closest(
        `[data-recommended-dropdown-key="${openRecommendedCategoryKey}"]`
      );
      if (activeDropdownNode) return;
      setOpenRecommendedCategoryKey('');
    };
    document.addEventListener('mousedown', onOutsidePointerDown);
    return () => {
      document.removeEventListener('mousedown', onOutsidePointerDown);
    };
  }, [openRecommendedCategoryKey]);

  const closeAccessoryModal = () => {
    setAddAccessoryForLineId('');
    setAccessoryModalMode('recommended');
    setAccessoryCategoryId('all');
    setOpenRecommendedCategoryKey('');
    setRecommendedCategorySearch({});
    setAccessorySearch('');
    setManualAccessoryDraft({});
    setPendingAccessoryPicks({});
    setPendingRecommendedSelections({});
    setAccessoryModalRemarks('');
  };

  const { data: customerResults } = useQuery({
    queryKey: ['customer-search', customerQuery],
    queryFn: () => customersApi.search(customerQuery),
    enabled: customerQuery.trim().length >= 2,
  });

  const customerDetailQuery = useQuery({
    queryKey: ['customer', customer?.id],
    queryFn: () => customersApi.get(customer.id),
    enabled: !!customer?.id,
  });

  const editOrderQuery = useQuery({
    queryKey: ['order-edit', orderId],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: isEditMode,
    staleTime: 30 * 1000,
  });

  const editBookingNumber = useMemo(() => {
    if (!isEditMode) return '';
    const o = editOrderQuery.data;
    if (!o) return '';
    return String(o.order_number || '').trim();
  }, [isEditMode, editOrderQuery.data]);

  const syncEditFinancialsFromOrder = useCallback((order) => {
    if (!order) return;
    setAdvanceAccountId(order.advance_account_id || '');
    setSecurityAccountId(order.security_account_id || '');
    setBookingDiscountType(order.booking_discount_type || 'flat');
    setBookingDiscountValue(toNonNegativeAmount(order.booking_discount_value || 0));
    const payments = Array.isArray(order.payments) ? order.payments : [];
    const advNet = netAdvanceFromPayments(payments);
    initialEditAdvanceNetRef.current = advNet;
    const depNet = round2(
      order.ordinary_security_net ?? Math.max(
        0,
        sumPaymentsByCategory(payments, 'deposit') - sumPaymentsByCategory(payments, 'deposit_refund')
      )
    );
    editFinancialBaselineRef.current = { advance: advNet, securityNet: depNet, depositAmount: toNonNegativeAmount(order.deposit_amount || 0), paid: depNet > 0 };
    setAdvanceAmount(toNonNegativeAmount(advNet));
    setDeposit(toNonNegativeAmount(order.deposit_amount || 0));
    setPaidSecurityAmt(depNet > 0);
  }, []);

  const handleSettlementSuccess = useCallback(async () => {
    if (!isEditMode || !orderId) return;
    try {
      const order = await ordersApi.get(orderId).then((r) => r.data);
      if (!order) return;
      queryClient.setQueryData(['order-edit', orderId], order);
      syncEditFinancialsFromOrder(order);
    } catch {
      /* ignore refresh errors; settlement already saved */
    }
  }, [isEditMode, orderId, queryClient, syncEditFinancialsFromOrder]);

  useEffect(() => {
    editHydratedForOrderIdRef.current = null;
  }, [orderId]);

  useEffect(() => {
    if (!isEditMode || editOrderQuery.isLoading) return;
    if (editOrderQuery.data?.status !== 'delivered') return;
    wasDeliveredEditRef.current = true;
    setEditingDeliveredOrder(true);
    if (!deliveredEditUnlock || !deliveredEditAdminPassword) {
      toast.warning('Shop Admin password is required to edit a delivered booking');
      navigate('/booking', { replace: true });
    }
  }, [
    isEditMode,
    editOrderQuery.isLoading,
    editOrderQuery.data?.status,
    deliveredEditUnlock,
    deliveredEditAdminPassword,
    navigate,
  ]);

  useEffect(() => {
    if (!isEditMode || editOrderQuery.isLoading) return;
    if (editOrderQuery.data?.status !== 'cancelled') return;
    wasReconcileRef.current = true;
    setEditingReconcileOrder(true);
    if (!reconcileUnlock || !reconcileAdminPassword) {
      toast.warning('Shop Admin password is required to reconcile a cancelled booking');
      navigate('/booking', { replace: true });
    }
  }, [
    isEditMode,
    editOrderQuery.isLoading,
    editOrderQuery.data?.status,
    reconcileUnlock,
    reconcileAdminPassword,
    navigate,
  ]);

  const productAvailabilityQuery = useQuery({
    queryKey: [
      'booking-product-search',
      productQuery,
      pickupDate,
      returnDate,
      lineQty,
    ],
    queryFn: () =>
      productsApi.bookingAvailability({
        search: productQuery,
        from: pickupDate,
        to: returnDate,
        qty: Math.max(1, Number(lineQty) || 1),
        per_page: 20,
      }),
    enabled:
      allowProductAutocomplete && productQuery.trim().length >= 1 && !!pickupDate && !!returnDate,
    keepPreviousData: true,
  });

  const productSearchFallbackQuery = useQuery({
    queryKey: ['booking-product-search-fallback', productQuery],
    queryFn: () => productsApi.list({ search: productQuery, per_page: 20 }),
    enabled: allowProductAutocomplete && productQuery.trim().length >= 1,
    keepPreviousData: true,
  });
  const accessorySearchQuery = useQuery({
    queryKey: ['accessory-search-booking', accessorySearch, accessoryCategoryId, pickupDate, returnDate, isEditMode ? orderId : '', accessoryModalMode],
    queryFn: () =>
      accessoriesApi.list({
        search: accessorySearch,
        per_page: accessoryModalMode !== 'all' ? 200 : 50,
        include_active_count: '1',
        from: pickupDate,
        to: returnDate,
        ...(accessoryCategoryId !== 'all' ? { category_id: accessoryCategoryId } : {}),
        ...(isEditMode && orderId ? { exclude_order_id: orderId } : {}),
      }),
    enabled: !!addAccessoryForLineId && !!pickupDate && !!returnDate,
  });

  const needsAccessoryCategoryLabels = useMemo(
    () =>
      (lines || []).some(
        (l) =>
          l.line_kind === 'standalone_accessory' ||
          (l.accessories || []).some((a) => a.selected)
      ),
    [lines]
  );

  const reconcileProductIds = useMemo(() => {
    if (!editingReconcileOrder) return '';
    const ids = new Set();
    for (const line of lines || []) {
      if (line.line_kind === 'standalone_accessory' || !line.product_id) continue;
      ids.add(String(line.product_id));
    }
    return [...ids].sort().join(',');
  }, [editingReconcileOrder, lines]);

  const reconcileSoldCheckQuery = useQuery({
    queryKey: ['reconcile-sold-check', orderId, reconcileProductIds],
    queryFn: () => validateReconcileProductLines(lines),
    enabled: editingReconcileOrder && reconcileProductIds.length > 0,
  });

  const reconcileSoldBlocked = reconcileSoldCheckQuery.data?.blocked || [];

  const accessoryCategoryCountsQuery = useQuery({
    queryKey: ['accessories', 'category-counts', 'booking-modal'],
    queryFn: () => accessoriesApi.categoryCounts().then((r) => r.data),
    enabled: !!addAccessoryForLineId || needsAccessoryCategoryLabels,
  });

  const paymentAccountsQuery = useQuery({
    queryKey: queryKeys.paymentAccounts.all,
    queryFn: () => paymentAccountsApi.list(),
  });

  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'booking'],
    queryFn: () => securityAccountsApi.list(),
  });

  const timeSlotsQuery = useQuery({
    queryKey: ['time-slots'],
    queryFn: () => timeSlotsApi.list(),
  });

  const shopUsersQuery = useQuery({
    queryKey: queryKeys.users.dropdown,
    queryFn: () => usersApi.list({ per_page: 200, is_active: 'true' }),
    staleTime: 60_000,
  });
  const salesmanOptions = useMemo(() => {
    const extras = [];
    for (const item of editOrderQuery.data?.items || []) {
      if (item.sales_person_id) {
        extras.push({
          id: item.sales_person_id,
          label: String(item.sales_person_name || '').trim() || undefined,
        });
      }
    }
    for (const line of lines) {
      if (line.line_kind === 'standalone_accessory') continue;
      if (line.sales_person_id) {
        extras.push({
          id: line.sales_person_id,
          label: String(line.sales_person_name || '').trim() || undefined,
        });
      }
    }
    return buildSalesmanSelectOptions(
      shopUsersQuery.data?.data || [],
      currentUser,
      extras
    );
  }, [shopUsersQuery.data, currentUser, editOrderQuery.data?.items, lines]);
  const salesmanLabelById = useMemo(() => {
    const map = new Map();
    for (const o of salesmanOptions) map.set(String(o.value), o.label);
    return map;
  }, [salesmanOptions]);
  const defaultBookingTimes = useMemo(
    () => resolveTimeSlotDefaults(timeSlotsQuery.data),
    [timeSlotsQuery.data]
  );
  const defaultTimesAppliedRef = useRef(false);
  const timeSelectOptions = useMemo(() => {
    const rows = timeSlotsQuery.data?.data || [];
    return rows.length ? timeSlotsToSelectOptions(rows) : FALLBACK_TIME_OPTIONS;
  }, [timeSlotsQuery.data?.data]);

  const productMatches = useMemo(() => {
    const avail = productAvailabilityQuery?.data?.data || [];
    const fallback = productSearchFallbackQuery?.data?.data || [];
    const map = new Map();
    avail.forEach((p) => {
      map.set(p.id, p);
    });
    fallback.forEach((p) => {
      if (!map.has(p.id)) {
        map.set(p.id, {
          ...p,
          total_qty: Number(p.qty || 0),
          free_qty: Number(p.qty || 0),
          booked_qty: 0,
          in_delivery_qty: 0,
          return_pending_qty: 0,
          washing_qty: p.status === 'washing' ? Number(p.qty || 0) : 0,
          repair_qty: p.status === 'repair' ? Number(p.qty || 0) : 0,
          next_available_date: null,
          gap_days: Number(p.gap_days || 0),
          can_book: true,
        });
      }
    });
    return Array.from(map.values());
  }, [productAvailabilityQuery?.data?.data, productSearchFallbackQuery?.data?.data]);
  const addedProductIds = useMemo(
    () =>
      new Set(
        lines
          .filter((line) => line.line_kind !== 'standalone_accessory' && line.product_id)
          .map((line) => String(line.product_id))
      ),
    [lines]
  );
  const selectableProductMatches = useMemo(
    () => productMatches.filter((p) => !addedProductIds.has(String(p.id))),
    [productMatches, addedProductIds]
  );

  const activeAccessoryLine = useMemo(() => {
    if (!addAccessoryForLineId || addAccessoryForLineId === ACCESSORY_ONLY_MODAL_LINE_ID) return null;
    return lines.find((line) => line.line_id === addAccessoryForLineId) || null;
  }, [lines, addAccessoryForLineId]);

  /** Live catalog availability (same source as Extra Accessories list). */
  const catalogListAvailabilityById = useMemo(() => {
    const map = new Map();
    for (const a of accessorySearchQuery.data?.data || []) {
      map.set(String(a.id), a);
    }
    return map;
  }, [accessorySearchQuery.data]);

  const recommendedAccessoriesForDisplay = useMemo(
    () =>
      (activeAccessoryLine?.accessories || []).map((a) => {
        const listRow = catalogListAvailabilityById.get(String(a.accessory_id || ''));
        if (listRow) return overlayAccessoryCatalogAvailability(a, listRow);
        return a;
      }),
    [activeAccessoryLine, catalogListAvailabilityById]
  );

  const recommendedAvailabilityLoading =
    accessoryModalMode !== 'all' &&
    !!addAccessoryForLineId &&
    (accessorySearchQuery.isLoading || accessorySearchQuery.isFetching);

  const lastSyncedListAvailabilityRef = useRef('');

  useEffect(() => {
    if (
      !addAccessoryForLineId ||
      addAccessoryForLineId === ACCESSORY_ONLY_MODAL_LINE_ID ||
      accessoryModalMode === 'all' ||
      !accessorySearchQuery.data?.data?.length
    ) {
      return;
    }
    const syncKey = `${addAccessoryForLineId}:${accessorySearchQuery.dataUpdatedAt}`;
    if (lastSyncedListAvailabilityRef.current === syncKey) return;
    lastSyncedListAvailabilityRef.current = syncKey;
    setLines((prev) =>
      prev.map((line) => {
        if (line.line_id !== addAccessoryForLineId) return line;
        return {
          ...line,
          accessories: (line.accessories || []).map((a) => {
            const listRow = catalogListAvailabilityById.get(String(a.accessory_id || ''));
            return listRow ? overlayAccessoryCatalogAvailability(a, listRow) : a;
          }),
        };
      })
    );
  }, [
    addAccessoryForLineId,
    accessoryModalMode,
    accessorySearchQuery.data,
    accessorySearchQuery.dataUpdatedAt,
    catalogListAvailabilityById,
  ]);

  useEffect(() => {
    if (!addAccessoryForLineId) {
      recommendedAccessoryInitKeyRef.current = '';
      lastSyncedListAvailabilityRef.current = '';
      setPendingAccessoryPicks({});
      setPendingRecommendedSelections({});
      setAccessoryModalRemarks('');
      return;
    }
    setPendingAccessoryPicks({});
    recommendedAccessoryInitKeyRef.current = '';
  }, [addAccessoryForLineId]);

  useEffect(() => {
    if (!addAccessoryForLineId || addAccessoryForLineId === ACCESSORY_ONLY_MODAL_LINE_ID) return;
    if (!activeAccessoryLine) return;
    if (recommendedAccessoriesForDisplay.length === 0) return;
    const availSig = recommendedAccessoriesForDisplay
      .map((a) => `${a.line_id}:${a.free_qty}:${a.booked_qty}`)
      .join(',');
    const initKey = `${addAccessoryForLineId}:${recommendedAccessoriesForDisplay.map((a) => `${a.line_id}:${a.selected}`).join(',')}:${availSig}`;
    if (recommendedAccessoryInitKeyRef.current === initKey) return;
    recommendedAccessoryInitKeyRef.current = initKey;
    const init = {};
    const clearedLineIds = new Set();
    for (const a of recommendedAccessoriesForDisplay) {
      const pickType = resolveAccessoryPickerType(a, a.type);
      const selected = !!a.selected;
      const outOfStock = isAccessoryPickerOutOfStock(a, {
        type: pickType,
        grandfatherSelected: canGrandfatherAccessorySelection(a, { isEditMode }),
      });
      if (selected && outOfStock) {
        init[a.line_id] = false;
        clearedLineIds.add(a.line_id);
      } else {
        init[a.line_id] = selected;
      }
    }
    setPendingRecommendedSelections(init);
    if (clearedLineIds.size > 0) {
      setLines((prev) =>
        prev.map((line) => {
          if (line.line_id !== addAccessoryForLineId) return line;
          return {
            ...line,
            accessories: (line.accessories || []).map((a) =>
              clearedLineIds.has(a.line_id) ? deselectAccessoryRow(a) : a
            ),
          };
        })
      );
    }
  }, [addAccessoryForLineId, activeAccessoryLine, recommendedAccessoriesForDisplay, isEditMode]);

  const isAccessoryAlreadyOnBooking = (accessoryId) => {
    const id = String(accessoryId || '');
    if (!id) return false;
    if (accessoryModalMode === 'all') {
      return lines.some(
        (ln) => ln.line_kind === 'standalone_accessory' && String(ln.accessory_id || '') === id
      );
    }
    if (!activeAccessoryLine) return false;
    return (activeAccessoryLine.accessories || []).some(
      (acc) => String(acc.accessory_id || '') === id && !!acc.selected
    );
  };

  const pendingAccessoryPickCount = useMemo(
    () => Object.keys(pendingAccessoryPicks).length,
    [pendingAccessoryPicks]
  );

  const pendingRecommendedSelectedCount = useMemo(
    () => Object.values(pendingRecommendedSelections).filter(Boolean).length,
    [pendingRecommendedSelections]
  );

  const recommendedAccessories = useMemo(
    () => activeAccessoryLine?.accessories || [],
    [activeAccessoryLine]
  );
  const recommendedAccessoryGroups = useMemo(() => {
    const fallbackById = new Map(
      (accessoryCategoryCountsQuery.data?.by_category || []).map((c) => [String(c.id), c.label])
    );
    const map = new Map();
    for (const a of recommendedAccessoriesForDisplay) {
      const key = String(a?.category_id ?? '').trim();
      if (!key) continue; // Only grouped categories are shown here.
      const label =
        String(a?.category_name || '').trim() ||
        String(fallbackById.get(key) || '').trim() ||
        `Category ${key}`;
      if (!map.has(key)) {
        map.set(key, { key, label, items: [], displayOrder: null });
      }
      const group = map.get(key);
      group.items.push(a);
      const order =
        a?.category_display_order !== undefined && a?.category_display_order !== null
          ? Number(a.category_display_order || 0)
          : null;
      if (order !== null && Number.isFinite(order)) {
        if (group.displayOrder === null || order < group.displayOrder) {
          group.displayOrder = order;
        }
      }
    }
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        items: sortAccessoriesByDisplayOrder(group.items),
      }))
      .sort((a, b) => {
        const ao = a.displayOrder;
        const bo = b.displayOrder;
        if (ao !== null && bo !== null && ao !== bo) return ao - bo;
        if (ao !== null && bo === null) return -1;
        if (ao === null && bo !== null) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [recommendedAccessoriesForDisplay, accessoryCategoryCountsQuery.data?.by_category]);

  const accessoryCategoryLabelById = useMemo(() => {
    const rows = accessoryCategoryCountsQuery.data?.by_category || [];
    return new Map(rows.map((c) => [String(c.id), c.label]));
  }, [accessoryCategoryCountsQuery.data?.by_category]);

  const pendingModalSaveCount = useMemo(
    () => pendingAccessoryPickCount + pendingRecommendedSelectedCount,
    [pendingAccessoryPickCount, pendingRecommendedSelectedCount]
  );

  const displayLines = useMemo(() => sortLinesForBookingTable(lines), [lines]);
  const showLineReorder = displayLines.length > 1;
  const bookingTableColSpan =
    (gstEnabled ? 11 : 10) - (displaySalesman ? 0 : 1) + (showLineReorder ? 2 : 0);

  const [dragTarget, setDragTarget] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const clearTableDrag = useCallback(() => {
    setDragTarget(null);
    setDropTarget(null);
  }, []);

  const handleLineDragDrop = useCallback((dragId, dropId) => {
    setLines((prev) => {
      const result = reorderBookingLines(prev, dragId, dropId);
      if (!result.ok) {
        if (result.reason === 'section_mismatch') {
          toast.info('Reorder within the same section only (rent or sale).');
        }
        return prev;
      }
      return result.lines;
    });
  }, []);

  const handleAccessoryDragDrop = (dragAccId, target) => {
    setLines((prev) => {
      const result = moveLinkedAccessory(prev, dragAccId, target, {
        validateMergeQty: ({ lines: draft, mergedAccessory, mergedQty, omitAccessoryLineId }) => {
          if (isSellAccessoryLine(mergedAccessory)) {
            const available = getSellAccessoryAvailable(mergedAccessory, draft, { omitAccessoryLineId });
            return withStockValidation(mergedQty, available, mergedAccessory.name_snapshot, mergedAccessory) >= 1;
          }
          if (isRentAccessoryLine(mergedAccessory)) {
            const available = getRentAccessoryAvailable(mergedAccessory, draft, { omitAccessoryLineId });
            return withStockValidation(mergedQty, available, mergedAccessory.name_snapshot, mergedAccessory) >= 1;
          }
          return true;
        },
      });
      if (!result.ok) {
        if (result.reason === 'bucket_mismatch') {
          toast.info('Reorder accessories within the same type only (rent or sell).');
        } else if (result.reason === 'invalid_target') {
          toast.info('Drop on a product or accessory row.');
        }
        return prev;
      }
      return result.lines;
    });
  };

  const showSaleSectionDivider = useMemo(() => {
    let hasRent = false;
    let hasSale = false;
    for (const line of displayLines) {
      if (line.line_kind === 'standalone_accessory') {
        if (String(line.type || 'rent') === 'sell') hasSale = true;
        else hasRent = true;
      } else if (productLineIsSaleOnly(line)) {
        hasSale = true;
      } else {
        hasRent = true;
      }
      if (hasRent && hasSale) return true;
    }
    return false;
  }, [displayLines]);

  /** Distinct non-empty accessory remark texts only (no per-product breakdown). */
  const accessoryNotesPreview = useMemo(() => {
    const ordered = [];
    const seen = new Set();
    for (const line of lines) {
      if (line.line_kind === 'standalone_accessory') {
        const r = String(line.remarks || '').trim();
        if (r && !seen.has(r)) {
          seen.add(r);
          ordered.push(r);
        }
        continue;
      }
      for (const a of line.accessories || []) {
        if (!a.selected) continue;
        const r = String(a.remarks || '').trim();
        if (!r || seen.has(r)) continue;
        seen.add(r);
        ordered.push(r);
      }
    }
    return ordered;
  }, [lines]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let itemDiscount = 0;
    let tax = 0;
    for (const line of lines) {
      const qty = Number(line.qty || 1);
      const gross = toNonNegativeAmount(line.price) * qty;
      const disc = toNonNegativeAmount(line.discount) * qty;
      const taxable = Math.max(0, gross - disc);
      subtotal += gross;
      itemDiscount += disc;
      if (gstEnabled) {
        const rate = Number(line.gst_percent || 0) / 100;
        tax += taxMode === 'inclusive' ? taxable - taxable / (1 + rate) : taxable * rate;
      }
      for (const a of line.accessories || []) {
        if (!a.selected) continue;
        const aqty = Number(a.qty || 1);
        const agross = toNonNegativeAmount(a.price) * aqty;
        const adisc = toNonNegativeAmount(a.discount) * aqty;
        const ataxable = Math.max(0, agross - adisc);
        subtotal += agross;
        itemDiscount += adisc;
        if (gstEnabled) {
          const rate = Number(a.gst_percent || 0) / 100;
          tax += taxMode === 'inclusive' ? ataxable - ataxable / (1 + rate) : ataxable * rate;
        }
      }
    }
    const bookingDiscountRaw =
      bookingDiscountType === 'percent'
        ? (Math.max(0, subtotal - itemDiscount) * Number(bookingDiscountValue || 0)) / 100
        : toNonNegativeAmount(bookingDiscountValue);
    const bookingDiscount = round2(Math.max(0, bookingDiscountRaw));
    const taxableAmount = round2(Math.max(0, subtotal - itemDiscount - bookingDiscount));
    const taxTotal = round2(tax);
    const subAfterTaxMode = taxMode === 'inclusive' ? taxableAmount : taxableAmount + taxTotal;
    return {
      subtotal: round2(subtotal),
      item_discount: round2(itemDiscount),
      booking_discount: bookingDiscount,
      discount: round2(itemDiscount + bookingDiscount),
      taxable: taxableAmount,
      tax_total: taxTotal,
      cgst: igstBill || !gstEnabled ? 0 : round2(taxTotal / 2),
      sgst: igstBill || !gstEnabled ? 0 : round2(taxTotal / 2),
      igst: igstBill && gstEnabled ? taxTotal : 0,
      round_off: round2(Math.round(subAfterTaxMode) - subAfterTaxMode),
      grand_total: round2(Math.round(subAfterTaxMode)),
      total: round2(subAfterTaxMode),
    };
  }, [lines, gstEnabled, taxMode, igstBill, bookingDiscountType, bookingDiscountValue]);

  const maxRentGapDays = useMemo(() => {
    let m = 0;
    for (const line of lines) {
      if (line.line_kind === 'standalone_accessory') continue;
      if (String(line.type || 'rent').toLowerCase() === 'sell') continue;
      m = Math.max(m, Number(line.gap_days || 0));
    }
    return m;
  }, [lines]);

  const pickupBeforeNextAvailable = useMemo(() => {
    const out = [];
    for (const line of lines) {
      if (line.line_kind === 'standalone_accessory') continue;
      if (String(line.type || 'rent').toLowerCase() === 'sell') continue;
      const na = line.next_available_date;
      if (!na) continue;
      if (pickupDate < na) {
        out.push({ name: line.name_snapshot, next: na, gap: Number(line.gap_days || 0) });
      }
    }
    return out;
  }, [lines, pickupDate]);

  const deliveryMax = useMemo(
    () => (maxFutureBookingDays > 0 ? addDaysISO(todayISO, maxFutureBookingDays) : undefined),
    [maxFutureBookingDays]
  );

  const returnMax = useMemo(
    () =>
      pickupDate && maxReturnDays > 0 ? addDaysISO(pickupDate, maxReturnDays) : undefined,
    [pickupDate, maxReturnDays]
  );

  /** Cash collected at booking: advance + security when “Paid Security Amt.” is checked (matches payment rows on submit). */
  const paidAtBooking = useMemo(() => {
    const adv = Number(advanceAmount) || 0;
    const sec = paidSecurityAmt ? toNonNegativeAmount(deposit) : 0;
    return round2(adv + sec);
  }, [advanceAmount, paidSecurityAmt, deposit]);

  const customerPhone1 = normalizePhone(contactNo1);
  const effectiveContactNo2 = contactNo2SameAsPhone1 ? customerPhone1 : contactNo2;

  const creditLookupPhones = useMemo(() => {
    const p2 = contactNo2SameAsPhone1 ? customerPhone1 : normalizePhone(contactNo2);
    return collectIndianPhones(customerPhone1, p2);
  }, [customerPhone1, contactNo2, contactNo2SameAsPhone1]);

  const creditLookupPhone1 = creditLookupPhones[0] || '';
  const creditLookupPhone2 = creditLookupPhones[1] || '';

  useEffect(() => {
    setApplyCustomerCredit(false);
    setApplyCreditAmount('');
  }, [creditLookupPhone1, creditLookupPhone2]);

  const customerCreditQuery = useQuery({
    queryKey: ['credit-notes', 'balance-by-phones', creditLookupPhone1, creditLookupPhone2],
    queryFn: () =>
      creditNotesApi
        .balanceByPhones({
          phone1: creditLookupPhone1 || undefined,
          phone2: creditLookupPhone2 || undefined,
        })
        .then((r) => r.data),
    enabled: Boolean(!isEditMode && creditLookupPhones.length > 0),
  });

  const customerOpenCredit = round2(Number(customerCreditQuery.data?.open_balance || 0));
  const customerCreditNotes = useMemo(() => {
    const notes = customerCreditQuery.data?.notes;
    return Array.isArray(notes) ? notes : [];
  }, [customerCreditQuery.data?.notes]);
  const matchedCreditCustomers = useMemo(() => {
    const rows = customerCreditQuery.data?.matched_customers;
    return Array.isArray(rows) ? rows : [];
  }, [customerCreditQuery.data?.matched_customers]);
  const otherCustomersWithSamePhone = useMemo(() => {
    const currentId = customer?.id ? String(customer.id) : '';
    return matchedCreditCustomers.filter((c) => String(c.id) !== currentId);
  }, [matchedCreditCustomers, customer?.id]);
  const matchedCustomersWithCredit = useMemo(
    () => matchedCreditCustomers.filter((c) => round2(Number(c.open_balance || 0)) > 0),
    [matchedCreditCustomers]
  );
  const applyCreditNum = applyCustomerCredit ? toNonNegativeAmount(applyCreditAmount) : 0;

  const editOrderPaidAmount = round2(Number(editOrderQuery.data?.paid_amount || 0));

  const paidTowardBill = useMemo(() => {
    if (isEditMode) {
      const advanceDelta = round2(
        toNonNegativeAmount(advanceAmount) - Number(initialEditAdvanceNetRef.current || 0)
      );
      return round2(Math.max(0, editOrderPaidAmount + advanceDelta));
    }
    return round2(toNonNegativeAmount(advanceAmount) + applyCreditNum);
  }, [isEditMode, editOrderPaidAmount, advanceAmount, applyCreditNum]);

  const remainingBalance = useMemo(
    () => round2(Math.max(0, totals.grand_total - paidTowardBill)),
    [totals.grand_total, paidTowardBill]
  );

  const editDepositNet = useMemo(() => {
    if (!isEditMode) return 0;
    const payments = editOrderQuery.data?.payments;
    return round2(
      editOrderQuery.data?.ordinary_security_net ?? Math.max(
        0,
        sumPaymentsByCategory(payments, 'deposit') -
          sumPaymentsByCategory(payments, 'deposit_refund')
      )
    );
  }, [isEditMode, editOrderQuery.data?.payments, editOrderQuery.data?.ordinary_security_net]);
  const resolvedWhatsapp = resolveWhatsappValue({
    whatsappSource,
    whatsappManual,
    phone1: customerPhone1,
    phone2: effectiveContactNo2,
  });
  const customerName = String(customer?.name || '').trim();
  const missingCustomerName = !!customer?.id && !customerName;

  /** Prefer draft snapshot contact fields over stale API customer record on resume. */
  const applyCustomerFromApiWithSnapshot = useCallback((full, snap) => {
    if (!full) return;
    setCustomer(full);
    const q = String(snap?.customerQuery ?? '').trim();
    setCustomerQuery(q || full.name || '');
    const hydrated = hydrateBookingCustomerFields(full, null);
    const snapPhone1 = String(snap?.contactNo1 ?? snap?.contact_no1 ?? '').trim();
    setContactNo1(snapPhone1 ? normalizePhone(snapPhone1) : hydrated.contactNo1);
    const snapC2Name = String(snap?.contact2Name ?? snap?.contact2_name ?? '').trim();
    setContact2Name(snapC2Name || hydrated.contact2Name);
    const snapPhone2 = String(snap?.contactNo2 ?? snap?.contact_no2 ?? '').trim();
    setContactNo2(snapPhone2 || hydrated.contactNo2);
    const snapSame = !!(snap?.contactNo2SameAsPhone1 ?? snap?.contact_no2_same_as_phone1);
    setContactNo2SameAsPhone1(snapSame || hydrated.contactNo2SameAsPhone1);
    setEditingCustomerName(!String(full.name || '').trim());
    const snapWaSrc = snap?.whatsappSource ?? snap?.whatsapp_source;
    if (snapWaSrc === 'phone2' || snapWaSrc === 'manual') {
      setWhatsappSource(snapWaSrc);
    } else {
      setWhatsappSource(hydrated.whatsappSource);
    }
    const snapWaManual = String(snap?.whatsappManual ?? snap?.whatsapp_manual ?? '').trim();
    setWhatsappManual(
      snapWaManual ? phoneInputDigits(snapWaManual) : hydrated.whatsappManual
    );
    const snapAddr = String(snap?.address ?? '').trim();
    setAddress(snapAddr || hydrated.address);
  }, []);

  useEffect(() => {
    if (!contactNo2SameAsPhone1) return;
    setContact2Name(customerName.slice(0, 60));
  }, [contactNo2SameAsPhone1, customerName]);

  useEffect(() => {
    if (initializingEdit) return undefined;
    const id = customer?.id;
    if (!id) return undefined;
    if (whatsappSource !== 'phone1' && whatsappSource !== 'phone2') return undefined;
    if (!isIndianPhone(resolvedWhatsapp)) return undefined;

    const detailRow = customerDetailQuery?.data?.data || customer;
    const storedWa = String(detailRow?.whatsapp || '').trim();
    if (storedWa) return undefined;

    const t = window.setTimeout(async () => {
      try {
        await customersApi.update(id, { whatsapp: resolvedWhatsapp });
        queryClient.invalidateQueries({ queryKey: ['customer', id] });
      } catch {
        /* booking submit will sync again */
      }
    }, 500);

    return () => window.clearTimeout(t);
  }, [
    customer?.id,
    customerDetailQuery?.data?.data,
    whatsappSource,
    resolvedWhatsapp,
    initializingEdit,
    queryClient,
  ]);

  const buildBookingDraftSnapshot = useCallback(() => {
    return {
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            phone1: customerPhone1,
            phone2: customer.phone2,
            phone2_name: String(contact2Name || '').trim() || customer.phone2_name || null,
            address: customer.address,
          }
        : null,
      customerQuery,
      lines: JSON.parse(JSON.stringify(lines || [])),
      bookingDateTime,
      pickupDate,
      returnDate,
      pickupTime,
      returnTime,
      deposit,
      paidSecurityAmt,
      advanceAmount,
      contactNo1,
      contact2Name,
      contactNo2,
      contactNo2SameAsPhone1,
      whatsappSource,
      whatsappManual,
      address,
      igstBill,
      gstEnabled,
      taxMode,
      referenceName,
      nextBookingGapDaysInput,
      previousBookingGapDaysInput,
      customerNotes,
      bookingDiscountType,
      bookingDiscountValue,
      advanceAccountId,
      securityAccountId,
      quickBillDraftIds,
      manualAccessoryDraft,
    };
  }, [
    customer,
    customerQuery,
    lines,
    bookingDateTime,
    pickupDate,
    returnDate,
    pickupTime,
    returnTime,
    deposit,
    paidSecurityAmt,
    advanceAmount,
    contactNo1,
    contact2Name,
    contactNo2,
    contactNo2SameAsPhone1,
    whatsappSource,
    whatsappManual,
    address,
    igstBill,
    gstEnabled,
    taxMode,
    referenceName,
    nextBookingGapDaysInput,
    previousBookingGapDaysInput,
    customerNotes,
    bookingDiscountType,
    bookingDiscountValue,
    advanceAccountId,
    securityAccountId,
    quickBillDraftIds,
    manualAccessoryDraft,
    customerPhone1,
    contact2Name,
  ]);

  const applyBookingDraftSnapshot = useCallback((snap) => {
    if (!snap || typeof snap !== 'object') return;
    const c = snap.customer;
    if (c && c.id) {
      setCustomer({
        id: c.id,
        name: c.name || '',
        phone1: c.phone1 || '',
        phone2: c.phone2 || '',
        phone2_name: c.phone2_name || null,
        address: c.address || '',
      });
      setEditingCustomerName(!String(c.name || '').trim());
    } else {
      setCustomer(null);
      setEditingCustomerName(false);
      setContactNo1('');
      setContact2Name('');
    }
    setCustomerQuery(String(snap.customerQuery ?? ''));
    setLines(
      normalizeBookingLinesFromDraft(
        Array.isArray(snap.lines) ? JSON.parse(JSON.stringify(snap.lines)) : []
      )
    );
    if (snap.bookingDateTime || snap.booking_datetime) {
      setBookingDateTime(String(snap.bookingDateTime || snap.booking_datetime));
    } else {
      const legacyDate = String(snap.bookingDate || snap.booking_date || todayISO).slice(0, 10);
      const legacyTime = snap.bookingTime || snap.booking_time || null;
      if (legacyTime) {
        setBookingDateTime(toDatetimeLocalValue(legacyDate, legacyTime) || nowDatetimeLocal());
      } else {
        const { time: currentTime } = splitDatetimeLocal(nowDatetimeLocal());
        setBookingDateTime(toDatetimeLocalValue(legacyDate, currentTime) || nowDatetimeLocal());
      }
    }
    setPickupDate(String(snap.pickupDate || snap.pickup_date || todayISO).slice(0, 10));
    setReturnDate(
      String(snap.returnDate || snap.return_date || addDaysISO(todayISO, returnOffsetDays)).slice(0, 10)
    );
    setPickupTime(
      snap.pickupTime || snap.pickup_time || snap.delivery_time || defaultBookingTimes.delivery
    );
    setReturnTime(snap.returnTime || snap.return_time || defaultBookingTimes.return);
    setDeposit(toNonNegativeAmount(snap.deposit ?? 0));
    setPaidSecurityAmt(!!(snap.paidSecurityAmt ?? snap.paid_security_amt));
    setAdvanceAmount(toNonNegativeAmount(snap.advanceAmount ?? snap.advance_amount ?? 0));
    setContactNo1(String(snap.contactNo1 ?? snap.contact_no1 ?? c?.phone1 ?? ''));
    setContact2Name(
      String(snap.contact2Name ?? snap.contact2_name ?? c?.phone2_name ?? '').slice(0, 60)
    );
    setContactNo2(String(snap.contactNo2 ?? snap.contact_no2 ?? ''));
    setContactNo2SameAsPhone1(!!(snap.contactNo2SameAsPhone1 ?? snap.contact_no2_same_as_phone1));
    setWhatsappSource(
      snap.whatsappSource === 'phone2' || snap.whatsappSource === 'manual'
        ? snap.whatsappSource
        : snap.whatsapp_source === 'phone2' || snap.whatsapp_source === 'manual'
          ? snap.whatsapp_source
          : 'phone1'
    );
    setWhatsappManual(String(snap.whatsappManual ?? snap.whatsapp_manual ?? ''));
    setAddress(String(snap.address ?? ''));
    setIgstBill(!!(snap.igstBill ?? snap.igst_bill));
    setGstEnabled((snap.gstEnabled ?? snap.gst_enabled) !== false);
    setTaxMode((snap.taxMode || snap.tax_mode) === 'inclusive' ? 'inclusive' : 'exclusive');
    setReferenceName(String(snap.referenceName ?? snap.reference_name ?? ''));
    const gapRaw = snap.nextBookingGapDaysInput ?? snap.next_booking_gap_days;
    setNextBookingGapDaysInput(
      gapRaw !== undefined && gapRaw !== null && gapRaw !== '' ? String(gapRaw) : ''
    );
    const prevGapRaw = snap.previousBookingGapDaysInput ?? snap.previous_booking_gap_days;
    setPreviousBookingGapDaysInput(
      prevGapRaw !== undefined && prevGapRaw !== null && prevGapRaw !== '' ? String(prevGapRaw) : ''
    );
    setCustomerNotes(String(snap.customerNotes ?? snap.customer_notes ?? ''));
    setBookingDiscountType(
      (snap.bookingDiscountType || snap.booking_discount_type) === 'percent' ? 'percent' : 'flat'
    );
    setBookingDiscountValue(
      toNonNegativeAmount(snap.bookingDiscountValue ?? snap.booking_discount_value ?? 0)
    );
    setAdvanceAccountId(String(snap.advanceAccountId ?? snap.advance_account_id ?? ''));
    setSecurityAccountId(String(snap.securityAccountId ?? snap.security_account_id ?? ''));
    setQuickBillDraftIds(
      Array.isArray(snap.quickBillDraftIds)
        ? snap.quickBillDraftIds.filter(Boolean)
        : Array.isArray(snap.quick_bill_draft_ids)
          ? snap.quick_bill_draft_ids.filter(Boolean)
          : []
    );
    const mad = snap.manualAccessoryDraft || snap.manual_accessory_draft;
    setManualAccessoryDraft(mad && typeof mad === 'object' ? { ...mad } : {});
    setProductQuery('');
    setSelectedProduct(null);
    setProductOpen(false);
    setAddAccessoryForLineId('');
    setAccessoryModalMode('recommended');
    setAccessoryCategoryId('all');
    setOpenRecommendedCategoryKey('');
    setRecommendedCategorySearch({});
    setAccessorySearch('');
  }, [defaultBookingTimes.delivery, defaultBookingTimes.return, returnOffsetDays]);

  const getBlankBookingSnapshot = useCallback(
    () => ({
      customer: null,
      customerQuery: '',
      lines: [],
      bookingDateTime: nowDatetimeLocal(),
      pickupDate: todayISO,
      returnDate: addDaysISO(todayISO, returnOffsetDays),
      pickupTime: defaultBookingTimes.delivery,
      returnTime: defaultBookingTimes.return,
      deposit: 0,
      paidSecurityAmt: false,
      advanceAmount: 0,
      contactNo1: '',
      contact2Name: '',
      contactNo2: '',
      contactNo2SameAsPhone1: false,
      whatsappSource: 'phone1',
      whatsappManual: '',
      address: '',
      igstBill: false,
      gstEnabled: true,
      taxMode: 'exclusive',
      referenceName: '',
      nextBookingGapDaysInput: '',
      previousBookingGapDaysInput: '',
      customerNotes: '',
      bookingDiscountType: 'flat',
      bookingDiscountValue: 0,
      advanceAccountId: '',
      securityAccountId: '',
      quickBillDraftIds: [],
      manualAccessoryDraft: {},
    }),
    [defaultBookingTimes.delivery, defaultBookingTimes.return, returnOffsetDays]
  );

  const flushBookingDraftToStorage = useCallback(() => {
    if (skipDraftPersistRef.current) return false;
    const snap = buildBookingDraftSnapshot();
    if (isSnapshotTriviallyEmpty(snap)) {
      if (bookingDraftIdRef.current && !justStartedBlankDraftRef.current) {
        removeBookingDraft(bookingDraftIdRef.current);
        setBookingDraftId(null);
        persistActiveDraftStorageKey(null);
        bookingDraftIdRef.current = null;
      }
      return false;
    }
    let id = bookingDraftIdRef.current;
    if (!id) {
      id = createLocalId();
      bookingDraftIdRef.current = id;
      setBookingDraftId(id);
      persistActiveDraftStorageKey(id);
    }
    upsertBookingDraft({ id, title: draftLabelFromSnapshot(snap), snapshot: snap });
    setLastDraftSavedAt(Date.now());
    return true;
  }, [buildBookingDraftSnapshot]);

  const handleStartNewBookingDraft = useCallback(() => {
    flushBookingDraftToStorage();
    const newId = createLocalId();
    skipDraftPersistRef.current = true;
    justStartedBlankDraftRef.current = true;
    bookingDraftIdRef.current = newId;
    setBookingDraftId(newId);
    persistActiveDraftStorageKey(newId);
    applyBookingDraftSnapshot(getBlankBookingSnapshot());
    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
      justStartedBlankDraftRef.current = false;
    }, 1200);
    toast.success('New draft started. The previous one is kept under Drafts.');
  }, [applyBookingDraftSnapshot, flushBookingDraftToStorage, getBlankBookingSnapshot]);

  const handleResumeDraft = useCallback(
    (row) => {
      if (!row?.id) return;
      flushBookingDraftToStorage();
      skipDraftPersistRef.current = true;
      const fromList = readDraftList().find((x) => x.id === row.id);
      if (!fromList?.snapshot) {
        skipDraftPersistRef.current = false;
        toast.error('Draft not found');
        return;
      }
      bookingDraftIdRef.current = row.id;
      setBookingDraftId(row.id);
      persistActiveDraftStorageKey(row.id);
      applyBookingDraftSnapshot(fromList.snapshot);
      if (fromList.snapshot?.customer?.id) {
        const snap = fromList.snapshot;
        customersApi
          .get(snap.customer.id)
          .then((resp) => {
            applyCustomerFromApiWithSnapshot(resp?.data || null, snap);
          })
          .catch(() => {
            /* keep snapshot */
          });
      }
      window.setTimeout(() => {
        skipDraftPersistRef.current = false;
      }, 600);
      toast.success('Draft loaded');
    },
    [applyBookingDraftSnapshot, applyCustomerFromApiWithSnapshot, flushBookingDraftToStorage]
  );

  const handleDeleteStoredDraft = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      removeBookingDraft(sid);
      if (bookingDraftIdRef.current === sid) {
        skipDraftPersistRef.current = true;
        bookingDraftIdRef.current = null;
        setBookingDraftId(null);
        persistActiveDraftStorageKey(null);
        applyBookingDraftSnapshot(getBlankBookingSnapshot());
        window.setTimeout(() => {
          skipDraftPersistRef.current = false;
        }, 600);
      }
      toast.success('Draft removed');
    },
    [applyBookingDraftSnapshot, getBlankBookingSnapshot]
  );

  const releaseSubmitLock = useCallback(() => {
    submitLockRef.current = false;
    setIsSubmitting(false);
  }, []);

  const handleCancelBooking = useCallback(() => {
    releaseSubmitLock();
    setCustomerOpen(false);
    setProductOpen(false);
    navigate('/booking', { replace: true });
  }, [navigate, releaseSubmitLock]);

  const saveMutation = useMutation({
    mutationFn: async (body) => {
      if (!isEditMode) return ordersApi.create(body);
      const fingerprint = JSON.stringify({ ...body, admin_password: undefined });
      if (editCommandRef.current?.fingerprint !== fingerprint) {
        editCommandRef.current = { fingerprint, key: createQueueId() };
      }
      const result = await syncService.submitOrderEdit(orderId, {
        ...body, idempotency_key: editCommandRef.current.key,
      }, { orderNumber: editBookingNumber, requiresMasterPassword: Boolean(body.admin_password) });
      return result.queued ? { queued: true } : result.response;
    },
    onSuccess: async (resp) => {
      const waChoice = sendAfterCreateRef.current;
      sendAfterCreateRef.current = null;
      if (resp?.queued) {
        toast.info('Booking edit queued. Stock and payments are not confirmed until it syncs; review any sync conflict.');
        navigate('/booking');
        return;
      }

      if (!isEditMode && waChoice === 'send') {
        try {
          await wa.runOutbound({
            templateKey: 'CREATE_BOOKING',
            orderId: resp?.data?.id,
            order: resp?.data,
            phone: resolvedWhatsapp,
            customer,
            actionLabel: `Order ${resp?.data?.order_number || ''} created`,
            silentSkip: true,
            skipPrompt: true,
          });
        } catch {
          /* runOutbound toasts errors */
        }
      } else if (!isEditMode && waChoice === 'skip') {
        toast.info(`Order ${resp?.data?.order_number || ''} created. WhatsApp not sent.`);
      } else if (isEditMode && waChoice === 'send' && !resp?.data?.command_replayed) {
        try {
          await wa.runOutbound({
            templateKey: 'UPDATE_BOOKING',
            orderId: resp?.data?.id || orderId,
            order: resp?.data,
            phone: resolvedWhatsapp,
            customer,
            actionLabel: `Order ${resp?.data?.order_number || ''} updated`,
            silentSkip: true,
            skipPrompt: true,
          });
        } catch {
          /* runOutbound toasts errors */
        }
      } else if (isEditMode && waChoice === 'skip') {
        toast.info(`Order ${resp?.data?.order_number || ''} updated. WhatsApp not sent.`);
      }

      if (!isEditMode && saveAndPrintBooking) {
        try {
          await printBill(resp?.data);
        } catch (e) {
          toast.warning(e?.message || 'Booking saved but print failed');
        }
      }
      if (!isEditMode && quickBillDraftIds.length > 0) {
        try {
          await draftsApi.bulkDelete({ ids: quickBillDraftIds });
        } catch {
          toast.warning('Booking created, but cart cleanup failed. Please refresh cart.');
        }
      }
      if (!isEditMode) {
        try {
          sessionStorage.removeItem('wrs.quickBillDraft');
        } catch {
          /* ignore storage errors */
        }
        if (customOrderHandoffIdRef.current && resp?.data?.id) {
          try {
            await customOrdersApi.linkBooking(customOrderHandoffIdRef.current, resp.data.id);
          } catch {
            toast.warning('Booking saved but could not link custom order');
          }
          clearCustomOrderBookingHandoff();
          customOrderHandoffIdRef.current = null;
        }
        const draftId = bookingDraftIdRef.current;
        if (draftId) {
          try {
            removeBookingDraft(draftId);
          } catch {
            /* ignore */
          }
          setBookingDraftId(null);
          persistActiveDraftStorageKey(null);
        }
      }
      const oid = orderId || resp?.data?.id;
      toast.success(
        wasReconcileRef.current
          ? 'Booking reconciled'
          : isEditMode
            ? 'Booking updated'
            : `Order ${resp.data.order_number} created`
      );
      if (!isEditMode) {
        stashTokenDownloadPrompt(resp.data);
        navigate(`/booking/${resp.data.id}`, {
          state: { promptTokenDownload: true },
        });
      } else {
        navigate(`/booking/${resp.data.id}`);
      }
      void invalidateOrderDomain(queryClient, { orderId: oid });
    },
    onError: (e) =>
      toast.error(
        getApiErrorMessage(e, isEditMode ? 'Failed to update order' : 'Failed to create order')
      ),
  });

  const pickCustomer = (c, orderSnap = null) => {
    const orderContext = orderSnap ?? (isEditMode ? editOrderQuery.data : null);
    setCustomer(c);
    setEditingCustomerName(!String(c?.name || '').trim());
    setCustomerQuery(c?.name || '');
    const hydrated = hydrateBookingCustomerFields(c, orderContext);
    setAddress(hydrated.address);
    setContactNo1(hydrated.contactNo1);
    setContact2Name(hydrated.contact2Name);
    setContactNo2(hydrated.contactNo2);
    setContactNo2SameAsPhone1(hydrated.contactNo2SameAsPhone1);
    setWhatsappSource(hydrated.whatsappSource);
    setWhatsappManual(hydrated.whatsappManual);
    setCustomerOpen(false);
    clearFieldError(setFieldErrors, 'customer');
    clearFieldError(setFieldErrors, 'customerName');

    // Search results can be partial. Always hydrate latest full customer
    // details so Contact No.2 / Address stay in sync.
    if (c?.id) {
      customersApi
        .get(c.id)
        .then((resp) => {
          const full = resp?.data || null;
          if (!full) return;
          setCustomer(full);
          setCustomerQuery(full.name || '');
          const next = hydrateBookingCustomerFields(full, orderContext);
          setAddress(next.address);
          setContactNo1(next.contactNo1);
          setContact2Name(next.contact2Name);
          setContactNo2(next.contactNo2);
          setEditingCustomerName(!String(full.name || '').trim());
          setContactNo2SameAsPhone1(next.contactNo2SameAsPhone1);
          setWhatsappSource(next.whatsappSource);
          setWhatsappManual(next.whatsappManual);
        })
        .catch(() => {
          /* ignore detail fetch errors */
        });
    }
  };

  const quickCustomerCreateMutation = useMutation({
    mutationFn: (payload) => customersApi.quickAvailabilityCreate(payload),
    onSuccess: async (res) => {
      const created = res?.data || res;
      const label = String(created?.name || '').trim() || created?.phone1 || 'Customer';
      toast.success(`Created ${label}`);
      pickCustomer(created);
      await invalidateCustomersDomain(queryClient);
    },
    onError: (err) => {
      toast.error(
        err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          'Failed to create customer'
      );
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

  // `source` is the accessory row the qty came from — it carries both reserves
  // (spare and damaged) so the warning can say why the shortfall exists.
  const withStockValidation = (qty, freeQty, label, source = null) => {
    const wanted = Math.max(1, Number(qty) || 1);
    const limit = Number(freeQty || 0);
    const spare = Math.max(0, Number(source?.spare_qty) || 0);
    const damaged = Math.max(0, Number(source?.damaged_qty) || 0);
    if (limit <= 0) {
      toast.warning(formatAccessorySpareMessage(label, spare, 0, 'generic', damaged));
      return 0;
    }
    if (wanted > limit) {
      toast.warning(
        formatAccessoryQtyExceededMessage(label, wanted, limit, spare, 'rent', damaged)
      );
      return limit;
    }
    return wanted;
  };

  const fetchRecommendedAccessories = async (product, dateOverride) => {
    const from = normalizeCustomOrderSqlDate(dateOverride?.from ?? pickupDate);
    const to = normalizeCustomOrderSqlDate(dateOverride?.to ?? returnDate);
    if (!from || !to) {
      return { settings: { auto_add_enabled: true }, data: [] };
    }
    try {
      const res = await accessoriesApi.recommendations({
        product_id: product.id,
        category_id: product.category_id || '',
        from,
        to,
        ...(isEditMode && orderId ? { exclude_order_id: orderId } : {}),
      });
      const payload = res?.data;
      if (payload && Array.isArray(payload.data)) {
        return {
          settings: payload.settings || { auto_add_enabled: true },
          data: payload.data,
          source: payload.source,
        };
      }
      return { settings: { auto_add_enabled: true }, data: [] };
    } catch (err) {
      const msg =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        'Could not load recommended accessories';
      toast.warning(msg);
      return { settings: { auto_add_enabled: true }, data: [] };
    }
  };

  const toAccessoryLines = (rec) => {
    const rows = Array.isArray(rec?.data) ? rec.data : [];
    const autoAdd = rec?.settings?.auto_add_enabled !== false;
    return rows.map((a) => {
      const type = accessoryDefaultType(a);
      const catalog_price_rent = Number(a.price_rent || 0);
      const catalog_price_sell = Number(a.price_sell || 0);
      const category_id = a.category_id ?? a.accessory_category_id ?? null;
      const category_name =
        String(a.category_name || '').trim() ||
        String(a.category_label || '').trim() ||
        String(a?.category?.name || '').trim() ||
        String(accessoryCategoryLabelById.get(String(category_id || '')) || '').trim() ||
        '';
      const shouldAutoSelect = autoAdd && a.source === 'product';
      const isSell = String(type || '').toLowerCase() === 'sell';
      const sellAvail = accessoryPickerAvailableQty(a, 'sell');
      const freeQty = Number(a.free_qty || 0);
      let selected = false;
      if (shouldAutoSelect) {
        if (isSell) {
          selected = sellAvail >= 1;
          if (!selected) {
            toast.warning(`${a.name || 'Accessory'} is out of stock`);
          }
        } else {
          selected = freeQty >= 1;
          if (!selected) {
            toast.warning(`${a.name || 'Accessory'} is not available for selected dates`);
          }
        }
      }
      return {
        line_id: createLocalId(),
        accessory_id: a.id,
        name_snapshot: a.name,
        image_url: a.image_url || null,
        qty: 1,
        price: catalogPriceForType(a, type),
        catalog_price_rent,
        catalog_price_sell,
        discount: 0,
        gst_percent: gstEnabled ? gstDefaultRate : 0,
        type,
        accessory_order_status: accessoryDefaultOrderStatus(a),
        selected,
        source: a.source || 'recommended',
        category_id,
        category_name,
        display_order: Number(a.display_order ?? 0),
        category_display_order:
          a.category_display_order !== undefined && a.category_display_order !== null
            ? Number(a.category_display_order || 0)
            : null,
        free_qty: Number(a.free_qty || 0),
        booked_qty: Number(a.booked_qty || 0),
        total_qty: Number(a.total_qty || 0),
        spare_qty: Number(a.spare_qty || 0),
        rentable_qty:
          a.rentable_qty != null && a.rentable_qty !== ''
            ? Math.max(0, Number(a.rentable_qty) || 0)
            : undefined,
        in_shop_qty:
          a.in_shop_qty != null && a.in_shop_qty !== ''
            ? Math.max(0, Number(a.in_shop_qty) || 0)
            : undefined,
        stock_qty: Math.max(0, Number(a.qty ?? a.total_qty ?? 0) || 0),
        is_required: !!a.is_required,
        is_recommended: !!a.is_recommended,
        remarks: '',
      };
    });
  };

  const mergeLineAccessoriesForEditModal = async (line) => {
    if (!line?.product_id) return ensureAccessoryLineIds(line.accessories);
    const rec = await fetchRecommendedAccessories({
      id: line.product_id,
      category_id: line.category_id || '',
    });
    const catalog = toAccessoryLines(rec);
    const saved = ensureAccessoryLineIds(line.accessories);
    const existingById = new Map(saved.map((a) => [String(a.accessory_id || ''), a]));
    const merged = catalog.map((recRow) => {
      const ex = existingById.get(String(recRow.accessory_id || ''));
      if (!ex) return recRow;
      return {
        ...recRow,
        line_id: ex.line_id || recRow.line_id,
        persisted_id: ex.persisted_id,
        selected: !!ex.selected,
        qty: ex.qty ?? recRow.qty,
        price: ex.price ?? recRow.price,
        discount: ex.discount ?? recRow.discount,
        remarks: String(ex.remarks ?? '').trim().slice(0, 500),
        accessory_order_status: ex.accessory_order_status ?? recRow.accessory_order_status,
        type: ex.type ?? recRow.type,
        category_id: ex.category_id ?? recRow.category_id,
        category_name: String(ex.category_name || '').trim() || recRow.category_name,
      };
    });
    for (const ex of saved) {
      const aid = String(ex.accessory_id || '');
      if (!aid || catalog.some((r) => String(r.accessory_id) === aid)) continue;
      merged.push({
        ...ex,
        line_id: ex.line_id || createLocalId(),
        selected: !!ex.selected,
      });
    }
    return sortAccessoriesByDisplayOrder(merged);
  };

  const openProductAccessoryModal = async (line) => {
    if (!line || line.line_kind === 'standalone_accessory') return;
    if (!pickupDate || !returnDate) {
      toast.warning('Set delivery and return dates first');
      return;
    }
    setProductOpen(false);
    setAccessoryModalMode('recommended');
    setAccessoryCategoryId('all');
    setAccessorySearch('');
    let accessories = ensureAccessoryLineIds(line.accessories);
    try {
      if (line.product_id) {
        accessories = await mergeLineAccessoriesForEditModal(line);
      }
      const { lines: refreshedLines } = await refreshRentAccessoryLinesAvailability(
        [{ ...line, accessories }],
        {
          from: pickupDate,
          to: returnDate,
          excludeOrderId: isEditMode ? orderId : undefined,
        },
        { grandfatherPersisted: isEditMode }
      );
      accessories = refreshedLines[0]?.accessories ?? accessories;
      const linesForSeed = lines.map((l) =>
        l.line_id === line.line_id ? { ...l, accessories } : l
      );
      setLines(linesForSeed);
      setAccessoryModalRemarks(
        resolveAccessoryModalRemarksSeed(linesForSeed, line.line_id, 'recommended')
      );
      setAddAccessoryForLineId(line.line_id);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || 'Could not open accessories for this product');
    }
  };

  const openAllAccessoriesModal = () => {
    if (!pickupDate || !returnDate) {
      toast.warning('Set delivery and return dates first');
      return;
    }
    setProductOpen(false);
    setAccessorySearch('');
    setAccessoryCategoryId('all');
    setAccessoryModalMode('all');
    const lastProductLine = [...lines].reverse().find((l) => l.line_kind !== 'standalone_accessory');
    const targetLineId = lastProductLine ? lastProductLine.line_id : ACCESSORY_ONLY_MODAL_LINE_ID;
    setAccessoryModalRemarks(resolveAccessoryModalRemarksSeed(lines, targetLineId, 'all'));
    setAddAccessoryForLineId(targetLineId);
  };

  const handleAddProductLine = async () => {
    if (addingProductLineRef.current) return;
    addingProductLineRef.current = true;
    setAddingProductLine(true);

    try {
      const products = selectableProductMatches;
      const byCode = products.find(
        (p) => String(p.code || '').toLowerCase() === String(productQuery || '').trim().toLowerCase()
      );
      const product =
        selectedProduct ||
        byCode ||
        products.find((p) => isProductBookableForSelection(p, lineQty)) ||
        products[0];
      if (!product) {
        toast.warning('Search and select a product first');
        return;
      }
      if (addedProductIds.has(String(product.id))) {
        toast.warning('This product is already added in booking.');
        return;
      }
      if (!isProductBookableForSelection(product, lineQty)) {
        toast.warning('Product not available for selected delivery/return dates.');
        return;
      }

      const qtyToAdd = Math.max(1, Number(lineQty) || 1);
      const primaryCodeKey = String(product.code || '')
        .trim()
        .toLowerCase();

      resetProductSearchBar();

      const isSellProduct = getDefaultProductLineType(product) === 'sell';
      if (isSellProduct) {
        const sellResult = await validateSellProductQty({
          productId: product.id,
          excludeOrderId: isEditMode ? orderId : undefined,
          label: product.name || product.code || 'Product',
        });
        if (!sellResult.ok) {
          restoreProductSearchBar(product);
          toast.warning(sellResult.message);
          return;
        }
      } else {
        // Re-check exact availability at add time so stale search results cannot
        // add an unavailable product.
        try {
          const availability = await productsApi.checkAvailability({
            product_id: product.id,
            from: pickupDate,
            to: returnDate,
            qty: qtyToAdd,
            ...(isEditMode && orderId ? { exclude_order_id: orderId } : {}),
          });
          const data = availability?.data || {};
          if (!data.available) {
            const free = Number(data.free_qty || 0);
            const requested = Number(data.requested_qty || qtyToAdd);
            restoreProductSearchBar(product);
            toast.warning(
              free > 0
                ? `Product not available. Requested ${requested}, only ${free} available.`
                : 'Product not available for selected dates.'
            );
            return;
          }
        } catch {
          // Fallback to list availability flag when exact check fails unexpectedly.
          if (!isProductBookableForSelection(product, lineQty)) {
            restoreProductSearchBar(product);
            toast.warning(
              `Product not available${
                product.next_available_date
                  ? ` (next: ${formatDate(product.next_available_date) || '-'})`
                  : ''
              }`
            );
            return;
          }
        }
      }

      const rec = await fetchRecommendedAccessories(product);
      const accessoryLines = toAccessoryLines(rec).filter((a) => a.selected);

      const buildProductBookingLine = (catalog, qty, accessories) => {
        const type = getDefaultProductLineType(catalog);
        return {
          line_id: createLocalId(),
          product_id: catalog.id || catalog.related_product_id,
          code_snapshot: catalog.code,
          name_snapshot: catalog.name,
          main_image: catalog.main_image || null,
          qty,
          price: catalogPriceForType(catalog, type),
          discount: 0,
          gst_percent: gstEnabled ? gstDefaultRate : 0,
          type,
          category_id: catalog.category_id || null,
          total_qty: Number(catalog.total_qty || 0),
          free_qty: Number(catalog.free_qty || 0),
          booked_qty: Number(catalog.booked_qty || 0),
          in_delivery_qty: Number(catalog.in_delivery_qty || 0),
          return_pending_qty: Number(catalog.return_pending_qty || 0),
          washing_qty: Number(catalog.washing_qty || 0),
          repair_qty: Number(catalog.repair_qty || 0),
          next_available_date: catalog.next_available_date || null,
          gap_days: Number(catalog.gap_days || 0),
          tailor_notes: '',
          tailor_note_image: '',
          sales_person_id: isSalesmanEligibleUser(currentUser) ? currentUser.id : null,
          sales_person_name: isSalesmanEligibleUser(currentUser)
            ? String(currentUser?.name || currentUser?.email || '').trim()
            : '',
          accessories: accessories || [],
        };
      };

      const linesToAdd = [buildProductBookingLine(product, qtyToAdd, accessoryLines)];
      const usedProductIds = new Set([String(product.id)]);
      const usedCodes = new Set(primaryCodeKey ? [primaryCodeKey] : []);

      let relatedList = [];
      try {
        const relatedRes = await productsApi.getRelatedMapping(product.id, { for_booking: 1 });
        relatedList = relatedRes?.data?.products || [];
      } catch {
        relatedList = [];
      }

      // Dedupe related mapping rows by related_product_id; never include primary.
      const seenRelatedIds = new Set();
      const uniqueRelated = [];
      for (const related of relatedList) {
        const relatedId = String(related.related_product_id || '').trim();
        if (!relatedId || relatedId === String(product.id)) continue;
        if (seenRelatedIds.has(relatedId)) continue;
        seenRelatedIds.add(relatedId);
        uniqueRelated.push(related);
      }

      for (const related of uniqueRelated) {
        const relatedId = String(related.related_product_id || '');
        if (!relatedId || usedProductIds.has(relatedId)) continue;

        const relatedCodeKey = String(related.code || '')
          .trim()
          .toLowerCase();
        if (relatedCodeKey && usedCodes.has(relatedCodeKey)) continue;

        const relatedCatalog = {
          ...related,
          id: related.related_product_id,
        };
        const relatedQty = 1;
        const isSellRelated = getDefaultProductLineType(relatedCatalog) === 'sell';
        let available = true;

        if (isSellRelated) {
          const sellResult = await validateSellProductQty({
            productId: relatedId,
            excludeOrderId: isEditMode ? orderId : undefined,
            label: related.name || related.code || 'Related product',
          });
          available = sellResult.ok;
          if (!available) {
            toast.warning(
              related.is_required
                ? `Required related product "${related.name || related.code}" is out of stock`
                : sellResult.message ||
                    `"${related.name || related.code}" (related) is out of stock`
            );
          }
        } else {
          try {
            const availability = await productsApi.checkAvailability({
              product_id: relatedId,
              from: pickupDate,
              to: returnDate,
              qty: relatedQty,
              ...(isEditMode && orderId ? { exclude_order_id: orderId } : {}),
            });
            available = Boolean(availability?.data?.available);
            if (!available) {
              toast.warning(
                related.is_required
                  ? `Required related product "${related.name || related.code}" is not available for selected dates`
                  : `"${related.name || related.code}" (related) is not available for selected dates`
              );
            }
          } catch {
            available = false;
            toast.warning(
              `Could not check availability for related product "${related.name || related.code}"`
            );
          }
        }

        if (!available) continue;

        const relatedRec = await fetchRecommendedAccessories(relatedCatalog);
        const relatedAccessories = toAccessoryLines(relatedRec).filter((a) => a.selected);
        linesToAdd.push(buildProductBookingLine(relatedCatalog, relatedQty, relatedAccessories));
        usedProductIds.add(relatedId);
        if (relatedCodeKey) usedCodes.add(relatedCodeKey);
      }

      setLines((prev) => {
        const existingIds = new Set(
          prev
            .filter((line) => line.line_kind !== 'standalone_accessory' && line.product_id)
            .map((line) => String(line.product_id))
        );
        const existingCodes = new Set(
          prev
            .filter((line) => line.line_kind !== 'standalone_accessory' && line.code_snapshot)
            .map((line) => String(line.code_snapshot).trim().toLowerCase())
            .filter(Boolean)
        );

        let next = prev;
        const seenBatchIds = new Set();
        const seenBatchCodes = new Set();

        for (const draft of linesToAdd) {
          const pid = String(draft.product_id || '');
          const codeKey = String(draft.code_snapshot || '')
            .trim()
            .toLowerCase();
          if (!pid || existingIds.has(pid) || seenBatchIds.has(pid)) continue;
          if (codeKey && (existingCodes.has(codeKey) || seenBatchCodes.has(codeKey))) continue;

          seenBatchIds.add(pid);
          if (codeKey) seenBatchCodes.add(codeKey);

          const section = productLineIsSaleOnly(draft) ? 'sale_product' : 'rent_product';
          next = [
            ...next,
            {
              ...draft,
              display_order: nextLineDisplayOrder(next, section),
            },
          ];
        }
        return next;
      });
      clearFieldError(setFieldErrors, 'lines');
    } finally {
      addingProductLineRef.current = false;
      setAddingProductLine(false);
    }
  };

  const setLineSalesPerson = (lineId, salesPersonId) => {
    setProductField(lineId, {
      sales_person_id: salesPersonId || null,
      sales_person_name: salesPersonId ? salesmanLabelById.get(salesPersonId) || '' : '',
    });
  };

  const setProductField = (lineId, patch) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.line_id !== lineId) return line;
        const merged = { ...line, ...patch };
        if (
          merged.line_kind === 'standalone_accessory' &&
          isSellAccessoryLine(merged) &&
          (patch.qty != null || patch.type != null)
        ) {
          const available = getSellAccessoryAvailable(merged, prev, { omitLineId: lineId });
          const safe = withStockValidation(merged.qty, available, merged.name_snapshot, merged);
          if (safe < 1) return line;
          return { ...merged, qty: safe };
        }
        return merged;
      })
    );
  };

  const openProductNoteEditor = (line) => {
    if (!line || line.line_kind === 'standalone_accessory') return;
    setNoteEditorLineId(line.line_id);
    setNoteEditorValue(String(line.tailor_notes || ''));
    setNoteEditorImageUrl(String(line.tailor_note_image || '').trim());
  };

  const closeProductNoteEditor = () => {
    setNoteEditorLineId('');
    setNoteEditorValue('');
    setNoteEditorImageUrl('');
  };

  const saveProductNoteEditor = () => {
    const clean = String(noteEditorValue || '').trim().slice(0, 500);
    const imageUrl = String(noteEditorImageUrl || '').trim().slice(0, 500) || '';
    if (noteEditorLineId) {
      setProductField(noteEditorLineId, {
        tailor_notes: clean,
        tailor_note_image: imageUrl,
      });
    }
    closeProductNoteEditor();
  };

  const productLineHasNote = (line) =>
    Boolean(
      line &&
        line.line_kind !== 'standalone_accessory' &&
        (String(line.tailor_notes || '').trim() || String(line.tailor_note_image || '').trim())
    );

  const setProductQtyWithValidation = async (line, nextQty) => {
    if (line.line_kind === 'standalone_accessory' && isSellAccessoryLine(line)) {
      setLines((prev) => {
        const current = prev.find((l) => l.line_id === line.line_id);
        if (!current) return prev;
        const available = getSellAccessoryAvailable(current, prev, { omitLineId: line.line_id });
        const safe = withStockValidation(nextQty, available, current.name_snapshot, current);
        if (safe < 1) return prev;
        return prev.map((l) => (l.line_id === line.line_id ? { ...l, qty: safe } : l));
      });
      return;
    }
    if (line.line_kind === 'standalone_accessory' && isRentAccessoryLine(line)) {
      if (!pickupDate || !returnDate) {
        toast.warning('Set delivery and return dates first');
        return;
      }
      const wanted = Math.max(1, Number(nextQty) || 1);
      setQtyValidatingLineId(line.line_id);
      try {
        const current = linesRef.current.find((l) => l.line_id === line.line_id) || line;
        const result = await validateRentAccessoryQty({
          accessoryId: current.accessory_id,
          from: pickupDate,
          to: returnDate,
          qty: wanted,
          excludeOrderId: isEditMode ? orderId : undefined,
          label: current.name_snapshot || 'Accessory',
        });
        if (!result.ok) {
          toast.warning(result.message);
          return;
        }
        const data = result.data || {};
        const merged = {
          ...current,
          total_qty: Number(data.total_qty ?? current.total_qty ?? 0),
          booked_qty: Number(data.booked_qty ?? current.booked_qty ?? 0),
          free_qty: Number(data.free_qty ?? result.freeQty ?? 0),
        };
        const available = getRentAccessoryAvailable(merged, linesRef.current, {
          omitLineId: line.line_id,
        });
        const safe = withStockValidation(wanted, available, merged.name_snapshot, merged);
        if (safe < 1) return;
        setLines((prev) =>
          prev.map((l) =>
            l.line_id === line.line_id
              ? { ...merged, qty: safe }
              : l
          )
        );
      } finally {
        setQtyValidatingLineId('');
      }
      return;
    }
    if (String(line.type || 'rent').toLowerCase() === 'sell') {
      setQtyValidatingLineId(line.line_id);
      try {
        const sellResult = await validateSellProductQty({
          productId: line.product_id,
          excludeOrderId: isEditMode ? orderId : undefined,
          label: line.name_snapshot || line.code_snapshot || 'Product',
        });
        if (!sellResult.ok) {
          toast.warning(sellResult.message);
          return;
        }
        const safe = withStockValidation(nextQty, line.free_qty, line.name_snapshot, line);
        if (safe < 1) return;
        setProductField(line.line_id, { qty: safe });
      } finally {
        setQtyValidatingLineId('');
      }
      return;
    }
    if (!pickupDate || !returnDate) {
      toast.warning('Set delivery and return dates first');
      return;
    }
    const wanted = Math.max(1, Number(nextQty) || 1);
    setQtyValidatingLineId(line.line_id);
    try {
      const result = await validateRentProductQty({
        productId: line.product_id,
        code: line.code_snapshot,
        from: pickupDate,
        to: returnDate,
        qty: wanted,
        excludeOrderId: isEditMode ? orderId : undefined,
        label: line.name_snapshot || line.code_snapshot || 'Product',
      });
      if (!result.ok) {
        toast.warning(result.message);
        return;
      }
      setProductField(line.line_id, { qty: wanted, free_qty: result.freeQty });
    } finally {
      setQtyValidatingLineId('');
    }
  };

  const removeProductLine = (lineId) => {
    setLines((prev) => prev.filter((line) => line.line_id !== lineId));
  };

  const setAccessoryQtyWithValidation = async (lineId, accessoryLineId, nextQty) => {
    if (!pickupDate || !returnDate) {
      toast.warning('Set delivery and return dates first');
      return;
    }
    const wanted = Math.max(1, Number(nextQty) || 1);
    setQtyValidatingLineId(`acc:${lineId}:${accessoryLineId}`);
    try {
      const parent = linesRef.current.find((l) => l.line_id === lineId);
      const current = (parent?.accessories || []).find((a) => a.line_id === accessoryLineId);
      if (!current) return;
      const result = await validateRentAccessoryQty({
        accessoryId: current.accessory_id,
        from: pickupDate,
        to: returnDate,
        qty: wanted,
        excludeOrderId: isEditMode ? orderId : undefined,
        label: current.name_snapshot || 'Accessory',
      });
      if (!result.ok) {
        toast.warning(result.message);
        return;
      }
      const data = result.data || {};
      const merged = {
        ...current,
        total_qty: Number(data.total_qty ?? current.total_qty ?? 0),
        booked_qty: Number(data.booked_qty ?? current.booked_qty ?? 0),
        free_qty: Number(data.free_qty ?? result.freeQty ?? 0),
      };
      const available = getRentAccessoryAvailable(merged, linesRef.current, {
        omitAccessoryLineId: accessoryLineId,
      });
      const safe = withStockValidation(wanted, available, merged.name_snapshot, merged);
      if (safe < 1) return;
      setLines((prev) =>
        prev.map((line) => {
          if (line.line_id !== lineId) return line;
          return {
            ...line,
            accessories: (line.accessories || []).map((a) =>
              a.line_id === accessoryLineId ? { ...merged, qty: safe } : a
            ),
          };
        })
      );
    } finally {
      setQtyValidatingLineId('');
    }
  };

  const setAccessoryField = (lineId, accessoryLineId, patch) => {
    if (patch.qty != null) {
      const parent = linesRef.current.find((l) => l.line_id === lineId);
      const acc = (parent?.accessories || []).find((a) => a.line_id === accessoryLineId);
      const mergedPreview = acc ? { ...acc, ...patch } : null;
      if (mergedPreview && isSellAccessoryLine(mergedPreview)) {
        setLines((prev) =>
          prev.map((line) => {
            if (line.line_id !== lineId) return line;
            return {
              ...line,
              accessories: (line.accessories || []).map((a) => {
                if (a.line_id !== accessoryLineId) return a;
                const merged = { ...a, ...patch };
                const available = getSellAccessoryAvailable(merged, prev, {
                  omitAccessoryLineId: a.line_id,
                });
                const safe = withStockValidation(merged.qty, available, merged.name_snapshot, merged);
                if (safe < 1) return a;
                return { ...merged, qty: safe };
              }),
            };
          })
        );
        return;
      }
      if (mergedPreview && isRentAccessoryLine(mergedPreview)) {
        setAccessoryQtyWithValidation(lineId, accessoryLineId, patch.qty);
        return;
      }
    }
    setLines((prev) =>
      prev.map((line) => {
        if (line.line_id !== lineId) return line;
        return {
          ...line,
          accessories: (line.accessories || []).map((a) => {
            if (a.line_id !== accessoryLineId) return a;
            const merged = { ...a, ...patch };
            if (isSellAccessoryLine(merged) && patch.type != null) {
              const available = getSellAccessoryAvailable(merged, prev, { omitAccessoryLineId: a.line_id });
              const safe = withStockValidation(merged.qty, available, merged.name_snapshot, merged);
              if (safe < 1) return a;
              return { ...merged, qty: safe };
            }
            return merged;
          }),
        };
      })
    );
  };
  const removeAccessoryLine = (lineId, accessoryLineId) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.line_id !== lineId) return line;
        return {
          ...line,
          accessories: (line.accessories || [])
            .map((a) => {
              if (a.line_id !== accessoryLineId) return a;
              if (a.source === 'manual') return null;
              return deselectAccessoryRow(a);
            })
            .filter(Boolean),
        };
      })
    );
    if (addAccessoryForLineId === lineId) {
      setPendingRecommendedSelections((prev) => ({
        ...prev,
        [accessoryLineId]: false,
      }));
    }
  };

  const togglePendingRecommendedSelection = async (accessoryLineId, checked) => {
    if (checked && activeAccessoryLine) {
      const acc =
        recommendedAccessoriesForDisplay.find((a) => a.line_id === accessoryLineId) ||
        (activeAccessoryLine.accessories || []).find((a) => a.line_id === accessoryLineId);
      if (acc) {
        const pickType = resolveAccessoryPickerType(acc, acc.type);
        const grandfather = canGrandfatherAccessorySelection(acc, { isEditMode });
        if (isAccessoryPickerOutOfStock(acc, { type: pickType, grandfatherSelected: grandfather })) {
          toast.warning(`${acc.name_snapshot || 'Accessory'} is not available for selected dates`);
          return;
        }
        if (
          pickType !== 'sell' &&
          pickupDate &&
          returnDate &&
          acc.accessory_id &&
          !grandfather
        ) {
          const qty = Math.max(1, Number(acc.qty) || 1);
          const result = await validateRentAccessoryQty({
            accessoryId: acc.accessory_id,
            from: pickupDate,
            to: returnDate,
            qty,
            excludeOrderId: isEditMode ? orderId : undefined,
            label: acc.name_snapshot || 'Accessory',
          });
          if (!result.ok) {
            toast.warning(result.message || `${acc.name_snapshot || 'Accessory'} is not available`);
            return;
          }
        }
      }
    }
    setPendingRecommendedSelections((prev) => ({
      ...prev,
      [accessoryLineId]: checked,
    }));
    if (checked && activeAccessoryLine) {
      const acc = (activeAccessoryLine.accessories || []).find((a) => a.line_id === accessoryLineId);
      const aid = acc?.accessory_id;
      if (aid) {
        setPendingAccessoryPicks((prev) => {
          if (!prev[aid]) return prev;
          const next = { ...prev };
          delete next[aid];
          return next;
        });
      }
    }
  };

  const togglePendingAccessoryPick = (accessory, checked) => {
    if (isAccessoryAlreadyOnBooking(accessory.id)) return;
    setPendingAccessoryPicks((prev) => {
      const next = { ...prev };
      if (checked) {
        next[accessory.id] = {
          accessory,
          type: accessoryDefaultType(accessory),
          accessory_order_status: accessoryDefaultOrderStatus(accessory),
        };
      } else {
        delete next[accessory.id];
      }
      return next;
    });
  };

  const selectAllVisibleAccessories = () => {
    const rows = accessorySearchQuery.data?.data || [];
    setPendingAccessoryPicks((prev) => {
      const next = { ...prev };
      for (const a of rows) {
        if (isAccessoryAlreadyOnBooking(a.id)) continue;
        if (accessoryPickerAvailableQty(a, accessoryDefaultType(a)) <= 0) continue;
        next[a.id] = {
          accessory: a,
          type: accessoryDefaultType(a),
          accessory_order_status: accessoryDefaultOrderStatus(a),
        };
      }
      return next;
    });
  };

  const clearPendingAccessoryPicks = () => {
    setPendingAccessoryPicks({});
  };

  const selectAllRecommendedAccessories = () => {
    if (!activeAccessoryLine) return;
    setPendingRecommendedSelections((prev) => {
      const next = { ...prev };
      for (const a of recommendedAccessoriesForDisplay) {
        const pickType = resolveAccessoryPickerType(a, a.type);
        if (
          isAccessoryPickerOutOfStock(a, {
            type: pickType,
            grandfatherSelected: canGrandfatherAccessorySelection(a, { isEditMode }),
          })
        ) {
          continue;
        }
        next[a.line_id] = true;
      }
      return next;
    });
  };

  const clearPendingRecommendedSelections = () => {
    if (!activeAccessoryLine) return;
    setPendingRecommendedSelections((prev) => {
      const next = { ...prev };
      for (const a of activeAccessoryLine.accessories || []) {
        next[a.line_id] = false;
      }
      return next;
    });
  };

  const mergeManualAccessoryIntoLines = (prev, accessory, overrides, remarkSnap) => {
    if (!addAccessoryForLineId) return { lines: prev, added: 0 };

    const mergedRemarks = String(
      overrides.remarks !== undefined && overrides.remarks !== null ? overrides.remarks : remarkSnap
    )
      .trim()
      .slice(0, 500);

    const pickType = () => {
      if (overrides.type === 'rent' || overrides.type === 'sell') return overrides.type;
      return accessoryDefaultType(accessory);
    };
    const type = pickType();
    const catalog_price_rent = Number(accessory.price_rent || 0);
    const catalog_price_sell = Number(accessory.price_sell || 0);
    const categoryId = accessory.category_id || null;
    const categoryName = String(
      accessory.category_name ||
        accessory.category_label ||
        accessoryCategoryLabelById.get(String(categoryId || '')) ||
        ''
    ).trim();
    const accessory_order_status = normalizeAccessoryOrderStatus(
      overrides.accessory_order_status !== undefined && overrides.accessory_order_status !== ''
        ? overrides.accessory_order_status
        : accessoryDefaultOrderStatus(accessory)
    );
    const price = accessoryPriceForType({ price_rent: catalog_price_rent, price_sell: catalog_price_sell }, type);

    if (accessoryModalMode === 'all') {
      const categoryNameFallback = String(
        accessory.category_name ||
          accessory.category_label ||
          accessoryCategoryLabelById.get(String(accessory.category_id || '')) ||
          ''
      ).trim();
      const stockQty = getAccessoryCatalogStockForPick(accessory);
      const apiFreeQty = accessory.free_qty != null ? Math.max(0, Number(accessory.free_qty)) : stockQty;
      const apiTotalQty = accessory.total_qty != null ? Math.max(0, Number(accessory.total_qty)) : stockQty;
      const apiBookedQty = accessory.booked_qty != null ? Math.max(0, Number(accessory.booked_qty)) : 0;
      const next = {
        line_id: createLocalId(),
        line_kind: 'standalone_accessory',
        product_id: null,
        accessory_id: accessory.id,
        name_snapshot: accessory.name,
        main_image: accessory.image_url || null,
        qty: 1,
        price,
        catalog_price_rent,
        catalog_price_sell,
        discount: 0,
        gst_percent: gstEnabled ? gstDefaultRate : 0,
        type,
        accessory_order_status,
        category_id: accessory.category_id || null,
        category_name: categoryNameFallback,
        stock_qty: stockQty,
        total_qty: apiTotalQty,
        free_qty: apiFreeQty,
        booked_qty: apiBookedQty,
        in_delivery_qty: 0,
        return_pending_qty: 0,
        washing_qty: 0,
        repair_qty: 0,
        next_available_date: null,
        accessories: [],
        remarks: mergedRemarks,
      };
      const section = lineBookingSection(next);
      const display_order = nextLineDisplayOrder(prev, section);
      if (isSellAccessoryLine(next)) {
        const available = getSellAccessoryAvailable(next, prev);
        if (available < 1) {
          toast.warning(`${next.name_snapshot} is out of stock`);
          return { lines: prev, added: 0 };
        }
        return {
          lines: [...prev, { ...next, qty: Math.min(1, available), display_order }],
          added: 1,
        };
      }
      const rentAvailable = getRentAccessoryAvailable(next, prev);
      if (rentAvailable < 1) {
        toast.warning(`${next.name_snapshot} is out of stock`);
        return { lines: prev, added: 0 };
      }
      return {
        lines: [...prev, { ...next, qty: Math.min(1, rentAvailable), display_order }],
        added: 1,
      };
    }

    let productAdded = false;
    const mapped = prev.map((line) => {
      if (line.line_id !== addAccessoryForLineId) return line;
      const existing = (line.accessories || []).find((a) => a.accessory_id === accessory.id);
      if (existing) {
        const nextQty = existing.selected ? Number(existing.qty || 1) + 1 : 1;
        if (isSellAccessoryLine(existing)) {
          const available = getSellAccessoryAvailable(existing, prev, { omitAccessoryLineId: existing.line_id });
          const safe = withStockValidation(nextQty, available, existing.name_snapshot, existing);
          if (safe < 1) return line;
          productAdded = true;
          return {
            ...line,
            accessories: (line.accessories || []).map((a) => {
              if (a.accessory_id !== accessory.id) return a;
              if (!existing.selected) {
                return reactivateAccessoryRow(a, {
                  category_id: a.category_id || categoryId,
                  category_name: String(a.category_name || '').trim() || categoryName,
                  remarks: mergedRemarks || String(a.remarks || '').trim().slice(0, 500) || '',
                });
              }
              return {
                ...a,
                selected: true,
                qty: safe,
                category_id: a.category_id || categoryId,
                category_name: String(a.category_name || '').trim() || categoryName,
                remarks: mergedRemarks || String(a.remarks || '').trim().slice(0, 500) || '',
              };
            }),
          };
        }
        const available = getRentAccessoryAvailable(existing, prev, {
          omitAccessoryLineId: existing.line_id,
        });
        const safe = withStockValidation(nextQty, available, existing.name_snapshot, existing);
        if (safe < 1) return line;
        productAdded = true;
        return {
          ...line,
          accessories: (line.accessories || []).map((a) => {
            if (a.accessory_id !== accessory.id) return a;
            if (!existing.selected) {
              return reactivateAccessoryRow(a, {
                category_id: a.category_id || categoryId,
                category_name: String(a.category_name || '').trim() || categoryName,
                remarks: mergedRemarks || String(a.remarks || '').trim().slice(0, 500) || '',
              });
            }
            return {
              ...a,
              selected: true,
              qty: safe,
              category_id: a.category_id || categoryId,
              category_name: String(a.category_name || '').trim() || categoryName,
              remarks: mergedRemarks || String(a.remarks || '').trim().slice(0, 500) || '',
            };
          }),
        };
      }
      const stockQty = getAccessoryCatalogStockForPick(accessory);
      const apiFreeQty = accessory.free_qty != null ? Math.max(0, Number(accessory.free_qty)) : stockQty;
      const apiTotalQty = accessory.total_qty != null ? Math.max(0, Number(accessory.total_qty)) : stockQty;
      const apiBookedQty = accessory.booked_qty != null ? Math.max(0, Number(accessory.booked_qty)) : 0;
      const next = {
        line_id: createLocalId(),
        accessory_id: accessory.id,
        name_snapshot: accessory.name,
        image_url: accessory.image_url || null,
        qty: 1,
        price,
        catalog_price_rent,
        catalog_price_sell,
        discount: 0,
        gst_percent: gstEnabled ? gstDefaultRate : 0,
        type,
        accessory_order_status,
        selected: true,
        source: 'manual',
        category_id: categoryId,
        category_name: categoryName,
        stock_qty: stockQty,
        free_qty: isSellAccessoryLine({ type }) ? stockQty : apiFreeQty,
        booked_qty: apiBookedQty,
        total_qty: apiTotalQty,
        is_required: false,
        is_recommended: false,
        display_order: nextAccessoryDisplayOrder(line.accessories),
        remarks: mergedRemarks,
      };
      if (isSellAccessoryLine(next)) {
        const available = getSellAccessoryAvailable(next, prev);
        if (available < 1) {
          toast.warning(`${next.name_snapshot} is out of stock`);
          return line;
        }
      } else {
        const available = getRentAccessoryAvailable(next, prev);
        if (available < 1) {
          toast.warning(`${next.name_snapshot} is out of stock`);
          return line;
        }
        next.qty = Math.min(1, available);
      }
      productAdded = true;
      return {
        ...line,
        accessories: sortAccessoriesByDisplayOrder([...(line.accessories || []), next]),
      };
    });
    return { lines: mapped, added: productAdded ? 1 : 0 };
  };

  const commitAccessoryModal = async () => {
    const remarkSnap = String(accessoryModalRemarks || '').trim().slice(0, 500);
    const picks = Object.values(pendingAccessoryPicks);
    let addedCount = 0;
    let recommendedAppliedCount = 0;
    let failedPickCount = 0;
    let recommendedFailedCount = 0;

    let next = lines;

    if (
      accessoryModalMode !== 'all' &&
      addAccessoryForLineId &&
      addAccessoryForLineId !== ACCESSORY_ONLY_MODAL_LINE_ID
    ) {
      const productLine = next.find((l) => l.line_id === addAccessoryForLineId);
      const resolvedAccessories = [];

      for (const a of productLine?.accessories || []) {
        const wantSelected =
          pendingRecommendedSelections[a.line_id] !== undefined
            ? !!pendingRecommendedSelections[a.line_id]
            : !!a.selected;
        if (!wantSelected) {
          resolvedAccessories.push(deselectAccessoryRow(a));
          continue;
        }

        const wasSelected = !!a.selected;
        const keep = String(a.remarks || '').trim();
        const merged = wasSelected
          ? { ...a, selected: true, remarks: remarkSnap || keep }
          : reactivateAccessoryRow(a, { remarks: remarkSnap || keep });
        const grandfather = canGrandfatherAccessorySelection(a, { isEditMode });

        if (isSellAccessoryLine(merged)) {
          const available = getSellAccessoryAvailable(merged, next, { omitAccessoryLineId: a.line_id });
          if (available < 1 && !grandfather) {
            recommendedFailedCount += 1;
            toast.warning(`${merged.name_snapshot} is out of stock`);
            resolvedAccessories.push(deselectAccessoryRow(a));
            continue;
          }
        } else {
          let availableOk =
            getRentAccessoryAvailable(merged, next, { omitAccessoryLineId: a.line_id }) >= 1 || grandfather;
          if (!availableOk && pickupDate && returnDate && a.accessory_id) {
            const qty = Math.max(1, Number(merged.qty) || 1);
            const result = await validateRentAccessoryQty({
              accessoryId: a.accessory_id,
              from: pickupDate,
              to: returnDate,
              qty,
              excludeOrderId: isEditMode ? orderId : undefined,
              label: merged.name_snapshot || 'Accessory',
            });
            availableOk = result.ok || grandfather;
            if (!availableOk) {
              recommendedFailedCount += 1;
              toast.warning(result.message || `${merged.name_snapshot} is not available`);
              resolvedAccessories.push(deselectAccessoryRow(a));
              continue;
            }
          } else if (!availableOk) {
            recommendedFailedCount += 1;
            toast.warning(`${merged.name_snapshot} is out of stock`);
            resolvedAccessories.push(deselectAccessoryRow(a));
            continue;
          }
        }

        if (!wasSelected) recommendedAppliedCount += 1;
        resolvedAccessories.push(merged);
      }

      next = next.map((line) => {
        if (line.line_id !== addAccessoryForLineId) return line;
        return { ...line, accessories: resolvedAccessories };
      });
    }

    for (const pick of picks) {
      if (
        accessoryModalMode !== 'all' &&
        addAccessoryForLineId &&
        addAccessoryForLineId !== ACCESSORY_ONLY_MODAL_LINE_ID
      ) {
        const productLine = next.find((l) => l.line_id === addAccessoryForLineId);
        const alreadySelectedOnLine = (productLine?.accessories || []).some(
          (a) => String(a.accessory_id || '') === String(pick.accessory?.id || '') && !!a.selected
        );
        if (alreadySelectedOnLine) continue;
      }
      const result = mergeManualAccessoryIntoLines(next, pick.accessory, pick, remarkSnap);
      next = result.lines;
      if (result.added > 0) {
        addedCount += result.added;
      } else {
        failedPickCount += 1;
      }
    }

    setLines(next);

    const totalApplied = addedCount + recommendedAppliedCount;
    const totalFailed = failedPickCount + recommendedFailedCount;

    if (totalApplied > 0) {
      let msg;
      if (recommendedAppliedCount > 0 && addedCount === 0) {
        msg =
          recommendedAppliedCount === 1
            ? 'Saved 1 accessory selection'
            : `Saved ${recommendedAppliedCount} accessory selections`;
      } else if (addedCount > 0 && recommendedAppliedCount === 0) {
        msg = addedCount === 1 ? 'Added 1 accessory' : `Added ${addedCount} accessories`;
      } else {
        msg = totalApplied === 1 ? 'Added 1 accessory' : `Added ${totalApplied} accessories`;
      }
      toast.success(msg);
      if (totalFailed > 0) {
        toast.warning(
          totalFailed === 1
            ? '1 accessory could not be added (check stock)'
            : `${totalFailed} accessories could not be added (check stock)`
        );
      }
    } else if (totalFailed > 0) {
      toast.warning('No accessories could be added (check stock)');
    } else {
      toast.success('Accessories updated');
    }
    closeAccessoryModal();
  };

  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = securityAccountsQuery.data?.data || [];

  const advanceBankAccounts = useMemo(() => {
    return paymentAccounts.filter((a) => normPaymentAccountGroup(a.account_group) === 'bank accounts');
  }, [paymentAccounts]);

  const advanceCashAccounts = useMemo(() => {
    return paymentAccounts.filter((a) => normPaymentAccountGroup(a.account_group) === 'cash accounts');
  }, [paymentAccounts]);

  useEffect(() => {
    const allowed = new Set([...advanceBankAccounts, ...advanceCashAccounts].map((a) => a.id));
    if (advanceAccountId && !allowed.has(advanceAccountId)) {
      setAdvanceAccountId('');
    }
  }, [advanceBankAccounts, advanceCashAccounts, advanceAccountId]);

  const securityAccountOptions = useMemo(
    () =>
      securityAccounts.map((a) => ({
        value: a.id,
        label: a.name,
      })),
    [securityAccounts]
  );

  const submit = async () => {
    if (submitLockRef.current || isSubmitting || saveMutation.isPending) return;
    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
    const errors = {};
    let firstMessage = null;
    const add = (key, msg) => {
      if (!errors[key]) errors[key] = msg;
      if (!firstMessage) firstMessage = msg;
    };

    if (!customer) add('customer', 'Select a customer first');
    if (customer && !customerName) add('customerName', 'Enter customer name');
    if (lines.length === 0) add('lines', 'Add at least one product or accessory');
    if (!isIndianPhone(customerPhone1)) add('contactNo1', 'Enter a valid 10-digit Contact No.1');
    if (!isIndianPhone(effectiveContactNo2)) add('contactNo2', 'Enter a valid 10-digit Contact No.2');
    if (whatsappSource === 'phone2' && !isIndianPhone(effectiveContactNo2)) {
      add('whatsapp', 'Enter a valid Contact No.2 to use it as WhatsApp number');
    }
    if (whatsappSource === 'manual' && !isIndianPhone(resolvedWhatsapp)) {
      add('whatsapp', 'Enter a valid 10-digit WhatsApp number');
    }
    if (!String(address || '').trim()) add('address', 'Enter address');

    if (timeSlotMandatory) {
      if (!normalizeTime12(pickupTime)) add('pickupTime', 'Select delivery time');
      if (!normalizeTime12(returnTime)) add('returnTime', 'Select return time');
    }

    if (!pickupDate) add('pickupDate', 'Delivery and return dates are required');
    if (!returnDate) add('returnDate', 'Delivery and return dates are required');

    if (pickupDate && pickupDate < todayISO) {
      const grandfather =
        isEditMode && pickupDate === editOriginalPickupRef.current;
      if (!grandfather) add('pickupDate', 'Delivery date cannot be in the past');
    }
    if (returnDate && returnDate < todayISO) {
      const grandfather =
        isEditMode && returnDate === editOriginalReturnRef.current;
      if (!grandfather) add('returnDate', 'Return date cannot be in the past');
    }
    if (pickupDate && returnDate && returnDate < pickupDate) {
      add('returnDate', 'Return date cannot be before delivery date');
    }

    if (pickupDate && maxFutureBookingDays > 0) {
      const maxPickup = addDaysISO(todayISO, maxFutureBookingDays);
      if (pickupDate > maxPickup) {
        add('pickupDate', `Delivery date cannot be more than ${maxFutureBookingDays} days ahead`);
      }
    }

    if (pickupDate && returnDate && maxReturnDays > 0) {
      const maxReturn = addDaysISO(pickupDate, maxReturnDays);
      if (returnDate > maxReturn) {
        add('returnDate', `Return date cannot be more than ${maxReturnDays} days after delivery`);
      }
    }

    const advAmt = toNonNegativeAmount(advanceAmount);
    const expectedSecurity = toNonNegativeAmount(deposit);
    const advAcc = String(advanceAccountId || '').trim();
    const secAcc = String(securityAccountId || '').trim();

    if (!isEditMode && advanceMandatory && advAmt <= 0) {
      add('advanceAmount', 'Advance payment is required for new bookings');
    }

    const advanceAccountChoices = advanceBankAccounts.length + advanceCashAccounts.length;
    const editOrder = isEditMode ? editOrderQuery.data : null;
    const editSettlement = isEditMode ? buildBookingEditSettlement(editFinancialBaselineRef.current, {
      advance: advAmt, depositAmount: expectedSecurity, paid: paidSecurityAmt,
      paymentDate: toLocalISODate(new Date()), paymentAccountId: advAcc, securityAccountId: secAcc,
    }) : undefined;
    const deltaAdv = editSettlement?.advance_net === undefined ? 0 : round2(editSettlement.advance_net - editSettlement.expected_advance_net);
    const deltaDep = editSettlement?.security_net === undefined ? 0 : round2(editSettlement.security_net - editSettlement.expected_security_net);

    if (advAmt < 0 || expectedSecurity < 0) add('advanceAmount', 'Amounts cannot be negative');

    if (!isEditMode && advAmt > 0 && advanceAccountChoices > 0 && !advAcc) {
      add('advanceAccountId', 'Select an advance payment account for the amount entered');
    }
    if (!isEditMode && paidSecurityAmt && expectedSecurity > 0 && securityAccountOptions.length > 0 && !secAcc) {
      add('securityAccountId', 'Select a security account when "Paid Security Amt." is checked.');
    }
    if (isEditMode && deltaAdv !== 0 && advanceAccountChoices > 0 && !advAcc) {
      add('advanceAccountId', 'Select an advance payment account to adjust the advance amount');
    }
    if (isEditMode && deltaDep !== 0 && securityAccountOptions.length > 0 && !secAcc) {
      add('securityAccountId', 'Select a security account to adjust the security amount');
    }

    if (!splitDatetimeLocal(bookingDateTime).date) {
      add('bookingDateTime', 'Enter booking date and time');
    }

    if (!isEditMode && applyCustomerCredit) {
      const creditApply = toNonNegativeAmount(applyCreditAmount);
      if (creditApply > 0) {
        if (creditLookupPhones.length === 0) {
          add('applyCreditAmount', 'Enter a valid contact number to apply customer credit');
        } else if (creditApply > customerOpenCredit) {
          add(
            'applyCreditAmount',
            `Credit cannot exceed available balance (${formatCurrency(customerOpenCredit)})`
          );
        } else if (creditApply > totals.grand_total) {
          add('applyCreditAmount', 'Credit cannot exceed order total');
        }
      }
    }

    if (
      rejectSubmit({
        errors,
        setErrors: setFieldErrors,
        toast,
        message: firstMessage,
        fieldRefs,
        scrollOrder: BOOKING_FIELD_SCROLL_ORDER,
      })
    ) {
      releaseSubmitLock();
      return;
    }

    // Keep customer master details in sync with what operator corrected here.
    const detailRow = customerDetailQuery?.data?.data || customer || {};
    const patch = buildCustomerContactPatch(detailRow, {
      name: customerName,
      phone1: customerPhone1,
      phone2: String(effectiveContactNo2 || '').trim() || null,
      phone2_name: String(contact2Name || '').trim().slice(0, 60) || null,
      whatsapp: String(resolvedWhatsapp || '').trim() || null,
      address: String(address || '').trim() || null,
    });
    if (Object.keys(patch).length > 0 && !isOnline) {
      toast.warning('Reconnect before changing customer master details. Existing-customer booking edits can be queued offline.');
      releaseSubmitLock();
      return;
    }
    if (Object.keys(patch).length > 0) {
      try {
        await customersApi.update(customer.id, patch);
      } catch (err) {
        const msg = getApiErrorMessage(err, 'Customer details could not be synced');
        if (patch.phone1 !== undefined) add('contactNo1', msg);
        if (patch.address !== undefined) add('address', msg);
        if (patch.phone1 === undefined && patch.address === undefined) add('customer', msg);
        rejectSubmit({
          errors,
          setErrors: setFieldErrors,
          toast,
          message: msg,
          fieldRefs,
          scrollOrder: BOOKING_FIELD_SCROLL_ORDER,
        });
        releaseSubmitLock();
        return;
      }
    }

    if (wasReconcileRef.current && isOnline) {
      const reconcileCheck = await validateReconcileProductLines(lines);
      if (!reconcileCheck.ok) {
        toast.error(reconcileCheck.message || 'A product on this booking is already sold');
        releaseSubmitLock();
        return;
      }
    }

    const stockResult = isEditMode && !isOnline ? { ok: true } : await validateOrderRentAvailability(lines, {
      from: pickupDate,
      to: returnDate,
      excludeOrderId: isEditMode ? orderId : undefined,
    });
    if (!stockResult.ok) {
      toast.error(stockResult.message);
      releaseSubmitLock();
      return;
    }

    const items = [];
    for (const line of lines) {
      if (line.line_kind === 'standalone_accessory') {
        const qty = Number(line.qty || 1);
        const taxable = Math.max(
          0,
          (toNonNegativeAmount(line.price) - toNonNegativeAmount(line.discount)) * qty
        );
        const accessoryTaxRate = gstEnabled ? Number(line.gst_percent || 0) / 100 : 0;
        const accessoryTax =
          accessoryTaxRate <= 0
            ? 0
            : taxMode === 'inclusive'
              ? taxable - taxable / (1 + accessoryTaxRate)
              : taxable * accessoryTaxRate;
        const g = givenRentBooleansFromStatus(line.accessory_order_status);
        const handedOver = isCounterHandoverAccessory(line);
        items.push({
          id: line.persisted_id || undefined,
          item_type: 'accessory',
          accessory_id: line.accessory_id,
          name_snapshot: line.name_snapshot,
          qty,
          price: toNonNegativeAmount(line.price),
          discount: toNonNegativeAmount(line.discount),
          tax: round2(accessoryTax),
          type: line.type || 'rent',
          given_with_rent: g.given_with_rent,
          pack_with_rent: g.pack_with_rent,
          remarks: String(line.remarks || '').trim().slice(0, 500) || null,
          display_order: Number(line.display_order ?? 0),
          ...(handedOver && !line.persisted_id
            ? { stage_flags: defaultHandedOverAccessoryStageFlags() }
            : buildPersistedAccessoryStageFlagsPayload(line)),
        });
        continue;
      }

      const qty = Number(line.qty || 1);
      const taxable = Math.max(
        0,
        (toNonNegativeAmount(line.price) - toNonNegativeAmount(line.discount)) * qty
      );
      const productTaxRate = gstEnabled ? Number(line.gst_percent || 0) / 100 : 0;
      const productTax =
        productTaxRate <= 0
          ? 0
          : taxMode === 'inclusive'
            ? taxable - taxable / (1 + productTaxRate)
            : taxable * productTaxRate;
      items.push({
        id: line.persisted_id || undefined,
        item_type: 'product',
        line_id: line.line_id,
        product_id: line.product_id,
        ...(line.persisted_id && line.expected_line_version != null ? {
          expected_product_id: line.expected_product_id,
          expected_line_version: line.expected_line_version,
        } : {}),
        name_snapshot: line.name_snapshot,
        code_snapshot: line.code_snapshot,
        qty,
        price: toNonNegativeAmount(line.price),
        discount: toNonNegativeAmount(line.discount),
        tax: round2(productTax),
        type: line.type || 'rent',
        tailor_notes: String(line.tailor_notes || '').trim().slice(0, 500) || null,
        tailor_note_image: String(line.tailor_note_image || '').trim().slice(0, 500) || null,
        sales_person_id: line.sales_person_id || null,
        display_order: Number(line.display_order ?? 0),
      });
      const selectedAccessories = sortAccessoriesByDisplayOrder(
        (line.accessories || []).filter((a) => a.selected)
      );
      selectedAccessories.forEach((a, idx) => {
        const aqty = Number(a.qty || 1);
        const ataxable = Math.max(
          0,
          (toNonNegativeAmount(a.price) - toNonNegativeAmount(a.discount)) * aqty
        );
        const accessoryTaxRate = gstEnabled ? Number(a.gst_percent || 0) / 100 : 0;
        const accessoryTax =
          accessoryTaxRate <= 0
            ? 0
            : taxMode === 'inclusive'
              ? ataxable - ataxable / (1 + accessoryTaxRate)
              : ataxable * accessoryTaxRate;
        const g = givenRentBooleansFromStatus(a.accessory_order_status);
        const handedOver = isCounterHandoverAccessory(a);
        items.push({
          id: a.persisted_id || undefined,
          item_type: 'accessory',
          parent_line_id: line.line_id,
          accessory_id: a.accessory_id,
          name_snapshot: a.name_snapshot,
          qty: aqty,
          price: toNonNegativeAmount(a.price),
          discount: toNonNegativeAmount(a.discount),
          tax: round2(accessoryTax),
          type: a.type || 'rent',
          given_with_rent: g.given_with_rent,
          pack_with_rent: g.pack_with_rent,
          remarks: String(a.remarks || '').trim().slice(0, 500) || null,
          display_order: compositeAccessoryDisplayOrder(a, idx),
          ...(handedOver && !a.persisted_id
            ? { stage_flags: defaultHandedOverAccessoryStageFlags() }
            : buildPersistedAccessoryStageFlagsPayload(a)),
        });
      });
    }

    const { date: bookingDate, time: bookingTime } = splitDatetimeLocal(bookingDateTime);
    const bookingTime24 =
      bookingTime || splitDatetimeLocal(nowDatetimeLocal()).time || normalizeOrderTime('00:00');
    const normalizedBookingTime = normalizeBookingTime(bookingTime24);

    const payload = {
      customer_id: customer.id,
      order_type: deriveOrderType(lines),
      ...(isEditMode ? {} : { status: 'booked' }),
      booking_date: bookingDate,
      booking_time: normalizedBookingTime,
      pickup_date: pickupDate,
      return_date: returnDate || null,
      delivery_time: normalizeTime12(pickupTime) || defaultBookingTimes.delivery,
      return_time: normalizeTime12(returnTime) || defaultBookingTimes.return,
      reference_name: referenceName || null,
      pickup_name: contactNo2SameAsPhone1
        ? customerName || null
        : String(contact2Name || '').trim().slice(0, 200) || null,
      pickup_number: effectiveContactNo2 || null,
      contact_phone1: customerPhone1 || null,
      contact_address: String(address || '').trim() || null,
      customer_notes: customerNotes || null,
      next_booking_gap_days: Math.max(0, Math.floor(Number(nextBookingGapDaysInput) || 0)),
      previous_booking_gap_days: Math.max(0, Math.floor(Number(previousBookingGapDaysInput) || 0)),
      bill_type: gstEnabled ? 'gst' : 'kaccha',
      gst_enabled: gstEnabled,
      igst_bill: igstBill,
      tax_mode: taxMode,
      advance_account_id: advanceAccountId || null,
      security_account_id: securityAccountId || null,
      booking_discount_type: bookingDiscountType,
      booking_discount_value: toNonNegativeAmount(bookingDiscountValue),
      items,
    };
    if (isEditMode && wasDeliveredEditRef.current && deliveredEditAdminPassword) {
      payload.admin_password = deliveredEditAdminPassword;
    }
    if (isEditMode && wasReconcileRef.current && reconcileAdminPassword) {
      payload.reconcile = true;
      payload.admin_password = reconcileAdminPassword;
    }
    if (!isEditMode) {
      payload.advance_amount = advAmt;
      payload.paid_security_amt = paidSecurityAmt;
      payload.deposit_amount = expectedSecurity;
      const creditApply = applyCustomerCredit ? toNonNegativeAmount(applyCreditAmount) : 0;
      if (creditApply > 0) {
        payload.apply_credit_amount = creditApply;
        if (creditLookupPhone1) payload.credit_lookup_phone1 = creditLookupPhone1;
        if (creditLookupPhone2) payload.credit_lookup_phone2 = creditLookupPhone2;
      }
    }
    if (isEditMode && editOrder) {
      payload.expected_product_lines = editExpectedProductsRef.current;
      if (editSettlement) payload.edit_settlement = editSettlement;
    }

    sendAfterCreateRef.current = null;
    const waTemplateKey = isEditMode ? 'UPDATE_BOOKING' : 'CREATE_BOOKING';
    const waActionLabel = isEditMode ? 'Update booking' : 'Save booking';
    const waNoPhoneMsg = isEditMode
      ? 'Customer has no WhatsApp number. Booking will be updated without message.'
      : 'Customer has no WhatsApp number. Booking will be saved without message.';
    const waNotConnectedMsg = isEditMode
      ? 'WhatsApp is not connected. Booking will be updated without message.'
      : 'WhatsApp is not connected. Booking will be saved without message.';

    const choice = await wa.confirmBeforeAction({
      templateKey: waTemplateKey,
      phone: resolvedWhatsapp,
      customer,
      actionLabel: waActionLabel,
    });
    if (choice === 'send') {
      sendAfterCreateRef.current = 'send';
    } else if (choice === 'skip') {
      sendAfterCreateRef.current = 'skip';
    } else if (choice === 'no_phone') {
      toast.warning(waNoPhoneMsg);
    } else if (choice === 'not_connected') {
      toast.info(waNotConnectedMsg);
    }

    saveMutation.mutate(payload, {
      onSettled: () => {
        releaseSubmitLock();
      },
    });
    } catch (err) {
      releaseSubmitLock();
      toast.error(err?.message || 'Could not save booking');
    }
  };

  useLayoutEffect(() => {
    if (isEditMode) return;
    let parsed;
    try {
      const raw = sessionStorage.getItem('wrs.quickBillDraft');
      if (!raw) return;
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const draftCart = Array.isArray(parsed.cart) ? parsed.cart : [];
    if (draftCart.length === 0) return;

    skipDraftPersistRef.current = true;
    quickBillHandoffAppliedRef.current = true;

    if (parsed.customer && typeof parsed.customer === 'object') pickCustomer(parsed.customer);
    setQuickBillDraftIds(Array.isArray(parsed.draft_ids) ? parsed.draft_ids.filter(Boolean) : []);

    // Map common date/time values from quick-bill handoff so booking opens with
    // the same rental window selected in Availability.
    const first = draftCart[0] || null;
    if (first?.from) setPickupDate(first.from);
    if (first?.to) setReturnDate(first.to);
    if (first?.delivery_time) setPickupTime(first.delivery_time);
    if (first?.return_time) setReturnTime(first.return_time);

    const draftLines = normalizeBookingLinesFromDraft(
      draftCart.map((line) => ({
        line_id: createLocalId(),
        product_id: line.product_id,
        code_snapshot: line.code || line.code_snapshot || '',
        name_snapshot: line.name || line.name_snapshot || '',
        main_image: line.main_image || null,
        qty: Math.max(1, Number(line.qty) || 1),
        price: Number(line.price ?? line.price_rent ?? 0) || 0,
        discount: Number(line.discount || 0) || 0,
        type: line.type || 'rent',
        category_id: line.category_id || null,
        tailor_notes: String(line.tailor_notes || '').trim().slice(0, 500),
        tailor_note_image: String(line.tailor_note_image || '').trim().slice(0, 500),
        gap_days: 0,
        next_available_date: null,
        accessories: line.accessories,
        ...salesPersonFromAvailabilityCartLine(line),
      }))
    );
    setLines(draftLines);
    // Quick Bill: load recommendations and apply accessories chosen in Availability cart.
    Promise.all(
      draftLines.map(async (line) => {
        if (!line.product_id) return line;
        const savedAcc = Array.isArray(line.accessories) ? line.accessories : [];
        const rec = await fetchRecommendedAccessories({
          id: line.product_id,
          category_id: line.category_id || null,
        });
        const catalog = toAccessoryLines(rec);
        return {
          ...line,
          accessories: mergeSavedCartAccessoriesWithCatalog(catalog, savedAcc),
        };
      })
    )
      .then((enriched) => setLines(enriched))
      .catch(() => {
        /* keep base lines if recommendation fetch fails */
      });

    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
    }, 600);
    // Keep wrs.quickBillDraft until booking is saved (cleared in saveMutation onSuccess).
  }, [isEditMode]);

  useLayoutEffect(() => {
    if (isEditMode) return;
    const handoff = readCustomOrderBookingHandoff();
    if (!handoff?.custom_order_id || !handoff?.product_id) return;

    skipDraftPersistRef.current = true;
    customOrderHandoffAppliedRef.current = true;
    customOrderHandoffIdRef.current = handoff.custom_order_id;

    const c = handoff.customer || {};
    const applyHandoffCustomerSnapshot = (masterCustomer = null) => {
      if (masterCustomer?.id) {
        setCustomer({
          id: masterCustomer.id,
          name: c.name || masterCustomer.name || '',
          phone1: c.phone1 || masterCustomer.phone1 || '',
          phone2: c.phone2 || masterCustomer.phone2 || '',
          phone2_name: c.phone2_name || masterCustomer.phone2_name || '',
          whatsapp: c.whatsapp || masterCustomer.whatsapp || '',
          address: c.address || masterCustomer.address || '',
        });
      } else {
        setCustomer(null);
      }
      setEditingCustomerName(!String(c.name || '').trim());
      setCustomerQuery(c.name || '');
      setContactNo1(normalizePhone(c.phone1 || ''));
      setContact2Name(String(c.phone2_name || '').slice(0, 60));
      setContactNo2(c.phone2 || '');
      setContactNo2SameAsPhone1(
        !!String(c.phone1 || '').trim() &&
          String(c.phone2 || '').trim() === String(c.phone1 || '').trim()
      );
      setAddress(c.address || '');
      setWhatsappSource(c.whatsapp_source || 'phone1');
      setWhatsappManual(phoneInputDigits(c.whatsapp || ''));
      setCustomerOpen(false);
      clearFieldError(setFieldErrors, 'customer');
      clearFieldError(setFieldErrors, 'customerName');
    };

    resolveHandoffCustomer(c)
      .then(async (result) => {
        applyHandoffCustomerSnapshot(result?.customer || null);
        if (result?.customer?.id && !c.id) {
          linkHandoffCustomerToCustomOrder(handoff.custom_order_id, result.customer.id);
        }
        if (result?.created) {
          await invalidateCustomersDomain(queryClient);
        }
      })
      .catch(() => {
        toast.warning('Could not resolve customer from custom order');
        applyHandoffCustomerSnapshot(null);
      });

    let handoffPickupDate = null;
    let handoffReturnDate = null;
    const handoffDeliveryDate = normalizeCustomOrderSqlDate(handoff.delivery_date);
    if (handoffDeliveryDate) {
      handoffPickupDate = handoffDeliveryDate >= todayISO ? handoffDeliveryDate : todayISO;
      setPickupDate(handoffPickupDate);
      const handoffReturnRaw = normalizeCustomOrderSqlDate(handoff.return_date);
      handoffReturnDate =
        handoffReturnRaw && handoffReturnRaw >= handoffPickupDate
          ? handoffReturnRaw
          : addDaysISO(handoffPickupDate, returnOffsetDays);
      setReturnDate(handoffReturnDate);
    }

    const fin = handoff.financial || {};
    if (fin.gst_enabled != null) setGstEnabled(!!fin.gst_enabled);
    if (fin.igst_bill != null) setIgstBill(!!fin.igst_bill);
    if (fin.tax_mode) setTaxMode(fin.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive');
    setBookingDiscountType(fin.booking_discount_type === 'percent' ? 'percent' : 'flat');
    setBookingDiscountValue(toNonNegativeAmount(fin.booking_discount_value));
    setAdvanceAmount(toNonNegativeAmount(fin.advance_amount));
    setAdvanceAccountId(fin.advance_account_id || '');
    setDeposit(toNonNegativeAmount(fin.deposit_amount));
    setPaidSecurityAmt(!!fin.paid_security_amt);
    setSecurityAccountId(fin.security_account_id || '');
    const handoffCredit = toNonNegativeAmount(fin.apply_credit_amount);
    if (handoffCredit > 0) {
      setApplyCustomerCredit(true);
      setApplyCreditAmount(String(handoffCredit));
    } else {
      setApplyCustomerCredit(false);
      setApplyCreditAmount('');
    }

    const tailorNotes = String(handoff.tailor_notes || handoff.remarks || '').trim().slice(0, 500);
    const handoffLinePrice = toNonNegativeAmount(fin.price);
    const handoffLineDiscount = toNonNegativeAmount(fin.line_discount);

    productsApi
      .get(handoff.product_id)
      .then(async (resp) => {
        const product = resp?.data;
        if (!product?.id) return;
        const from = normalizeCustomOrderSqlDate(handoffPickupDate || pickupDate) || todayISO;
        const to =
          normalizeCustomOrderSqlDate(handoffReturnDate || returnDate) ||
          addDaysISO(from, returnOffsetDays);
        let freeQty = Number(product.qty || 1);
        try {
          const availability = await productsApi.checkAvailability({
            product_id: product.id,
            from,
            to,
            qty: 1,
          });
          const data = availability?.data || {};
          if (data.free_qty != null) freeQty = Number(data.free_qty);
        } catch {
          /* use catalog qty */
        }
        const rec = await fetchRecommendedAccessories(
          {
            id: product.id,
            category_id: product.category_id || '',
          },
          { from, to }
        );
        const accessoryLines = toAccessoryLines(rec).filter((a) => a.selected);
        setLines([
          {
            line_id: createLocalId(),
            product_id: product.id,
            code_snapshot: product.code || handoff.product_code,
            name_snapshot: product.name || handoff.product_name,
            main_image: product.main_image || null,
            qty: 1,
            price:
              handoffLinePrice > 0
                ? handoffLinePrice
                : catalogPriceForType(product, getDefaultProductLineType(product)),
            discount: handoffLineDiscount,
            gst_percent: gstEnabled ? gstDefaultRate : 0,
            type:
              fin.order_type === 'sell'
                ? 'sell'
                : getDefaultProductLineType(product),
            category_id: product.category_id || null,
            total_qty: Number(product.qty || 0),
            free_qty: freeQty,
            booked_qty: 0,
            in_delivery_qty: 0,
            return_pending_qty: 0,
            washing_qty: 0,
            repair_qty: 0,
            next_available_date: null,
            gap_days: 0,
            tailor_notes: tailorNotes,
            tailor_note_image: '',
            sales_person_id: isSalesmanEligibleUser(currentUser) ? currentUser.id : null,
            sales_person_name: isSalesmanEligibleUser(currentUser)
              ? String(currentUser?.name || currentUser?.email || '').trim()
              : '',
            accessories: accessoryLines,
          },
        ]);
      })
      .catch(() => {
        toast.warning('Could not load product from custom order');
      });

    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
    }, 600);
  }, [isEditMode]);

  useEffect(() => {
    if (isEditMode) return;
    if (location.state?.fromCustomOrder) {
      draftHydrateDoneRef.current = true;
      return;
    }
    const fresh = location.state?.fresh;
    if (fresh == null || fresh === lastHandledFreshRef.current) return;

    lastHandledFreshRef.current = fresh;
    quickBillHandoffAppliedRef.current = false;
    customOrderHandoffAppliedRef.current = false;
    customOrderHandoffIdRef.current = null;
    try {
      sessionStorage.removeItem('wrs.quickBillDraft');
      clearCustomOrderBookingHandoff();
    } catch {
      /* ignore */
    }
    releaseSubmitLock();
    setCustomerOpen(false);
    setProductOpen(false);
    setFieldErrors({});

    skipDraftPersistRef.current = true;
    justStartedBlankDraftRef.current = true;
    persistActiveDraftStorageKey(null);
    bookingDraftIdRef.current = null;
    setBookingDraftId(null);
    applyBookingDraftSnapshot(getBlankBookingSnapshot());
    draftHydrateDoneRef.current = true;

    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
      justStartedBlankDraftRef.current = false;
    }, 1200);
  }, [
    isEditMode,
    location.state?.fresh,
    releaseSubmitLock,
    applyBookingDraftSnapshot,
    getBlankBookingSnapshot,
  ]);

  useEffect(() => {
    if (isEditMode) return;
    if (draftHydrateDoneRef.current) return;

    if (quickBillHandoffAppliedRef.current || customOrderHandoffAppliedRef.current) {
      draftHydrateDoneRef.current = true;
      return;
    }

    const activeId = getActiveDraftId();
    if (!activeId) {
      setBookingDateTime(nowDatetimeLocal());
      draftHydrateDoneRef.current = true;
      return;
    }
    const list = readDraftList();
    const row = list.find((d) => d.id === activeId);
    if (!row?.snapshot) {
      draftHydrateDoneRef.current = true;
      return;
    }

    skipDraftPersistRef.current = true;
    applyBookingDraftSnapshot(row.snapshot);
    bookingDraftIdRef.current = activeId;
    setBookingDraftId(activeId);

    if (row.snapshot?.customer?.id) {
      const snap = row.snapshot;
      customersApi
        .get(snap.customer.id)
        .then((resp) => {
          applyCustomerFromApiWithSnapshot(resp?.data || null, snap);
        })
        .catch(() => {
          /* keep snapshot customer */
        });
    }

    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
    }, 600);
    draftHydrateDoneRef.current = true;
  }, [isEditMode, applyBookingDraftSnapshot, applyCustomerFromApiWithSnapshot]);

  useEffect(() => {
    if (!isEditMode) return;
    const order = editOrderQuery.data;
    if (!order) return;
    const oid = String(order.id);
    if (editHydratedForOrderIdRef.current === oid) return;
    editHydratedForOrderIdRef.current = oid;
    editExpectedProductsRef.current = (order.items || []).map((item) => ({
      item_id: item.id, expected_product_id: item.product_id || null,
      expected_line_version: Number(item.replacement_version || 0),
    }));
    setInitializingEdit(true);
    if (order.booking_time) {
      setBookingDateTime(
        toDatetimeLocalValue(order.booking_date, order.booking_time) || nowDatetimeLocal()
      );
    } else {
      const createdAt = order.created_at ? new Date(order.created_at) : null;
      const createdParts = createdAt && !Number.isNaN(createdAt.getTime())
        ? getIndiaDateTimeParts(createdAt)
        : null;
      const createdTime = createdParts
        ? normalizeOrderTime(`${createdParts.hour}:${createdParts.minute}`)
        : splitDatetimeLocal(nowDatetimeLocal()).time;
      setBookingDateTime(
        toDatetimeLocalValue(order.booking_date, createdTime) || nowDatetimeLocal()
      );
    }
    const loadedPickup = toDateInputValue(order.pickup_date) || todayISO;
    const loadedReturn =
      toDateInputValue(order.return_date) || addDaysISO(todayISO, returnOffsetDays);
    editOriginalPickupRef.current = toDateInputValue(order.pickup_date) || null;
    editOriginalReturnRef.current = toDateInputValue(order.return_date) || null;
    setPickupDate(loadedPickup);
    setReturnDate(loadedReturn);
    setPickupTime(formatOrderTime12(order.delivery_time) || defaultBookingTimes.delivery);
    setReturnTime(formatOrderTime12(order.return_time) || defaultBookingTimes.return);
    setReferenceName(order.reference_name || '');
    setWhatsappSource('phone1');
    setWhatsappManual('');
    setCustomerNotes(order.customer_notes || '');
    setIgstBill(!!order.igst_bill);
    setGstEnabled(order.gst_enabled !== false);
    setTaxMode(order.tax_total > 0 && Number(order.total_amount || 0) === Number(order.subtotal || 0) ? 'inclusive' : 'exclusive');
    setNextBookingGapDaysInput(String(order.next_booking_gap_days || 0));
    setPreviousBookingGapDaysInput(String(order.previous_booking_gap_days || 0));
    setBookingDiscountType(order.booking_discount_type || 'flat');
    setBookingDiscountValue(toNonNegativeAmount(order.booking_discount_value || 0));
    setAdvanceAccountId(order.advance_account_id || '');
    setSecurityAccountId(order.security_account_id || '');
    const payments = Array.isArray(order.payments) ? order.payments : [];
    const advNet = netAdvanceFromPayments(payments);
    initialEditAdvanceNetRef.current = advNet;
    const depNet = round2(
      order.ordinary_security_net ?? Math.max(0, sumPaymentsByCategory(payments, 'deposit') - sumPaymentsByCategory(payments, 'deposit_refund'))
    );
    editFinancialBaselineRef.current = { advance: advNet, securityNet: depNet, depositAmount: toNonNegativeAmount(order.deposit_amount || 0), paid: depNet > 0 };
    setAdvanceAmount(toNonNegativeAmount(advNet));
    setDeposit(toNonNegativeAmount(order.deposit_amount || 0));
    setPaidSecurityAmt(depNet > 0);
    const hydrated = hydrateLinesFromOrder(order);
    const availFrom = toDateInputValue(order.pickup_date) || todayISO;
    const availTo = toDateInputValue(order.return_date) || availFrom;

    const linesReady = refreshRentAccessoryLinesAvailability(
      hydrated,
      {
        from: availFrom,
        to: availTo,
        excludeOrderId: order.id,
      },
      { grandfatherPersisted: true }
    )
      .then(({ lines: withAccessories }) =>
        refreshRentLinesAvailability(withAccessories, {
          from: availFrom,
          to: availTo,
          excludeOrderId: order.id,
        })
      )
      .then((refreshed) => {
        setLines(refreshed);
      })
      .catch(() => {
        setLines(hydrated);
      });

    const finishInitializingEdit = () => {
      linesReady.finally(() => setInitializingEdit(false));
    };

    if (order.customer_id) {
      const embedded = order.customer || null;
      const applyFull = (full) => {
        if (!full) return;
        setCustomer(full);
        setEditingCustomerName(!String(full.name || '').trim());
        setCustomerQuery(full.name || '');
        const hydrated = hydrateBookingCustomerFields(full, order);
        setAddress(hydrated.address);
        setContactNo1(hydrated.contactNo1);
        setContact2Name(hydrated.contact2Name);
        setContactNo2(hydrated.contactNo2);
        setContactNo2SameAsPhone1(hydrated.contactNo2SameAsPhone1);
        setWhatsappSource(hydrated.whatsappSource);
        setWhatsappManual(hydrated.whatsappManual);
      };

      if (embedded && embedded.id) {
        applyFull(embedded);
        queryClient.setQueryData(['customer', embedded.id], { data: embedded });
        finishInitializingEdit();
      } else {
        customersApi
          .get(order.customer_id)
          .then((resp) => applyFull(resp?.data || null))
          .catch(() => {
            /* ignore detail fetch errors */
          })
          .finally(finishInitializingEdit);
      }
    } else {
      setCustomer(null);
      setEditingCustomerName(false);
      setCustomerQuery('');
      setContactNo1('');
      setContact2Name('');
      setContactNo2('');
      setWhatsappSource('phone1');
      setWhatsappManual('');
      setAddress('');
      finishInitializingEdit();
    }
  }, [isEditMode, editOrderQuery.data, queryClient]);

  useEffect(() => {
    if (initializingEdit) return;
    if (!pickupDate || !returnDate) return;
    const hasRentProduct = linesRef.current.some(
      (line) =>
        line.line_kind !== 'standalone_accessory' &&
        String(line.type || 'rent').toLowerCase() !== 'sell' &&
        line.product_id
    );
    const hasRentAccessory = linesRef.current.some((line) => {
      if (line.line_kind === 'standalone_accessory') return isRentAccessoryLine(line);
      return (line.accessories || []).some(
        (a) => a.accessory_id && String(a.type || 'rent').toLowerCase() !== 'sell'
      );
    });
    if (!hasRentProduct && !hasRentAccessory) return;

    const timer = window.setTimeout(() => {
      const windowOpts = {
        from: pickupDate,
        to: returnDate,
        excludeOrderId: isEditMode ? orderId : undefined,
      };
      let chain = Promise.resolve(linesRef.current);
      if (hasRentAccessory) {
        chain = chain.then(async (current) => {
          const { lines: refreshed, deselectedNames } = await refreshRentAccessoryLinesAvailability(
            current,
            windowOpts,
            { grandfatherPersisted: isEditMode }
          );
          if (deselectedNames.length > 0) {
            const uniq = [...new Set(deselectedNames)];
            toast.warning(
              uniq.length === 1
                ? `${uniq[0]} is no longer available and was removed from accessories`
                : `${uniq.length} accessories are no longer available and were removed`
            );
          }
          return refreshed;
        });
      }
      if (hasRentProduct) {
        chain = chain.then((current) => refreshRentLinesAvailability(current, windowOpts));
      }
      chain.then((refreshed) => setLines(refreshed));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [pickupDate, returnDate, initializingEdit, isEditMode, orderId]);

  useEffect(() => {
    if (isEditMode || appSettings.isLoading) return;
    const safe = Math.max(0, Math.floor(gapDaysDefault));
    setNextBookingGapDaysInput((prev) => (prev === '' ? String(safe) : prev));
  }, [isEditMode, appSettings.isLoading, gapDaysDefault]);

  useEffect(() => {
    if (isEditMode || appSettings.isLoading) return;
    const safe = Math.max(0, Math.floor(previousGapDaysDefault));
    setPreviousBookingGapDaysInput((prev) => (prev === '' ? String(safe) : prev));
  }, [isEditMode, appSettings.isLoading, previousGapDaysDefault]);

  useEffect(() => {
    if (isEditMode || defaultTimesAppliedRef.current) return;
    if (!timeSlotsQuery.isSuccess) return;
    defaultTimesAppliedRef.current = true;
    setPickupTime(defaultBookingTimes.delivery);
    setReturnTime(defaultBookingTimes.return);
  }, [
    isEditMode,
    timeSlotsQuery.isSuccess,
    defaultBookingTimes.delivery,
    defaultBookingTimes.return,
  ]);

  useEffect(() => {
    if (isEditMode || appSettings.isLoading) return;
    const { enabled, default_rate: defaultRate } = appSettings.gst;
    setGstEnabled(enabled);
    setGstDefaultRate(defaultRate);
    if (!enabled) setIgstBill(false);
  }, [isEditMode, appSettings.isLoading, appSettings.gst]);

  useEffect(() => {
    if (isEditMode) return;
    const t = setTimeout(() => {
      flushBookingDraftToStorage();
    }, 900);
    return () => clearTimeout(t);
  }, [isEditMode, buildBookingDraftSnapshot, flushBookingDraftToStorage]);

  const draftSavedTimeLabel = useMemo(() => {
    if (!lastDraftSavedAt) return '';
    return formatDateTime(lastDraftSavedAt) || '';
  }, [lastDraftSavedAt]);

  const handleManualSaveDraft = useCallback(() => {
    if (flushBookingDraftToStorage()) {
      toast.success('Draft saved on this device');
    } else {
      toast.info('Enter booking details (customer, contact, items, or notes) to save a draft.');
    }
  }, [flushBookingDraftToStorage]);

  useEffect(() => {
    if (isEditMode) return;
    const token = location.state?.startNewDraft;
    if (token == null || token === lastHandledStartNewDraftRef.current) return;
    lastHandledStartNewDraftRef.current = token;
    const id = window.setTimeout(() => {
      handleStartNewBookingDraft();
    }, 80);
    return () => window.clearTimeout(id);
  }, [isEditMode, location.state?.startNewDraft, handleStartNewBookingDraft]);

  useEffect(() => {
    if (isEditMode) return;
    const token = location.state?.manualSaveDraft;
    if (token == null || token === lastHandledManualSaveRef.current) return;
    lastHandledManualSaveRef.current = token;
    const id = window.setTimeout(() => {
      handleManualSaveDraft();
    }, 700);
    return () => window.clearTimeout(id);
  }, [isEditMode, location.state?.manualSaveDraft, handleManualSaveDraft]);

  return (
    <>
      {editingReconcileOrder ? (
        <div className="card p-3 mb-3 border-brand/30 bg-brand-light/30 text-sm text-gray-900">
          <p className="font-medium">
            Reconciling cancelled booking
            {editBookingNumber ? (
              <span className="font-mono text-brand"> · {editBookingNumber}</span>
            ) : null}
          </p>
          <p className="mt-1 text-gray-700">
            Verify delivery and return dates and that all rent products and accessories are available
            before saving. The booking will return to Booked status with checklist stages reset.
          </p>
        </div>
      ) : null}

      {editingReconcileOrder && reconcileSoldBlocked.length > 0 ? (
        <div className="card p-3 mb-3 border-red-200 bg-red-50 text-sm text-red-800">
          <p className="font-medium">Cannot reconcile — product already sold</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {reconcileSoldBlocked.map((entry) => (
              <li key={entry.productId}>
                {entry.label} is already sold. Remove it from this booking or you cannot reconcile.
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editingDeliveredOrder ? (
        <div className="card p-3 mb-3 border-amber-200 bg-amber-50 text-sm text-amber-950">
          <p className="font-medium">
            Delivered booking — admin edit
            {editBookingNumber ? (
              <span className="font-mono text-amber-900"> · {editBookingNumber}</span>
            ) : null}
          </p>
          <p className="mt-1 text-amber-900/90">
            After you save, checklist stages reset only for newly added products and accessories. Items
            already collected or delivered stay as they were. The booking status may move back (e.g. to
            Booked) until the new lines are prepared and delivered. Payments already recorded are kept;
            pending balance is recalculated from the new order total.
          </p>
        </div>
      ) : null}

      <PageHeader
        title={
          isEditMode
            ? editingReconcileOrder && editBookingNumber
              ? `Reconcile booking · ${editBookingNumber}`
              : editBookingNumber
                ? `Edit Booking · ${editBookingNumber}`
                : editingReconcileOrder
                  ? 'Reconcile booking'
                  : 'Edit Booking'
            : 'Create Booking'
        }
        description={
          isEditMode
            ? editBookingNumber
              ? `Editing booking ${editBookingNumber}. Products with optional suggested accessories.`
              : editOrderQuery.isLoading
                ? 'Loading booking…'
                : 'Products with optional suggested accessories'
            : 'Products with optional suggested accessories. Drafts save on this device. Use New draft to save the current form and start another booking here.'
        }
        breadcrumbs={
          isEditMode
            ? [
                { label: 'Dashboard', to: '/' },
                { label: 'Booking', to: '/booking' },
                {
                  label: editBookingNumber || (editOrderQuery.isLoading ? 'Edit…' : 'Edit'),
                },
              ]
            : [
                { label: 'Dashboard', to: '/' },
                { label: 'Booking', to: '/booking' },
                { label: 'Create' },
              ]
        }
        actions={
          !isEditMode ? (
            <BookingDraftActions
              mode="embedded"
              activeDraftId={bookingDraftId}
              draftSavedTimeLabel={draftSavedTimeLabel}
              onSaveDraft={handleManualSaveDraft}
              onNewDraft={handleStartNewBookingDraft}
              onResumeDraft={handleResumeDraft}
              onDeleteDraft={handleDeleteStoredDraft}
            />
          ) : null
        }
      />

      {isEditMode && canViewLogs && orderId ? (
        <div className="mb-2">
          <BookingAuditBadge
            orderId={orderId}
            enabled
            onOpenFullLogs={() => setAuditLogsOpen(true)}
          />
        </div>
      ) : null}

      <div className="space-y-2 text-xs [&_.input]:h-8 [&_.input]:py-1 [&_.input]:px-2 [&_.input]:text-xs [&_.label]:mb-0.5 [&_.label]:text-[11px] [&_.btn-primary]:h-8 [&_.btn-primary]:px-3 [&_.btn-primary]:text-xs [&_.btn-secondary]:h-8 [&_.btn-secondary]:px-3 [&_.btn-secondary]:text-xs">
        <div className="card p-2.5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">Customer Details</h3>
            <div className="flex items-center gap-2">
              <div className="w-32">
                <Select
                  aria-label="Booking bill type"
                  value={gstEnabled ? 'gst' : 'kaccha'}
                  onChange={(event) => {
                    const enabled = event.target.value === 'gst';
                    setGstEnabled(enabled);
                    if (!enabled) setIgstBill(false);
                  }}
                  options={[
                    { value: 'kaccha', label: 'Kaccha Bill' },
                    { value: 'gst', label: 'GST Bill' },
                  ]}
                />
              </div>
              {gstEnabled ? (
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={igstBill}
                    onChange={(e) => setIgstBill(e.target.checked)}
                  />
                  IGST Bill
                </label>
              ) : null}
            </div>
          </div>

          <div ref={customerFieldRef} className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div ref={bookingDateTimeFieldRef}>
              <Input
                label="Booking date & time"
                type="datetime-local"
                value={bookingDateTime}
                error={err('bookingDateTime')}
                onChange={(e) => {
                  setBookingDateTime(e.target.value);
                  touch('bookingDateTime')();
                }}
              />
            </div>
            <div className="md:col-span-2 relative">
              {customer ? (
                missingCustomerName || editingCustomerName ? (
                  <Input
                    label="Customer Name*"
                    value={customer?.name || ''}
                    error={err('customerName')}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEditingCustomerName(true);
                      setCustomer((prev) => (prev ? { ...prev, name: next } : prev));
                      touch('customerName')();
                    }}
                    placeholder="Enter customer name"
                    maxLength={200}
                  />
                ) : (
                  <div>
                    <div className="label">Customer Name*</div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        navigate(
                          `/customers/${customer.id}/edit?returnTo=${encodeURIComponent(
                            isEditMode ? `/booking/${orderId}/edit` : '/booking/new'
                          )}`
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(
                            `/customers/${customer.id}/edit?returnTo=${encodeURIComponent(
                              isEditMode ? `/booking/${orderId}/edit` : '/booking/new'
                            )}`
                          );
                        }
                      }}
                      className={clsx(
                        'w-full h-8 border rounded-md px-2 flex items-center justify-between gap-2 text-left',
                        err('customerName')
                          ? 'border-red-400 bg-red-50/50'
                          : 'border-brand/40 bg-brand-light/40 hover:bg-brand-light/60'
                      )}
                      title="Open customer details"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-gray-900 truncate">{customer.name}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCustomer(null);
                          setContactNo1('');
                          setContact2Name('');
                          setContactNo2('');
                          setContactNo2SameAsPhone1(false);
                          setCustomerOpen(true);
                        }}
                        className="text-xs text-brand hover:underline shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  </div>
                )
              ) : (
                <Input
                  label="Customer Name*"
                  placeholder="Search by name or mobile"
                  value={customerQuery}
                  error={err('customer') || err('customerName')}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setCustomerOpen(true);
                    touch('customer')();
                    touch('customerName')();
                  }}
                  onFocus={() => setCustomerOpen(true)}
                  onBlur={() => window.setTimeout(() => setCustomerOpen(false), 120)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const rows = customerResults?.data || [];
                    const q = customerQuery.trim().toLowerCase();
                    const exact = rows.find(
                      (c) =>
                        String(c.name || '').trim().toLowerCase() === q ||
                        String(c.phone1 || '').trim().toLowerCase() === q
                    );
                    if (exact) {
                      pickCustomer(exact);
                      return;
                    }
                    if (rows.length === 0) {
                      tryInlineCreateCustomerFromSearch();
                    }
                  }}
                />
              )}
              {!customer &&
              customerOpen &&
              customerQuery.trim().length >= 2 ? (
                <div className="absolute z-20 left-0 right-0 mt-1 border border-gray-200 rounded-md max-h-48 overflow-auto bg-white shadow-lg">
                  {(customerResults?.data || []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
                  ) : (
                    (customerResults?.data || []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickCustomer(c)}
                        className="w-full flex items-center justify-between text-xs px-3 py-2 hover:bg-gray-50 text-left border-b border-gray-100"
                      >
                        <span className="font-medium text-gray-800">{c.name}</span>
                        <span className="text-xs text-gray-500">{c.phone1 || 'No phone'}</span>
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => tryInlineCreateCustomerFromSearch()}
                    disabled={quickCustomerCreateMutation.isPending}
                    className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 bg-brand-light/40 hover:bg-brand-light text-brand flex items-center gap-2 disabled:opacity-50"
                  >
                    <Plus size={14} aria-hidden />
                    <span className="font-medium">
                      Create new customer
                      {customerQuery.trim() ? ` “${customerQuery.trim()}”` : ''}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <Input
              label="Contact No.1*"
              value={contactNo1}
              error={err('contactNo1')}
              onChange={(e) => {
                setContactNo1(phoneInputDigits(e.target.value));
                touch('contactNo1')();
              }}
              placeholder="10-digit mobile"
              inputMode="numeric"
              maxLength={10}
            />
            <div className="min-w-0">
              <Input
                label="Contact No.2*"
                value={effectiveContactNo2}
                error={err('contactNo2')}
                onChange={(e) => {
                  setContactNo2(phoneInputDigits(e.target.value));
                  touch('contactNo2')();
                }}
                disabled={contactNo2SameAsPhone1}
                placeholder="10-digit mobile"
                inputMode="numeric"
                maxLength={10}
              />
              <label className="mt-1 inline-flex items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={contactNo2SameAsPhone1}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setContactNo2SameAsPhone1(next);
                    touch('contactNo2')();
                    if (next) {
                      setContactNo2(normalizePhone(contactNo1));
                    } else {
                      setContact2Name('');
                    }
                  }}
                  disabled={!customerPhone1}
                />
                Same as Contact No.1
              </label>
            </div>
            <div className="min-w-0">
              <Input
                label="Contact No.2 name"
                value={contact2Name}
                onChange={(e) => setContact2Name(e.target.value.slice(0, 60))}
                disabled={contactNo2SameAsPhone1}
                placeholder={contactNo2SameAsPhone1 ? 'Same as customer name' : 'Optional'}
                maxLength={60}
              />
            </div>
            {!isEditMode && otherCustomersWithSamePhone.length > 0 ? (
              <div className="md:col-span-6 rounded-md border border-brand/30 bg-brand-light/40 px-3 py-2 text-sm text-gray-700">
                <p>
                  This number is also used by:{' '}
                  <span className="font-medium text-gray-900">
                    {otherCustomersWithSamePhone.map((c) => c.name || 'Unnamed customer').join(', ')}
                  </span>
                </p>
              </div>
            ) : null}
            <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-6 gap-2">
              <div className="md:col-span-2 min-w-0">
                <label htmlFor="booking-whatsapp-source" className="label">WhatsApp Number</label>
                <select
                  id="booking-whatsapp-source"
                  className={fieldShellClass(err('whatsapp'), 'input w-full')}
                  value={whatsappSource}
                  onChange={(e) => {
                    setWhatsappSource(e.target.value);
                    touch('whatsapp')();
                  }}
                >
                  <option value="phone1">Same as Phone Number 1</option>
                  <option value="phone2">Same as Phone Number 2</option>
                  <option value="manual">Other</option>
                </select>
              </div>
              {whatsappSource === 'manual' ? (
                <div className="md:col-span-2 min-w-0">
                  <Input
                    label="WhatsApp Number (Other)"
                    value={whatsappManual}
                    error={err('whatsapp')}
                    onChange={(e) => {
                      setWhatsappManual(phoneInputDigits(e.target.value));
                      touch('whatsapp')();
                    }}
                    placeholder="10-digit mobile"
                    inputMode="numeric"
                    maxLength={10}
                  />
                </div>
              ) : null}
              {err('whatsapp') && whatsappSource !== 'manual' ? (
                <p className="md:col-span-6 text-xs text-red-600">{err('whatsapp')}</p>
              ) : null}
              <div className={whatsappSource === 'manual' ? 'md:col-span-2 min-w-0' : 'md:col-span-4 min-w-0'}>
                <Input
                  label="Address"
                  required
                  value={address}
                  error={err('address')}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    touch('address')();
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div
          ref={linesCardRef}
          className={clsx(
            'card p-2.5',
            err('lines') && 'ring-1 ring-red-400 border-red-400'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wide">Products Added</h3>
          </div>
          {err('lines') ? <p className="text-xs text-red-600 mb-2">{err('lines')}</p> : null}

          <div className="flex w-full min-w-0 flex-wrap items-end gap-1.5 overflow-x-visible pb-0.5 sm:gap-2">
          <div ref={productCodeFieldRef} className="relative z-30 w-[9.5rem] shrink-0 sm:w-[10.5rem]">
              <Input
                ref={productSearchInputRef}
                label="Code*"
                value={productQuery}
                onChange={(e) => {
                  setProductQuery(e.target.value);
                  setSelectedProduct(null);
                  setProductOpen(true);
                  syncProductDropdownPos();
                }}
                onFocus={() => {
                  setProductOpen(true);
                  syncProductDropdownPos();
                }}
                onBlur={() => window.setTimeout(() => setProductOpen(false), 120)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (addAccessoryForLineId) {
                      e.preventDefault();
                      return;
                    }
                    e.preventDefault();
                    const firstAvailable = selectableProductMatches.find((p) =>
                      isProductBookableForSelection(p, lineQty)
                    );
                    if (firstAvailable) {
                      setSelectedProduct(firstAvailable);
                      setProductQuery(firstAvailable.code || firstAvailable.name || '');
                      setProductOpen(false);
                    } else {
                      toast.warning(
                        productMatches.length > 0
                          ? 'Matching products are already added in booking.'
                          : 'Product not available for selected dates.'
                      );
                    }
                  }
                  if (e.key === 'Escape') setProductOpen(false);
                }}
                placeholder="Name / Code"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setScannerOpen(true)}
                className="absolute right-1.5 bottom-1 p-1 rounded-md text-gray-500 hover:text-brand hover:bg-brand-light/60"
                title="Scan QR / Barcode"
                aria-label="Scan QR / Barcode"
              >
                <Camera size={16} />
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                disabled={!selectedProduct?.id}
                onClick={() => {
                  if (!selectedProduct?.id) return;
                  setHistoryProductSnapshot({
                    id: selectedProduct.id,
                    code: selectedProduct.code,
                    name: selectedProduct.name,
                    qty: selectedProduct.qty,
                    color: selectedProduct.color,
                    size: selectedProduct.size,
                  });
                  setHistoryOpen(true);
                }}
                className="absolute right-9 bottom-1 p-1 rounded-md text-gray-500 hover:text-brand hover:bg-brand-light/60 disabled:opacity-40 disabled:pointer-events-none"
                title="Product history"
                aria-label="Product history"
              >
                <History size={16} />
              </button>
              {allowProductAutocomplete &&
              productOpen &&
              productQuery.trim().length >= 1 &&
              productDropdownPos
                ? createPortal(
                <div
                  className="fixed z-[200] border border-gray-200 rounded-md max-h-56 overflow-auto divide-y divide-gray-100 bg-white shadow-md"
                  style={{
                    top: productDropdownPos.top,
                    left: productDropdownPos.left,
                    width: productDropdownPos.width,
                  }}
                >
                  {productAvailabilityQuery.isLoading || productSearchFallbackQuery.isLoading ? (
                    <div className="px-2 py-1.5 text-[11px] text-gray-500">Searching…</div>
                  ) : selectableProductMatches.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-gray-500">
                      {productMatches.length > 0
                        ? 'All matching products are already added.'
                        : `No products found for “${productQuery}”`}
                    </div>
                  ) : (
                    selectableProductMatches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`w-full px-2 py-1.5 text-left flex items-start gap-2 ${
                          isProductBookableForSelection(p, lineQty)
                            ? 'hover:bg-gray-50'
                            : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                        }`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (!isProductBookableForSelection(p, lineQty)) {
                            toast.warning('Product not available for selected delivery/return dates.');
                            return;
                          }
                          setSelectedProduct(p);
                          setProductQuery(p.code || p.name || '');
                          setProductOpen(false);
                        }}
                        title={
                          isProductBookableForSelection(p, lineQty)
                            ? ''
                            : p.next_available_date
                              ? `Not available (next: ${formatDate(p.next_available_date) || '-'})`
                              : 'Not available'
                        }
                      >
                        <SmartImage
                          src={p.main_image}
                          alt={p.name}
                          className="w-8 h-8 rounded border border-gray-100 bg-gray-50 object-contain shrink-0 mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-gray-800 truncate">{p.name}</div>
                          <div className="text-xs text-gray-500">
                            {p.code} · {formatCurrency(
                              catalogPriceForType(p, getDefaultProductLineType(p))
                            )}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {buildAvailabilityMeta(p, { includeReturnPending: false }) || '—'}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>,
                document.body
              )
                : null}
            </div>
             
            <div className="w-[3.5rem] shrink-0">
              <Input
                label="Qty"
                type="number"
                min={1}
                value={lineQty}
                onChange={(e) => setLineQty(e.target.value)}
                onFocus={selectIfZero}
              />
            </div>

            <div ref={pickupDateFieldRef} className="w-[8.25rem] shrink-0 sm:w-[8.5rem]">
              <Input
                label="Delivery Date*"
                type="date"
                min={todayISO}
                max={deliveryMax}
                value={pickupDate}
                error={err('pickupDate')}
                onChange={(e) => {
                  const nextPickup = e.target.value;
                  setPickupDate(nextPickup);
                  touch('pickupDate')();
                  if (nextPickup) {
                    setReturnDate(addDaysISO(nextPickup, returnOffsetDays));
                  } else {
                    setReturnDate('');
                  }
                }}
              />
            </div>
          
            <div className="w-[7.5rem] shrink-0 sm:w-[8rem]">
              <Select
                label="Delivery Time"
                value={pickupTime}
                error={err('pickupTime')}
                onChange={(e) => {
                  setPickupTime(e.target.value);
                  touch('pickupTime')();
                }}
                options={timeSelectOptions}
              />
            </div>
            
            <div ref={returnDateFieldRef} className="w-[8.25rem] shrink-0 sm:w-[8.5rem]">
              <Input
                label="Return Date*"
                type="date"
                panelAlign="end"
                min={pickupDate || todayISO}
                max={returnMax}
                value={returnDate}
                error={err('returnDate')}
                onChange={(e) => {
                  setReturnDate(e.target.value);
                  touch('returnDate')();
                }}
              />
            </div>
           
            <div className="w-[7.5rem] shrink-0 sm:w-[8rem]">
              <Select
                label="Return Time"
                value={returnTime}
                error={err('returnTime')}
                onChange={(e) => {
                  setReturnTime(e.target.value);
                  touch('returnTime')();
                }}
                options={timeSelectOptions}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              <Button
                type="button"
                className="h-8 min-w-0 flex-1 basis-0 px-2 sm:px-4"
                size="sm"
                onClick={handleAddProductLine}
                disabled={addingProductLine}
                loading={addingProductLine}
              >
                Add
              </Button>
              <Button
                type="button"
                className="h-8 min-w-0 flex-1 basis-0 px-2 sm:px-4"
                size="sm"
                variant="secondary"
                onClick={openAllAccessoriesModal}
              >
                Add Accessories
              </Button>
            </div>
          </div>
          {selectedProduct ? (
            <div className="mt-2 text-[11px] text-gray-600 border border-gray-200 rounded-md px-2 py-1.5 bg-gray-50 flex items-center gap-2">
              <SmartImage
                src={selectedProduct.main_image}
                alt={selectedProduct.name}
                className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
              />
              <div>
                <div className="text-xs font-medium text-gray-800">
                  {selectedProduct.name} <span className="font-mono text-xs text-gray-500">({selectedProduct.code})</span>
                </div>
                {buildAvailabilityMeta(selectedProduct, { includeReturnPending: true }) ? (
                  <div>Availability · {buildAvailabilityMeta(selectedProduct, { includeReturnPending: true })}</div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-2 overflow-x-auto border border-gray-200 rounded-md">
            <table className="table w-full text-xs">
              <thead>
                <tr>
                  {showLineReorder ? (
                    <>
                      <th className="w-7 px-0" aria-hidden />
                      <th className="text-center w-7 px-0">
                        <TableHeaderLabel align="center">#</TableHeaderLabel>
                      </th>
                    </>
                  ) : null}
                  <th className="text-left">
                    <TableHeaderLabel>Code</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Name</TableHeaderLabel>
                  </th>
                  <th className="text-left">
                    <TableHeaderLabel>Notes</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Rent</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Discount</TableHeaderLabel>
                  </th>
                  {gstEnabled ? (
                    <th className="text-right">
                      <TableHeaderLabel align="right">GST %</TableHeaderLabel>
                    </th>
                  ) : null}
                  <th className="text-right">
                    <TableHeaderLabel align="right">Taxable Rent</TableHeaderLabel>
                  </th>
                  {displaySalesman ? (
                    <th className="text-left min-w-[11rem]">
                      <TableHeaderLabel>Salesman</TableHeaderLabel>
                    </th>
                  ) : null}
                  <th className="text-center">
                    <TableHeaderLabel align="center">Accessories</TableHeaderLabel>
                  </th>
                  <th className="text-center">
                    <TableHeaderLabel align="center" nowrap>
                      Action
                    </TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={bookingTableColSpan} className="px-2 py-5 text-center text-gray-500">
                      Add a product, or use <span className="font-semibold text-gray-700">Add Accessories</span> for an
                      accessories-only bill.
                    </td>
                  </tr>
                ) : (
                  displayLines.map((line, displayIndex) => {
                    const linkedAccessories =
                      line.line_kind !== 'standalone_accessory'
                        ? sortAccessoriesRentThenSell(
                            (line.accessories || []).filter((a) => a.selected)
                          )
                        : [];
                    const isSaleOnlyProduct =
                      line.line_kind !== 'standalone_accessory' && productLineIsSaleOnly(line);
                    const lineInSaleSection =
                      line.line_kind === 'standalone_accessory'
                        ? String(line.type || 'rent') === 'sell'
                        : isSaleOnlyProduct;
                    const prevLine = displayIndex > 0 ? displayLines[displayIndex - 1] : null;
                    const prevInSaleSection = prevLine
                      ? prevLine.line_kind === 'standalone_accessory'
                        ? String(prevLine.type || 'rent') === 'sell'
                        : productLineIsSaleOnly(prevLine)
                      : false;
                    const showSaleDivider =
                      showSaleSectionDivider &&
                      lineInSaleSection &&
                      displayIndex > 0 &&
                      !prevInSaleSection;
                    return (
                    <Fragment key={line.line_id}>
                    {showSaleDivider ? (
                      <tr className="bg-gray-100">
                        <td
                          colSpan={bookingTableColSpan}
                          className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-700"
                        >
                          Sale items
                        </td>
                      </tr>
                    ) : null}
                    <tr
                      className={clsx(
                        isSaleOnlyProduct ? 'bg-brand-light/30' : 'bg-white',
                        dragTarget?.kind === 'line' &&
                          dragTarget.lineId === line.line_id &&
                          'opacity-50',
                        dropTarget?.kind === 'line' &&
                          dropTarget.lineId === line.line_id &&
                          dragTarget?.kind === 'line' &&
                          dragTarget.lineId !== line.line_id &&
                          'border-t-2 border-brand',
                        dropTarget?.kind === 'product' &&
                          dropTarget.parentLineId === line.line_id &&
                          dragTarget?.kind === 'accessory' &&
                          line.line_kind !== 'standalone_accessory' &&
                          'ring-1 ring-inset ring-brand'
                      )}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (line.line_kind === 'standalone_accessory') return;
                        if (dragTarget?.kind === 'accessory') {
                          setDropTarget({ kind: 'product', parentLineId: line.line_id });
                        } else if (
                          dragTarget?.kind === 'line' &&
                          dragTarget.lineId !== line.line_id &&
                          showLineReorder
                        ) {
                          setDropTarget({ kind: 'line', lineId: line.line_id });
                        }
                      }}
                      onDragLeave={() => {
                        if (
                          dropTarget?.kind === 'line' &&
                          dropTarget.lineId === line.line_id
                        ) {
                          setDropTarget(null);
                        }
                        if (
                          dropTarget?.kind === 'product' &&
                          dropTarget.parentLineId === line.line_id
                        ) {
                          setDropTarget(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (
                          dragTarget?.kind === 'accessory' &&
                          line.line_kind !== 'standalone_accessory'
                        ) {
                          handleAccessoryDragDrop(dragTarget.accessoryLineId, {
                            kind: 'product',
                            parentLineId: line.line_id,
                          });
                        } else if (
                          dragTarget?.kind === 'line' &&
                          dragTarget.lineId !== line.line_id &&
                          showLineReorder
                        ) {
                          handleLineDragDrop(dragTarget.lineId, line.line_id);
                        }
                        clearTableDrag();
                      }}
                    >
                        {showLineReorder ? (
                          <>
                            <td className="w-7 px-0 py-1.5 align-middle">
                              <div
                                draggable={showLineReorder}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDragTarget({ kind: 'line', lineId: line.line_id });
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={clearTableDrag}
                                className="mx-auto flex h-7 w-6 items-center justify-center rounded text-gray-400 cursor-grab active:cursor-grabbing hover:bg-gray-50 hover:text-gray-600"
                                title="Drag to reorder product"
                              >
                                <GripVertical size={14} aria-hidden />
                              </div>
                            </td>
                            <td className="w-7 px-0 py-1.5 text-center align-middle tabular-nums text-[11px] font-medium text-gray-500">
                              {displayIndex + 1}
                            </td>
                          </>
                        ) : null}
                        <td className="px-2 py-1.5 font-mono text-[10px] whitespace-nowrap">
                          {line.line_kind === 'standalone_accessory' ? (
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 font-semibold text-[10px] text-gray-700">
                              {String(line.category_name || '').trim() ||
                                String(
                                  accessoryCategoryLabelById.get(String(line.category_id || '')) || ''
                                ).trim() ||
                                '—'}
                            </span>
                          ) : (
                            line.code_snapshot
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-2">
                            <SmartImage
                              src={line.main_image}
                              alt={line.name_snapshot}
                                className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
                            />
                            <div className="font-medium text-gray-900 text-[11px] flex items-center gap-1.5 flex-wrap">
                              <span>{line.name_snapshot}</span>
                              {isSaleOnlyProduct ? (
                                <Badge tone="green" className="shrink-0 text-[10px]">
                                  Sale
                                </Badge>
                              ) : null}
                              {line.line_kind === 'standalone_accessory' &&
                              String(line.type || 'rent') === 'sell' ? (
                                <Badge tone="green" className="shrink-0 text-[10px]">
                                  Sale
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {buildAvailabilityMeta(line, { includeReturnPending: true }) || '—'}
                          </div>
                          {line.line_kind === 'standalone_accessory' ? (
                            <div className="mt-1">
                              <span className="text-[10px] text-gray-500">
                                {formatAccessoryBillingSummaryForLine(line)}
                              </span>
                            </div>
                          ) : null}
                        </td>
                        {line.line_kind !== 'standalone_accessory' ? (
                          <LineNotesCell
                            notes={line.tailor_notes}
                            noteImage={line.tailor_note_image}
                            compact
                          />
                        ) : (
                          <td className="px-2 py-1.5 text-[10px] text-gray-400">—</td>
                        )}
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end">
                            <input
                              type="number"
                              value={line.qty}
                              disabled={qtyValidatingLineId === line.line_id}
                              onChange={(e) => setProductQtyWithValidation(line, e.target.value)}
                              onFocus={selectIfZero}
                              className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 disabled:opacity-60"
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.price}
                            onChange={(e) =>
                              setProductField(line.line_id, {
                                price: parseAmountInput(e.target.value),
                              })
                            }
                            onFocus={selectIfZero}
                            className="w-16 text-right border border-gray-200 rounded px-1.5 py-0.5"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.discount}
                            onChange={(e) =>
                              setProductField(line.line_id, {
                                discount: parseAmountInput(e.target.value),
                              })
                            }
                            onFocus={selectIfZero}
                            className="w-14 text-right border border-gray-200 rounded px-1.5 py-0.5"
                          />
                        </td>
                        {gstEnabled ? (
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.gst_percent || 0}
                              onChange={(e) =>
                                setProductField(line.line_id, {
                                  gst_percent: parseAmountInput(e.target.value),
                                })
                              }
                              onFocus={selectIfZero}
                              className="w-12 text-right border border-gray-200 rounded px-1.5 py-0.5"
                            />
                          </td>
                        ) : null}
                        <td className="px-2 py-1.5 text-right font-semibold text-gray-900">
                          {formatCurrency((Number(line.price || 0) - Number(line.discount || 0)) * Number(line.qty || 1))}
                        </td>
                        {displaySalesman ? (
                          <td className="px-2 py-1.5 min-w-[11rem] align-middle">
                            {line.line_kind !== 'standalone_accessory' ? (
                              <select
                                className="block w-full min-w-[10rem] max-w-[16rem] text-xs border border-gray-200 rounded-md px-2 pr-8 py-1 bg-white"
                                value={String(line.sales_person_id || '')}
                                onChange={(e) => setLineSalesPerson(line.line_id, e.target.value)}
                                title={
                                  resolveLineSalesPersonLabel(line, salesmanLabelById) ||
                                  'Salesman who added this product'
                                }
                              >
                                <option value="">Select</option>
                                {String(line.sales_person_id || '') &&
                                !salesmanOptions.some(
                                  (o) => String(o.value) === String(line.sales_person_id)
                                ) ? (
                                  <option value={String(line.sales_person_id)}>
                                    {resolveLineSalesPersonLabel(line, salesmanLabelById)}
                                  </option>
                                ) : null}
                                {salesmanOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-2 py-1.5">
                          {line.line_kind === 'standalone_accessory' ? (
                            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                              <select
                                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white min-w-[4.5rem]"
                                value={line.type === 'sell' ? 'sell' : 'rent'}
                                onChange={(e) => {
                                  const nextType = e.target.value === 'sell' ? 'sell' : 'rent';
                                  const nextPrice = accessoryPriceForType(line, nextType);
                                  setProductField(line.line_id, { type: nextType, price: nextPrice });
                                }}
                              >
                                <option value="rent">Rent</option>
                                <option value="sell">Sell</option>
                              </select>
                              <select
                                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white min-w-[8rem]"
                                value={normalizeAccessoryOrderStatus(line.accessory_order_status)}
                                onChange={(e) =>
                                  setProductField(line.line_id, {
                                    accessory_order_status: normalizeAccessoryOrderStatus(e.target.value),
                                  })
                                }
                              >
                                {ACCESSORY_ORDER_STATUS_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => openProductAccessoryModal(line)}
                                className="inline-flex items-center justify-center rounded border border-gray-200 p-1 text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                                title="Manage linked accessories for this product"
                                aria-label="Manage linked accessories for this product"
                              >
                                <PackagePlus size={13} />
                              </button>
                              <span
                                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  getSelectedAccessoryQty(line) > 0
                                    ? 'bg-brand-light text-brand'
                                    : 'bg-gray-100 text-gray-500'
                                }`}
                                title={`${
                                  getSelectedAccessoryQty(line)
                                } selected accessory qty`}
                              >
                                {getSelectedAccessoryQty(line)}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {line.line_kind !== 'standalone_accessory' ? (
                              <button
                                type="button"
                                onClick={() => openProductNoteEditor(line)}
                                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                  productLineHasNote(line)
                                    ? 'border-brand bg-brand-light text-brand'
                                    : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                                }`}
                                title="Add or edit note"
                                aria-label="Add or edit note"
                              >
                                Note
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeProductLine(line.line_id)}
                              className="text-gray-400 hover:text-red-600"
                              aria-label="Remove"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {linkedAccessories.map((a) => (
                        <tr
                          key={`${line.line_id}-${a.line_id}`}
                          className={clsx(
                            'bg-gray-50/80',
                            dragTarget?.kind === 'accessory' &&
                              dragTarget.accessoryLineId === a.line_id &&
                              'opacity-50',
                            dropTarget?.kind === 'accessory' &&
                              dropTarget.accessoryLineId === a.line_id &&
                              dragTarget?.kind === 'accessory' &&
                              dragTarget.accessoryLineId !== a.line_id &&
                              'border-t-2 border-brand'
                          )}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (
                              dragTarget?.kind === 'accessory' &&
                              dragTarget.accessoryLineId !== a.line_id
                            ) {
                              setDropTarget({
                                kind: 'accessory',
                                parentLineId: line.line_id,
                                accessoryLineId: a.line_id,
                              });
                            }
                          }}
                          onDragLeave={() => {
                            if (
                              dropTarget?.kind === 'accessory' &&
                              dropTarget.accessoryLineId === a.line_id
                            ) {
                              setDropTarget(null);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (
                              dragTarget?.kind === 'accessory' &&
                              dragTarget.accessoryLineId !== a.line_id
                            ) {
                              handleAccessoryDragDrop(dragTarget.accessoryLineId, {
                                kind: 'accessory',
                                parentLineId: line.line_id,
                                accessoryLineId: a.line_id,
                              });
                            }
                            clearTableDrag();
                          }}
                        >
                          {showLineReorder ? (
                            <>
                              <td className="w-7 px-0 py-1.5 align-middle bg-gray-50/80">
                                <div
                                  draggable
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    setDragTarget({
                                      kind: 'accessory',
                                      parentLineId: line.line_id,
                                      accessoryLineId: a.line_id,
                                    });
                                    e.dataTransfer.effectAllowed = 'move';
                                  }}
                                  onDragEnd={clearTableDrag}
                                  className="mx-auto flex h-7 w-6 items-center justify-center rounded text-gray-400 cursor-grab active:cursor-grabbing hover:bg-gray-50 hover:text-gray-600"
                                  title="Drag to reorder or move accessory"
                                >
                                  <GripVertical size={12} aria-hidden />
                                </div>
                              </td>
                              <td className="w-7 px-0 bg-gray-50/80" aria-hidden />
                            </>
                          ) : null}
                          <td className="px-2 py-1.5 pl-5 text-[10px] text-gray-600 whitespace-nowrap">
                            {!showLineReorder ? (
                              <span
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  setDragTarget({
                                    kind: 'accessory',
                                    parentLineId: line.line_id,
                                    accessoryLineId: a.line_id,
                                  });
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={clearTableDrag}
                                className="mr-1 inline-flex align-middle text-gray-400 cursor-grab active:cursor-grabbing hover:text-gray-600"
                                title="Drag to reorder or move accessory"
                              >
                                <GripVertical size={12} aria-hidden />
                              </span>
                            ) : null}
                            <span className="mr-1 text-gray-400 align-middle">-&gt;</span>
                            <span
                              className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 font-semibold align-middle"
                            >
                              {String(a.category_name || '').trim() ||
                                String(accessoryCategoryLabelById.get(String(a.category_id || '')) || '').trim() ||
                                '—'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 pl-5">
                            <div className="flex items-center gap-2">
                              <SmartImage
                                src={a.image_url}
                                alt={a.name_snapshot}
                                className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
                              />
                              <div>
                                <div className="font-medium text-gray-900 text-[11px] flex items-center gap-1.5 flex-wrap">
                                  {a.name_snapshot}
                                  {isAccessoryPickerOutOfStock(a, {
                                    type: resolveAccessoryPickerType(a, a.type),
                                    grandfatherSelected: canGrandfatherAccessorySelection(a, { isEditMode }),
                                  }) ? (
                                    <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 leading-none uppercase">
                                      Not available
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-[10px] text-gray-500 mt-0.5">
                                  {formatAccessoryDateAvailability(a, {
                                    type: a.type,
                                    from: pickupDate,
                                    to: returnDate,
                                  })}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-[10px] text-gray-400">—</td>
                          <td className="px-2 py-1.5">
                            <div className="flex items-center justify-end">
                              <input
                                type="number"
                                min={1}
                                value={a.qty}
                                onChange={(e) => {
                                  setAccessoryField(line.line_id, a.line_id, {
                                    qty:
                                      e.target.value === ''
                                        ? ''
                                        : Math.max(1, Math.floor(Number(e.target.value)) || 1),
                                  });
                                }}
                                onFocus={selectIfZero}
                                className="w-14 text-center border border-gray-200 rounded px-1 py-0.5"
                              />
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={a.price}
                              onChange={(e) =>
                                setAccessoryField(line.line_id, a.line_id, {
                                  price: parseAmountInput(e.target.value),
                                })
                              }
                              onFocus={selectIfZero}
                              className="w-16 text-right border border-gray-200 rounded px-1.5 py-0.5"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={a.discount}
                              onChange={(e) =>
                                setAccessoryField(line.line_id, a.line_id, {
                                  discount: parseAmountInput(e.target.value),
                                })
                              }
                              onFocus={selectIfZero}
                              className="w-14 text-right border border-gray-200 rounded px-1.5 py-0.5"
                            />
                          </td>
                          {gstEnabled ? (
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={a.gst_percent || 0}
                                onChange={(e) =>
                                  setAccessoryField(line.line_id, a.line_id, {
                                    gst_percent: parseAmountInput(e.target.value),
                                  })
                                }
                                onFocus={selectIfZero}
                                className="w-12 text-right border border-gray-200 rounded px-1.5 py-0.5"
                              />
                            </td>
                          ) : null}
                          <td className="px-2 py-1.5 text-right font-semibold text-gray-900">
                            {formatCurrency(
                              (Number(a.price || 0) - Number(a.discount || 0)) * Math.max(1, Number(a.qty || 1))
                            )}
                          </td>
                          {displaySalesman ? (
                            <td className="px-2 py-1.5 text-[10px] text-gray-400">—</td>
                          ) : null}
                          <td className="px-2 py-1.5">
                            <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                              <select
                                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white min-w-[4.5rem]"
                                value={a.type === 'sell' ? 'sell' : 'rent'}
                                onChange={(e) => {
                                  const nextType = e.target.value === 'sell' ? 'sell' : 'rent';
                                  const nextPrice = accessoryPriceForType(a, nextType);
                                  setAccessoryField(line.line_id, a.line_id, {
                                    type: nextType,
                                    price: nextPrice,
                                  });
                                }}
                              >
                                <option value="rent">Rent</option>
                                <option value="sell">Sell</option>
                              </select>
                              <select
                                className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white min-w-[8rem]"
                                value={normalizeAccessoryOrderStatus(a.accessory_order_status)}
                                onChange={(e) =>
                                  setAccessoryField(line.line_id, a.line_id, {
                                    accessory_order_status: normalizeAccessoryOrderStatus(e.target.value),
                                  })
                                }
                              >
                                {ACCESSORY_ORDER_STATUS_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeAccessoryLine(line.line_id, a.line_id)}
                              className="text-gray-400 hover:text-red-600"
                              title="Remove linked accessory"
                              aria-label="Remove linked accessory"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {accessoryNotesPreview.length > 0 ? (
            <div className="mt-3 pt-2 border-t border-gray-200">
              <div className="text-[11px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                Accessories notes
              </div>
              <ul className="space-y-1.5 text-[11px] text-gray-800 list-none pl-0">
                {accessoryNotesPreview.map((text, idx) => (
                  <li
                    key={`acc-note-${idx}-${text.length}`}
                    className="rounded border border-gray-100 bg-gray-50/80 px-2 py-1.5 text-gray-700 whitespace-pre-wrap leading-snug"
                  >
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          <div className="card p-2.5 space-y-2">
            <div>
              <label htmlFor="booking-order-remarks" className="label">Order remarks</label>
              <textarea
                id="booking-order-remarks"
                className="input min-h-[88px]"
                placeholder="Optional notes for this booking only (shown on bill if entered)"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value)}
              />
            </div>
            <div className="rounded-md border border-gray-200 p-2">
              <div className="text-[11px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                Booking Discount
              </div>
              <div className="flex items-center gap-3 mb-1.5 text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="booking-discount-type"
                    checked={bookingDiscountType === 'flat'}
                    onChange={() => setBookingDiscountType('flat')}
                  />
                  Flat
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="booking-discount-type"
                    checked={bookingDiscountType === 'percent'}
                    onChange={() => setBookingDiscountType('percent')}
                  />
                  Per.(%)
                </label>
              </div>
              <input
                type="number"
                min={0}
                step="0.01"
                value={bookingDiscountValue}
                onChange={(e) => setBookingDiscountValue(parseAmountInput(e.target.value))}
                onFocus={selectIfZero}
                className="w-28 text-right border border-gray-200 rounded px-1.5 py-0.5"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input label="Reference Name" value={referenceName} onChange={(e) => setReferenceName(e.target.value)} />
              <div>
                <div className="group/tooltip relative mb-1 inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
                  <label className="label mb-0 shrink-0" htmlFor="next-booking-gap-days">
                    Next booking gap (days)
                  </label>
                  <button
                    type="button"
                    className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:border-brand hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label="What is next booking gap?"
                    aria-describedby="next-booking-gap-tooltip"
                  >
                    <Info size={12} strokeWidth={2.5} aria-hidden />
                  </button>
                  <div
                    id="next-booking-gap-tooltip"
                    role="tooltip"
                    className="pointer-events-none invisible absolute left-0 bottom-[calc(100%+6px)] z-50 w-[min(100vw-2rem,18rem)] scale-95 opacity-0 transition duration-150 group-hover/tooltip:visible group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 group-focus-within/tooltip:visible group-focus-within/tooltip:scale-100 group-focus-within/tooltip:opacity-100"
                  >
                    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[11px] leading-snug text-gray-700 shadow-md">
                      {NEXT_BOOKING_GAP_TOOLTIP.map((line, idx) => (
                        <p key={idx} className="mb-1.5 last:mb-0">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
                <Input
                  id="next-booking-gap-days"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Days"
                  value={nextBookingGapDaysInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setNextBookingGapDaysInput('');
                      return;
                    }
                    const n = Math.max(0, Math.floor(Number(v)));
                    if (Number.isNaN(n)) setNextBookingGapDaysInput('');
                    else setNextBookingGapDaysInput(String(n));
                  }}
                  onFocus={selectIfZero}
                  title="Minimum days after return before the next booking (stored on this order)."
                />
              </div>
              <div>
                <div className="group/tooltip relative mb-1 inline-flex min-w-0 max-w-full flex-wrap items-center gap-1">
                  <label className="label mb-0 shrink-0" htmlFor="previous-booking-gap-days">
                    Previous booking gap (days)
                  </label>
                  <button
                    type="button"
                    className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:border-brand hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    aria-label="What is previous booking gap?"
                    aria-describedby="previous-booking-gap-tooltip"
                  >
                    <Info size={12} strokeWidth={2.5} aria-hidden />
                  </button>
                  <div
                    id="previous-booking-gap-tooltip"
                    role="tooltip"
                    className="pointer-events-none invisible absolute left-0 bottom-[calc(100%+6px)] z-50 w-[min(100vw-2rem,18rem)] scale-95 opacity-0 transition duration-150 group-hover/tooltip:visible group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 group-focus-within/tooltip:visible group-focus-within/tooltip:scale-100 group-focus-within/tooltip:opacity-100"
                  >
                    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-2 text-[11px] leading-snug text-gray-700 shadow-md">
                      {PREVIOUS_BOOKING_GAP_TOOLTIP.map((line, idx) => (
                        <p key={idx} className="mb-1.5 last:mb-0">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
                <Input
                  id="previous-booking-gap-days"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="Days"
                  value={previousBookingGapDaysInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') {
                      setPreviousBookingGapDaysInput('');
                      return;
                    }
                    const n = Math.max(0, Math.floor(Number(v)));
                    if (Number.isNaN(n)) setPreviousBookingGapDaysInput('');
                    else setPreviousBookingGapDaysInput(String(n));
                  }}
                  onFocus={selectIfZero}
                  title="Minimum days before this delivery when a prior booking ends (stored on this order)."
                />
              </div>
              <div className="md:col-span-3">
                <div className="text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">
                  Prep window (from catalog)
                </div>
                <div className="mt-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-800">
                  {lines.some((l) => l.line_kind !== 'standalone_accessory' && String(l.type || 'rent') !== 'sell') ? (
                    <>
                      Largest gap among rent lines in this booking:{' '}
                      <span className="font-semibold tabular-nums">{maxRentGapDays}</span> day(s)
                    </>
                  ) : (
                    <span className="text-gray-500">Add rent products to show gap from catalog.</span>
                  )}
                </div>
                {pickupBeforeNextAvailable.length > 0 ? (
                  <div
                    className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900"
                    role="status"
                  >
                    <div className="font-semibold mb-0.5">Delivery date is inside the prep window</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {pickupBeforeNextAvailable.map((w) => (
                        <li key={`${w.name}-${w.next}`}>
                          <span className="font-medium">{w.name}</span>: delivery {formatDate(pickupDate) || '-'} is before next available{' '}
                          {formatDate(w.next) || '-'}
                          {w.gap > 0 ? ` (gap ${w.gap} day${w.gap === 1 ? '' : 's'})` : ''}.
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div ref={advanceSummaryRef} className="card p-2.5">
            <h3 className="text-xs font-semibold text-gray-900 mb-1.5 uppercase tracking-wide">Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Row label="Total Qty" value={String(totalQty(lines))} />
              <Row label="Taxable Amt." value={formatCurrency(totals.taxable)} />
              <Row label="Subtotal" value={formatCurrency(totals.subtotal)} />
              {gstEnabled ? <Row label="CGST Amt." value={formatCurrency(totals.cgst)} muted /> : null}
              <Row label="Item Discount(-)" value={formatCurrency(totals.item_discount)} />
              {gstEnabled ? <Row label="SGST Amt." value={formatCurrency(totals.sgst)} muted /> : null}
              <Row label="Booking Discount(-)" value={formatCurrency(totals.booking_discount)} />
              {gstEnabled ? <Row label="IGST Amt." value={formatCurrency(totals.igst)} muted /> : null}
              <Row label="Discount(-)" value={formatCurrency(totals.discount)} />
              <Row label="Round Off" value={formatCurrency(totals.round_off)} muted />
              <Row label="Grand Total" value={formatCurrency(totals.grand_total)} className="md:col-span-2" />
              <Row label="Advance amount" className="md:col-span-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <EditableAdvanceAmountField
                    key={isEditMode ? `advance-${orderId}` : 'advance-new'}
                    locked={isEditMode}
                    onEditClick={isEditMode ? () => setSettlementModalOpen(true) : undefined}
                    value={advanceAmount}
                    onChange={(raw) => {
                      setAdvanceAmount(parseAmountInput(raw));
                      touch('advanceAmount')();
                    }}
                    onFocus={selectIfZero}
                    hasError={Boolean(err('advanceAmount'))}
                  />
                  <AccountSelectWithQr
                    accountId={advanceAccountId}
                    accounts={paymentAccounts}
                    accountKind="payment"
                    size="sm"
                    className="min-w-0 shrink"
                  >
                    <select
                      id="booking-create-advance-account"
                      aria-label="Advance payment account"
                      value={advanceAccountId}
                      onChange={(e) => {
                        setAdvanceAccountId(e.target.value);
                        touch('advanceAccountId')();
                      }}
                      className={fieldShellClass(err('advanceAccountId'), `${BOOKING_ACCOUNT_SELECT_CLASS} w-full`)}
                    >
                      <option value="">Select Account</option>
                      {advanceBankAccounts.length ? (
                        <optgroup label="Bank Accounts">
                          {advanceBankAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {advanceCashAccounts.length ? (
                        <optgroup label="Cash Accounts">
                          {advanceCashAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </AccountSelectWithQr>
                </div>
                {err('advanceAmount') || err('advanceAccountId') ? (
                  <p className="text-xs text-red-600 mt-1 w-full">
                    {err('advanceAmount') || err('advanceAccountId')}
                  </p>
                ) : null}
              </Row>
              <Row label="Security amount" className="md:col-span-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={deposit}
                    onChange={(e) =>
                      setDeposit(e.target.value === '' ? '' : toNonNegativeAmount(e.target.value))
                    }
                    onFocus={selectIfZero}
                    className="w-20 shrink-0 text-right border border-gray-200 rounded px-1.5 py-1.5 text-xs"
                    title="Expected security deposit (may be greater than bill total)"
                  />
                  <AccountSelectWithQr
                    accountId={securityAccountId}
                    accounts={securityAccounts}
                    accountKind="security"
                    size="sm"
                    className="min-w-0 shrink"
                  >
                    <select
                      id="booking-create-security-account"
                      aria-label="Security deposit account"
                      value={securityAccountId}
                      onChange={(e) => {
                        setSecurityAccountId(e.target.value);
                        touch('securityAccountId')();
                      }}
                      className={fieldShellClass(err('securityAccountId'), `${BOOKING_ACCOUNT_SELECT_CLASS} w-full`)}
                    >
                      <option value="">Select Account</option>
                      {securityAccountOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </AccountSelectWithQr>
                </div>
                {err('securityAccountId') ? (
                  <p className="text-xs text-red-600 mt-1 w-full">{err('securityAccountId')}</p>
                ) : null}
              </Row>
              <div className="md:col-span-2 flex justify-end">
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={paidSecurityAmt}
                    onChange={(e) => {
                      setPaidSecurityAmt(e.target.checked);
                      touch('securityAccountId')();
                    }}
                  />
                  Paid Security Amt.
                </label>
              </div>
              <div className="border-t border-gray-200 pt-2 md:col-span-2 space-y-1.5">
                <Row
                  label={isEditMode ? 'Paid toward bill' : 'Paid'}
                  labelTitle={
                    isEditMode
                      ? 'Total already paid toward the rent bill (advance, partial, final, credit applied). Security deposit is separate.'
                      : 'Advance toward the bill, plus security deposit when “Paid Security Amt.” is checked. After save, advance appears in order Paid; security appears as a deposit payment.'
                  }
                  value={formatCurrency(isEditMode ? paidTowardBill : paidAtBooking)}
                  className="font-medium"
                />
                {isEditMode ? (
                  <div className="text-[10px] text-gray-500 leading-tight pl-0.5">
                    Advance {formatCurrency(Number(advanceAmount) || 0)}
                    {editDepositNet > 0 || paidSecurityAmt
                      ? ` · Security received ${formatCurrency(editDepositNet > 0 ? editDepositNet : Number(deposit) || 0)}`
                      : ''}
                  </div>
                ) : (Number(advanceAmount) || 0) > 0 || paidSecurityAmt ? (
                  <div className="text-[10px] text-gray-500 leading-tight pl-0.5">
                    Advance {formatCurrency(Number(advanceAmount) || 0)}
                    {paidSecurityAmt ? ` · Security ${formatCurrency(Number(deposit) || 0)}` : ''}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-500 leading-tight pl-0.5">No advance or marked security yet.</div>
                )}
                <Row
                  label={isEditMode ? 'Remaining balance' : 'Payable Amt.'}
                  labelTitle={
                    isEditMode
                      ? 'Grand total minus paid toward bill. Updates when you change lines or the advance amount. Security deposit does not reduce this balance.'
                      : 'Grand total minus advance and applied customer credit. Security deposit does not reduce this balance.'
                  }
                  value={formatCurrency(remainingBalance)}
                  className={isEditMode ? 'font-medium text-brand' : undefined}
                />
                {!isEditMode && customerOpenCredit > 0 ? (
                  <div className="md:col-span-2 space-y-2 pt-2 mt-1 border-t-2 border-red-200 bg-red-50 rounded-md p-2.5">
                    <p className="text-base font-bold text-red-700 leading-snug">
                      Available credit (matching contact numbers):{' '}
                      <span className="tabular-nums">{formatCurrency(customerOpenCredit)}</span>
                    </p>
                    {matchedCustomersWithCredit.length > 0 ? (
                      <ul className="text-sm font-semibold text-red-700 list-disc pl-5 space-y-0.5">
                        {matchedCustomersWithCredit.map((c) => (
                          <li key={c.id}>
                            {c.name || 'Customer'}: {formatCurrency(c.open_balance)} available
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {customerCreditNotes.length > 0 ? (
                      <ul className="text-sm font-bold text-red-700 list-disc pl-5 space-y-1">
                        {customerCreditNotes.map((n) => (
                          <li key={n.id}>
                            Credit note {n.note_number}: {formatCurrency(n.remaining)} available
                            {n.linked_phone ? ` · ${n.linked_phone}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <label className="inline-flex items-center gap-2 text-base font-bold text-red-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-red-600"
                        checked={applyCustomerCredit}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setApplyCustomerCredit(checked);
                          touch('applyCreditAmount')();
                          if (checked) {
                            const adv = Number(advanceAmount) || 0;
                            const maxApply = round2(
                              Math.min(customerOpenCredit, Math.max(0, totals.grand_total - adv))
                            );
                            setApplyCreditAmount(maxApply > 0 ? String(maxApply) : '');
                          } else {
                            setApplyCreditAmount('');
                          }
                        }}
                      />
                      Apply customer credit
                    </label>
                    {applyCustomerCredit ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-red-700">Amount to apply</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={Math.min(customerOpenCredit, totals.grand_total)}
                          value={applyCreditAmount}
                          onChange={(e) => {
                            setApplyCreditAmount(
                              e.target.value === '' ? '' : String(toNonNegativeAmount(e.target.value))
                            );
                            touch('applyCreditAmount')();
                          }}
                          className={clsx(
                            'w-32 text-right border-2 rounded px-2 py-1.5 text-base font-bold tabular-nums text-red-700',
                            err('applyCreditAmount')
                              ? 'border-red-500 ring-1 ring-red-500'
                              : 'border-red-300 bg-white'
                          )}
                          title="Amount of store credit to apply"
                        />
                      </div>
                    ) : null}
                    {err('applyCreditAmount') ? (
                      <p className="text-sm font-semibold text-red-600">{err('applyCreditAmount')}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={handleCancelBooking}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={submit}
                loading={isSubmitting || saveMutation.isPending}
                disabled={
                  initializingEdit ||
                  editOrderQuery.isLoading ||
                  isSubmitting ||
                  saveMutation.isPending
                }
              >
                {isEditMode ? 'Save changes' : 'Submit'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ProductRentalHistoryModal
        isOpen={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryProductSnapshot(null);
        }}
        product={historyProductSnapshot}
      />

      <Modal
        isOpen={!!noteEditorLineId}
        onClose={closeProductNoteEditor}
        title="Product note"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={closeProductNoteEditor}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={saveProductNoteEditor}>
              Save note
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <ImageUploader
            value={noteEditorImageUrl}
            onChange={setNoteEditorImageUrl}
            folder="booking-notes"
            label="Reference image (optional)"
            hint="One image for stitching / fitting reference."
            size="md"
          />
          <div>
            <label htmlFor="booking-product-note" className="label text-[11px]">
              Note (optional)
            </label>
            <textarea
              id="booking-product-note"
              className="input min-h-[90px] text-xs"
              value={noteEditorValue}
              onChange={(e) => setNoteEditorValue(e.target.value.slice(0, 500))}
              placeholder="Add stitching / fitting instructions for this product..."
              rows={4}
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!addAccessoryForLineId}
        onClose={closeAccessoryModal}
        size="lg"
        title={`${
          accessoryModalMode === 'all' ? 'Add Accessories' : 'Accessories'
        }${activeAccessoryLine ? ` · ${activeAccessoryLine.name_snapshot}` : ''}`}
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button type="button" size="sm" variant="secondary" onClick={closeAccessoryModal}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void commitAccessoryModal()}>
              Save
              {pendingModalSaveCount > 0 ? ` (${pendingModalSaveCount})` : ''}
            </Button>
          </div>
        }
      >
        <div className="space-y-2 text-xs">
          <p className="text-[11px] text-gray-500 leading-snug">
            Tick as many accessories as you need (recommended and/or catalog), then click{' '}
            <span className="font-semibold text-gray-700">Save</span> once to add them all.
          </p>
          {pickupDate && returnDate ? (
            <p className="text-[11px] text-brand font-medium">
              Availability for {formatDate(pickupDate) || pickupDate} – {formatDate(returnDate) || returnDate}
            </p>
          ) : null}
          {accessoryModalMode !== 'all' ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                  Recommended Accessories
                  {recommendedAvailabilityLoading ? (
                    <span className="ml-2 font-normal normal-case text-gray-500">Checking availability…</span>
                  ) : null}
                </div>
                {recommendedAccessories.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="text-[11px] text-brand hover:underline"
                      onClick={selectAllRecommendedAccessories}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-[11px] text-gray-600 hover:underline"
                      onClick={clearPendingRecommendedSelections}
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </div>
              {!activeAccessoryLine || recommendedAccessories.length === 0 ? (
                <div className="text-[11px] text-gray-500 border border-gray-200 rounded-md px-2 py-1.5">
                  No mapped accessories found for this product/category.
                </div>
              ) : recommendedAccessoryGroups.length === 0 ? (
                <div className="text-[11px] text-gray-500 border border-gray-200 rounded-md px-2 py-1.5">
                  No categorized recommended accessories found.
                </div>
              ) : (
                <div ref={recommendedDropdownWrapRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {recommendedAccessoryGroups.map((group) => {
                    const isOpen = openRecommendedCategoryKey === group.key;
                    const selectedNames = group.items
                      .filter((a) => !!pendingRecommendedSelections[a.line_id])
                      .map((a) => String(a.name_snapshot || '').trim())
                      .filter(Boolean);
                    const selectedPreview = selectedNames.length
                      ? selectedNames.length <= 2
                        ? selectedNames.join(', ')
                        : `${selectedNames.slice(0, 2).join(', ')} +${selectedNames.length - 2}`
                      : 'Select accessories';
                    const groupHasSelected = group.items.some((x) => !!pendingRecommendedSelections[x.line_id]);
                    return (
                      <div key={group.key} className="relative">
                        <div className="mb-0.5 text-xs font-medium text-gray-800 truncate">
                          {group.label}
                        </div>
                        <button
                          type="button"
                          data-recommended-dropdown-key={group.key}
                          className={`w-full h-7 rounded border bg-white hover:bg-gray-50 ${
                            groupHasSelected
                              ? 'border-brand-700 bg-brand-100 text-gray-900 font-medium'
                              : 'border-gray-300 text-gray-700'
                          }`}
                          onClick={() =>
                            setOpenRecommendedCategoryKey((prev) => {
                              const next = prev === group.key ? '' : group.key;
                              if (next !== group.key) {
                                setRecommendedCategorySearch((s) => {
                                  if (!s[group.key]) return s;
                                  const copy = { ...s };
                                  delete copy[group.key];
                                  return copy;
                                });
                              }
                              return next;
                            })
                          }
                          aria-label={`Open ${group.label} accessories`}
                        >
                          <span className="block w-full px-2 text-left text-[11px] text-inherit truncate">
                            {selectedPreview}
                          </span>
                        </button>
                        {isOpen ? (
                          <div
                            data-recommended-dropdown-key={group.key}
                            className={`absolute left-0 right-0 z-20 mt-1 border rounded bg-white shadow-sm max-h-44 overflow-hidden flex flex-col ${
                              groupHasSelected ? 'border-brand-200' : 'border-gray-200'
                            }`}
                          >
                            <div className="sticky top-0 z-10 border-b border-gray-100 bg-white p-1">
                              <div className="relative">
                                <Search
                                  size={12}
                                  className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                                />
                                <input
                                  type="search"
                                  className="input h-7 w-full text-[11px] pl-7"
                                  placeholder="Search by name"
                                  value={recommendedCategorySearch[group.key] || ''}
                                  onChange={(e) =>
                                    setRecommendedCategorySearch((prev) => ({
                                      ...prev,
                                      [group.key]: e.target.value,
                                    }))
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Search ${group.label} accessories by name`}
                                />
                              </div>
                            </div>
                            <div className="overflow-auto p-1 space-y-0.5 max-h-32">
                              {(() => {
                                const visibleItems = filterRecommendedGroupItems(
                                  group.items,
                                  recommendedCategorySearch[group.key]
                                );
                                if (visibleItems.length === 0) {
                                  return (
                                    <p className="px-1 py-2 text-[10px] text-gray-500 text-center">
                                      No accessories match your search.
                                    </p>
                                  );
                                }
                                return visibleItems.map((a) => {
                                  const isChecked = !!pendingRecommendedSelections[a.line_id];
                                  const pickType = resolveAccessoryPickerType(a, a.type);
                                  const outOfStock =
                                    recommendedAvailabilityLoading ||
                                    isAccessoryPickerOutOfStock(a, {
                                      type: pickType,
                                      grandfatherSelected: canGrandfatherAccessorySelection(a, {
                                        isEditMode,
                                      }),
                                    });
                                  return (
                                    <label
                                      key={a.line_id}
                                      aria-label={`Select ${a.name_snapshot || 'accessory'}`}
                                      className={`flex items-start gap-1.5 rounded px-1 py-0.5 text-[11px] ${
                                        outOfStock
                                          ? 'border border-transparent text-gray-500 opacity-60 cursor-not-allowed'
                                          : isChecked
                                            ? 'border border-brand bg-brand-100 font-medium text-gray-900 cursor-pointer'
                                            : 'border border-transparent text-gray-700 hover:bg-gray-50 cursor-pointer'
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        disabled={outOfStock}
                                        onChange={(e) =>
                                          void togglePendingRecommendedSelection(a.line_id, e.target.checked)
                                        }
                                        className="mt-0.5 shrink-0 accent-brand"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="leading-4 flex items-center gap-1.5 flex-wrap">
                                          {a.name_snapshot}
                                          {outOfStock ? (
                                            <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 leading-none uppercase">
                                              Not available
                                            </span>
                                          ) : null}
                                        </span>
                                        <span className="text-[10px] text-gray-500 font-normal block mt-0.5">
                                          {formatAccessoryDateAvailability(a, {
                                            type: pickType,
                                            from: pickupDate,
                                            to: returnDate,
                                          })}
                                        </span>
                                      </span>
                                    </label>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-2">
            <div className="border border-gray-200 rounded-md overflow-hidden h-[46vh]">
              <div className="px-2 py-1.5 text-[11px] font-semibold text-gray-700 bg-gray-50 border-b border-gray-200">
                Categories
              </div>
              <div className="max-h-[42vh] overflow-auto">
                <button
                  type="button"
                  onClick={() => setAccessoryCategoryId('all')}
                  className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                    accessoryCategoryId === 'all' ? 'bg-brand-light text-brand font-semibold' : 'hover:bg-gray-50'
                  }`}
                >
                  All ({accessoryCategoryCountsQuery.data?.total || 0})
                </button>
                {(accessoryCategoryCountsQuery.data?.by_category || []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAccessoryCategoryId(c.id)}
                    className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                      accessoryCategoryId === c.id
                        ? 'bg-brand-light text-brand font-semibold'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    {c.label} ({c.count || 0})
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9"
                  placeholder="Search by name, code, category or barcode"
                  value={accessorySearch}
                  onChange={(e) => setAccessorySearch(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                  {accessoryModalMode === 'all' ? 'All Accessories' : 'Add Extra Accessories'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-[11px] text-brand hover:underline"
                    onClick={selectAllVisibleAccessories}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-gray-600 hover:underline"
                    onClick={clearPendingAccessoryPicks}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="max-h-[40vh] overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                {(accessorySearchQuery.data?.data || []).length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs text-gray-500">No accessories found.</div>
                ) : (
                  (accessorySearchQuery.data?.data || []).map((a) => {
                    const alreadyAdded = isAccessoryAlreadyOnBooking(a.id);
                    const isPending = Boolean(pendingAccessoryPicks[a.id]);
                    const pickType = accessoryDefaultType(a);
                    const availQty = accessoryPickerAvailableQty(a, pickType);
                    const availabilityLabel = formatAccessoryDateAvailability(a, {
                      type: pickType,
                      from: pickupDate,
                      to: returnDate,
                    });
                    const outOfStock = availQty <= 0 && !alreadyAdded;
                    const isChecked = alreadyAdded || isPending;
                    const isDisabled = alreadyAdded || outOfStock;
                    return (
                      <label
                        key={a.id}
                        className={`px-2 py-1.5 flex items-center gap-2 border-b border-gray-100 last:border-b-0 rounded-sm ${
                          outOfStock
                            ? 'bg-gray-50 opacity-60 cursor-not-allowed'
                            : alreadyAdded
                              ? 'bg-brand-light/80 ring-1 ring-inset ring-brand/30 cursor-default'
                              : isPending
                                ? 'bg-brand-light/40 ring-1 ring-inset ring-brand/20 hover:bg-brand-light/50 cursor-pointer'
                                : 'hover:bg-gray-50 cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={(e) => togglePendingAccessoryPick(a, e.target.checked)}
                        />
                        <SmartImage
                          src={a.image_url}
                          alt={a.name}
                          className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-gray-800 flex items-center gap-1.5">
                            {a.name}
                            {outOfStock ? (
                              <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 leading-none uppercase">Not available</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-gray-500">
                            {availabilityLabel} · rent {formatCurrency(a.price_rent)} · sell{' '}
                            {formatCurrency(a.price_sell)}
                            {alreadyAdded ? ' · already on booking' : ''}
                          </div>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="pt-1 border-t border-gray-200">
            <label className="label text-[11px]" htmlFor="booking-accessory-modal-remarks">
              Accessory remarks (optional)
            </label>
            <textarea
              id="booking-accessory-modal-remarks"
              className="input min-h-[52px] text-xs py-1.5"
              placeholder="Applied to selected accessories when you click Save…"
              value={accessoryModalRemarks}
              onChange={(e) => setAccessoryModalRemarks(e.target.value.slice(0, 500))}
              rows={2}
            />
          </div>
        </div>
      </Modal>

      <BookingLogsModal
        isOpen={auditLogsOpen}
        orderId={orderId}
        billNo={editBookingNumber}
        onClose={() => setAuditLogsOpen(false)}
      />

      {isEditMode ? (
        <SettlementModal
          isOpen={settlementModalOpen}
          orderId={orderId}
          onClose={() => setSettlementModalOpen(false)}
          onSuccess={handleSettlementSuccess}
        />
      ) : null}

      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(scanned) => {
          const code = String(scanned || '').trim();
          if (!code) return;
          setScannerOpen(false);
          setProductQuery(code);
          setSelectedProduct(null);
          toast.success(`Scanned ${code}`);
        }}
        title="Scan Product QR / Barcode"
      />
    </>
  );
};

const Row = ({ label, value, children, muted, className, labelTitle }) => (
  <div className={`flex items-center justify-between ${className || ''}`}>
    <span className={muted ? 'text-gray-500' : 'text-gray-700'} title={labelTitle || undefined}>
      {label}
    </span>
    {children || <span className={muted ? 'text-gray-500' : 'text-gray-900'}>{value}</span>}
  </div>
);

function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function isAccessoryAvailabilityRow(row) {
  return row?.line_kind === 'standalone_accessory' || row?.accessory_id != null;
}

function buildAvailabilityMeta(row, options = {}) {
  const includeReturnPending = options.includeReturnPending === true;
  const parts = [];

  if (isAccessoryAvailabilityRow(row)) {
    const total = Math.max(0, Number(row?.total_qty ?? row?.qty ?? 0) || 0);
    const booked = Math.max(0, Number(row?.booked_qty ?? 0) || 0);
    const isSell = String(row?.type || 'rent').toLowerCase() === 'sell';
    if (isSell) {
      const inShop =
        row?.in_shop_qty != null && row?.in_shop_qty !== ''
          ? Math.max(0, Number(row.in_shop_qty) || 0)
          : Math.max(0, Number(row?.stock_qty ?? row?.qty ?? 0) || 0);
      if (inShop > 0) parts.push(`${inShop} in shop`);
      if (total > 0) parts.push(`${total} in catalog`);
    } else {
      const free = Math.max(0, Number(row?.free_qty ?? 0) || 0);
      if (free > 0) parts.push(`${free} available for dates`);
      else if (total > 0) parts.push('none available for dates');
      if (booked > 0) parts.push(`${booked} booked`);
      if (total > 0) parts.push(`${total} in catalog`);
    }
    return parts.join(' · ');
  }

  const total = Number(row?.total_qty || 0);
  const free = Number(row?.free_qty || 0);
  const booked = Number(row?.booked_qty || 0);
  const delivery = Number(row?.in_delivery_qty || 0);
  const returnPending = Number(row?.return_pending_qty || 0);
  const washing = Number(row?.washing_qty || 0);
  const repair = Number(row?.repair_qty || 0);
  if (total > 0) parts.push(`stock ${total}`);
  if (free > 0) parts.push(`available ${free}`);
  if (booked > 0) parts.push(`booked ${booked}`);
  if (delivery > 0) parts.push(`delivery ${delivery}`);
  if (includeReturnPending && returnPending > 0) parts.push(`return pending ${returnPending}`);
  if (washing > 0) parts.push(`washing ${washing}`);
  if (repair > 0) parts.push(`repair ${repair}`);
  if (row?.next_available_date) parts.push(`next ${formatDate(row.next_available_date) || '-'}`);
  return parts.join(' · ');
}

/**
 * Map Availability cart "Added by" (draft author) to Create Order line salesman fields.
 * @param {object} line
 * @returns {{ sales_person_id: string | null, sales_person_name: string }}
 */
function salesPersonFromAvailabilityCartLine(line) {
  const sales_person_id = line?.added_by_id || line?.sales_person_id || null;
  const sales_person_name = String(
    line?.added_by_name || line?.sales_person_name || line?.added_by_email || ''
  ).trim();
  return { sales_person_id: sales_person_id || null, sales_person_name };
}

/**
 * @param {{ sales_person_id?: string | null, sales_person_name?: string }} line
 * @param {Map<string, string>} salesmanLabelById
 */
function resolveLineSalesPersonLabel(line, salesmanLabelById) {
  const id = String(line?.sales_person_id || '');
  if (!id) return '';
  return salesmanLabelById.get(id) || String(line?.sales_person_name || '').trim() || '';
}

function createLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toDateInputValue(value) {
  return normalizeCustomOrderSqlDate(value) || '';
}

function totalQty(lines) {
  return (lines || []).reduce((sum, line) => {
    let next = sum + Number(line.qty || 0);
    for (const a of line.accessories || []) {
      if (a.selected) next += Number(a.qty || 0);
    }
    return next;
  }, 0);
}

function isProductBookableForSelection(product, requestedQty) {
  if (!product) return false;
  const wanted = Math.max(1, Number(requestedQty) || 1);
  if (product.can_book === false) return false;
  const hasFreeQty = product.free_qty != null;
  if (hasFreeQty && Number(product.free_qty || 0) < wanted) return false;
  return true;
}

function deriveOrderType(lines) {
  const types = new Set((lines || []).map((line) => line?.type).filter(Boolean));
  if (types.has('rent') && types.has('sell')) return 'mixed';
  if (types.has('sell')) return 'sell';
  return 'rent';
}

function getSelectedAccessoryQty(line) {
  return (line?.accessories || []).reduce(
    (sum, a) => (a.selected ? sum + Number(a.qty || 0) : sum),
    0
  );
}

function selectIfZero(e) {
  const value = String(e?.target?.value ?? '').trim();
  if (value === '0' || value === '0.0' || value === '0.00') {
    e.target.select();
  }
}

function isSellAccessoryLine(row) {
  return String(row?.type || 'rent') === 'sell';
}

function isRentAccessoryLine(row) {
  return !isSellAccessoryLine(row);
}

function collectRentAccessoryAllocations(lines, options = {}) {
  const omitLineId = options.omitLineId ? String(options.omitLineId) : '';
  const omitAccessoryLineId = options.omitAccessoryLineId ? String(options.omitAccessoryLineId) : '';
  const map = new Map();

  const add = (accessoryId, qty) => {
    if (!accessoryId || qty <= 0) return;
    const key = String(accessoryId);
    map.set(key, (map.get(key) || 0) + qty);
  };

  for (const line of lines || []) {
    if (line.line_kind === 'standalone_accessory') {
      if (omitLineId && String(line.line_id) === omitLineId) continue;
      if (!isRentAccessoryLine(line)) continue;
      add(line.accessory_id, Number(line.qty || 1));
      continue;
    }
    for (const acc of line.accessories || []) {
      if (!acc.selected) continue;
      if (!isRentAccessoryLine(acc)) continue;
      if (omitAccessoryLineId && String(acc.line_id) === omitAccessoryLineId) continue;
      add(acc.accessory_id, Number(acc.qty || 1));
    }
  }
  return map;
}

function getRentAccessoryAvailable(accessoryRow, lines, options = {}) {
  const accessoryId = String(accessoryRow?.accessory_id || '');
  if (!accessoryId) return 0;
  const apiFree = Math.max(0, Number(accessoryRow?.free_qty ?? 0));
  const allocatedElsewhere =
    collectRentAccessoryAllocations(lines, {
      omitLineId: options.omitLineId,
      omitAccessoryLineId: options.omitAccessoryLineId,
    }).get(accessoryId) || 0;
  let reclaimQty = 0;
  if (options.omitLineId) {
    const line = (lines || []).find((row) => String(row.line_id) === String(options.omitLineId));
    if (
      line?.line_kind === 'standalone_accessory' &&
      String(line.accessory_id) === accessoryId &&
      isRentAccessoryLine(line)
    ) {
      reclaimQty += Number(line.qty || 1);
    }
  }
  if (options.omitAccessoryLineId) {
    for (const productLine of lines || []) {
      const acc = (productLine.accessories || []).find(
        (row) => String(row.line_id) === String(options.omitAccessoryLineId)
      );
      if (acc && String(acc.accessory_id) === accessoryId && isRentAccessoryLine(acc) && acc.selected) {
        reclaimQty += Number(acc.qty || 1);
      }
    }
  }
  return Math.max(0, apiFree - allocatedElsewhere + reclaimQty);
}

function getAccessoryCatalogStockForPick(accessory) {
  if (accessory?.in_shop_qty != null && accessory?.in_shop_qty !== '') {
    return Math.max(0, Number(accessory.in_shop_qty) || 0);
  }
  if (accessory?.rentable_qty != null && accessory?.rentable_qty !== '') {
    return Math.max(0, Number(accessory.rentable_qty) || 0);
  }
  return accessoryRentableQty(accessory);
}

function getAccessorySellStockQty(row) {
  if (row?.stock_qty != null && row?.stock_qty !== '') {
    return Math.max(0, Number(row.stock_qty) || 0);
  }
  if (row?.in_shop_qty != null && row?.in_shop_qty !== '') {
    return Math.max(0, Number(row.in_shop_qty) || 0);
  }
  if (row?.rentable_qty != null && row?.rentable_qty !== '') {
    return Math.max(0, Number(row.rentable_qty) || 0);
  }
  return accessoryRentableQty(row);
}

function collectSellAccessoryAllocations(lines, options = {}) {
  const omitLineId = options.omitLineId ? String(options.omitLineId) : '';
  const omitAccessoryLineId = options.omitAccessoryLineId ? String(options.omitAccessoryLineId) : '';
  const map = new Map();

  const add = (accessoryId, qty) => {
    if (!accessoryId || qty <= 0) return;
    const key = String(accessoryId);
    map.set(key, (map.get(key) || 0) + qty);
  };

  for (const line of lines || []) {
    if (line.line_kind === 'standalone_accessory') {
      if (omitLineId && String(line.line_id) === omitLineId) continue;
      if (!isSellAccessoryLine(line)) continue;
      add(line.accessory_id, Number(line.qty || 1));
      continue;
    }
    for (const acc of line.accessories || []) {
      if (!acc.selected) continue;
      if (!isSellAccessoryLine(acc)) continue;
      if (omitAccessoryLineId && String(acc.line_id) === omitAccessoryLineId) continue;
      add(acc.accessory_id, Number(acc.qty || 1));
    }
  }
  return map;
}

function getSellAccessoryAvailable(accessoryRow, lines, options = {}) {
  const accessoryId = String(accessoryRow?.accessory_id || '');
  if (!accessoryId) return 0;
  const stock = getAccessorySellStockQty(accessoryRow);
  const allocatedElsewhere =
    collectSellAccessoryAllocations(lines, {
      omitLineId: options.omitLineId,
      omitAccessoryLineId: options.omitAccessoryLineId,
    }).get(accessoryId) || 0;
  let reclaimQty = 0;
  if (options.omitLineId) {
    const line = (lines || []).find((row) => String(row.line_id) === String(options.omitLineId));
    if (
      line?.line_kind === 'standalone_accessory' &&
      String(line.accessory_id) === accessoryId &&
      isSellAccessoryLine(line)
    ) {
      reclaimQty += Number(line.qty || 1);
    }
  }
  if (options.omitAccessoryLineId) {
    for (const productLine of lines || []) {
      const acc = (productLine.accessories || []).find(
        (row) => String(row.line_id) === String(options.omitAccessoryLineId)
      );
      if (acc && String(acc.accessory_id) === accessoryId && isSellAccessoryLine(acc) && acc.selected) {
        reclaimQty += Number(acc.qty || 1);
      }
    }
  }
  return Math.max(0, stock - allocatedElsewhere + reclaimQty);
}

/** Seed accessory modal remarks from saved line / accessory data (edit + create). */
function resolveAccessoryModalRemarksSeed(lines, lineId, mode) {
  if (!lineId) return '';
  if (mode === 'all' && lineId === ACCESSORY_ONLY_MODAL_LINE_ID) {
    const remarks = (lines || [])
      .filter((l) => l.line_kind === 'standalone_accessory')
      .map((l) => String(l.remarks || '').trim())
      .filter(Boolean);
    if (!remarks.length) return '';
    const unique = [...new Set(remarks)];
    return unique.length === 1 ? unique[0] : remarks[0];
  }
  const line = (lines || []).find((l) => l.line_id === lineId);
  if (!line) return '';
  const selected = (line.accessories || []).filter((a) => a.selected);
  const fromSelected = selected.map((a) => String(a.remarks || '').trim()).filter(Boolean);
  const pool = fromSelected.length
    ? fromSelected
    : (line.accessories || []).map((a) => String(a.remarks || '').trim()).filter(Boolean);
  if (!pool.length) return '';
  const unique = [...new Set(pool)];
  return (unique.length === 1 ? unique[0] : pool[0]).slice(0, 500);
}

function hydrateLinesFromOrder(order) {
  const orderSalesPersonId = order?.sales_person_id || null;
  const orderSalesPersonName = String(order?.sales_person_name || '').trim();
  const productLines = (order?.items || []).map((item) => {
    const lineSalesPersonId = item.sales_person_id || orderSalesPersonId || null;
    const lineSalesPersonName =
      String(item.sales_person_name || '').trim() ||
      (lineSalesPersonId && lineSalesPersonId === orderSalesPersonId ? orderSalesPersonName : '');
    return {
      line_id: createLocalId(),
      persisted_id: item.id,
      product_id: item.product_id,
      expected_product_id: item.product_id,
      expected_line_version: Number(item.replacement_version || 0),
      code_snapshot: item.code_snapshot || item.product_code || item.code || '',
      name_snapshot: item.name_snapshot || 'Item',
      main_image: item.main_image || item.image || item.image_url || item.photo || null,
      qty: Number(item.qty || 1),
      price: Number(item.price || 0),
      discount: Number(item.discount || 0),
      gst_percent: 0,
      type: item.type || 'rent',
      free_qty: 0,
      booked_qty: 0,
      total_qty: 0,
      in_delivery_qty: 0,
      return_pending_qty: 0,
      washing_qty: 0,
      repair_qty: 0,
      next_available_date: null,
      gap_days: 0,
      can_book: true,
      tailor_notes: String(item.tailor_notes ?? '').trim().slice(0, 500),
      tailor_note_image: String(item.tailor_note_image ?? '').trim().slice(0, 500),
        sales_person_id: lineSalesPersonId,
      sales_person_name: lineSalesPersonName,
      display_order: Number(item.display_order ?? 0),
      accessories: [],
    };
  });
  const productByPersistedId = new Map(productLines.map((line) => [line.persisted_id, line]));
  for (const a of order?.accessories || []) {
    const sellLine = String(a.type || 'rent') === 'sell';
    const catalogStock = Math.max(0, Number(a.catalog_qty ?? 0));
    const next = {
      line_id: createLocalId(),
      persisted_id: a.id,
      accessory_id: a.accessory_id,
      name_snapshot: a.name_snapshot || 'Accessory',
      image_url: a.image_url || a.main_image || a.image || a.photo || null,
      qty: Number(a.qty || 1),
      price: Number(a.price || 0),
      catalog_price_rent: Number(a.catalog_price_rent ?? 0),
      catalog_price_sell: Number(a.catalog_price_sell ?? 0),
      discount: Number(a.discount || 0),
      gst_percent: 0,
      type: a.type || 'rent',
      accessory_order_status: normalizeAccessoryOrderStatus(a.given_status),
      _hydrated_given_status: normalizeAccessoryOrderStatus(a.given_status),
      _hydrated_stage_flags: a.stage_flags ?? null,
      selected: true,
      source: 'manual',
      category_id: a.category_id || null,
      category_name: String(a.category_name || '').trim() || '',
      stock_qty: catalogStock,
      free_qty: sellLine ? catalogStock : Number(a.qty || 0),
      booked_qty: 0,
      total_qty: sellLine ? catalogStock : Number(a.qty || 0),
      is_required: false,
      is_recommended: false,
      display_order: Number(a.display_order ?? 0),
      category_display_order:
        a.category_display_order !== undefined && a.category_display_order !== null
          ? Number(a.category_display_order)
          : null,
      remarks: String(a.remarks ?? '').trim().slice(0, 500),
    };
    if (a.order_item_id && productByPersistedId.has(a.order_item_id)) {
      productByPersistedId.get(a.order_item_id).accessories.push(next);
    } else {
      productLines.push({
        line_id: createLocalId(),
        line_kind: 'standalone_accessory',
        persisted_id: a.id,
        accessory_id: a.accessory_id,
        name_snapshot: a.name_snapshot || 'Accessory',
        main_image: a.image_url || a.main_image || a.image || a.photo || null,
        qty: Number(a.qty || 1),
        price: Number(a.price || 0),
        catalog_price_rent: Number(a.catalog_price_rent ?? 0),
        catalog_price_sell: Number(a.catalog_price_sell ?? 0),
        discount: Number(a.discount || 0),
        gst_percent: 0,
        type: a.type || 'rent',
        accessory_order_status: normalizeAccessoryOrderStatus(a.given_status),
        _hydrated_given_status: normalizeAccessoryOrderStatus(a.given_status),
        _hydrated_stage_flags: a.stage_flags ?? null,
        selected: true,
        source: 'manual',
        category_id: a.category_id || null,
        category_name: String(a.category_name || '').trim() || '',
        display_order: Number(a.display_order ?? 0),
        category_display_order:
          a.category_display_order !== undefined && a.category_display_order !== null
            ? Number(a.category_display_order)
            : null,
        stock_qty: catalogStock,
        free_qty: sellLine ? catalogStock : Number(a.qty || 0),
        booked_qty: 0,
        total_qty: sellLine ? catalogStock : Number(a.qty || 0),
        remarks: String(a.remarks ?? '').trim().slice(0, 500),
      });
    }
  }
  for (const line of productLines) {
    if (line.accessories?.length) {
      line.accessories = sortAccessoriesByDisplayOrder(line.accessories);
    }
  }
  return productLines;
}

CreateOrder.propTypes = {
  mode: PropTypes.oneOf(['create', 'edit']),
  orderId: PropTypes.string,
};

CreateOrder.defaultProps = {
  mode: 'create',
  orderId: null,
};

export default CreateOrder;
