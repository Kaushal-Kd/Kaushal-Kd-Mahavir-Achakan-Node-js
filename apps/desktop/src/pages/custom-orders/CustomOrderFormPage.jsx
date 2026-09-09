import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CUSTOM_ORDER_STATUS_LABELS,
  CUSTOM_ORDER_SELECTABLE_STATUS_VALUES,
  addDays,
  formatDate,
  formatDateTime,
  normalizeCustomOrderRetrials,
  normalizePhone,
  nowDatetimeLocal,
  normalizeTime12,
  phoneInputDigits,
  splitDatetimeLocal,
  toISODate,
  toDatetimeLocalValue,
  buildProductCode,
  resolveProductCodePrefixFromFormat,
  validateCustomOrderForCompletion,
  validateCustomOrderMeasurements,
  validateFields,
} from '@wrs/shared';
import { ArrowLeft, CalendarPlus, ExternalLink, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import CustomOrderDraftActions from '../../components/custom-orders/CustomOrderDraftActions.jsx';
import MultiImageUploader from '../../components/ui/MultiImageUploader.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Input from '../../components/ui/Input.jsx';
import NumberInput from '../../components/ui/NumberInput.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import { customOrdersApi } from '../../lib/api/customOrders.js';
import { categoriesApi } from '../../lib/api/categories.js';
import { configurationsApi } from '../../lib/api/configurations.js';
import { sortColorsAZ } from '../../lib/colorOrder.js';
import { customOrderFieldsApi } from '../../lib/api/customOrderFields.js';
import { customersApi } from '../../lib/api/customers.js';
import { productsApi } from '../../lib/api/products.js';
import { useCustomOrder, useCustomOrderMutations } from '../../hooks/api/useCustomOrders.js';
import { useAppSettings } from '../../hooks/useAppSettings.js';
import { guardedMutate } from '../../lib/guardedMutate.js';
import {
  shouldOfferBookingAfterComplete,
  startCustomOrderBookingHandoff,
} from '../../lib/customOrderBookingHandoff.js';
import { invalidateCustomOrdersDomain } from '../../lib/queryInvalidation.js';
import { printCustomOrderBill } from '../../utils/printBill.js';
import {
  createLocalDraftId,
  draftLabelFromSnapshot,
  getActiveDraftId,
  isSnapshotTriviallyEmpty,
  readDraftList,
  removeCustomOrderDraft,
  setActiveDraftId as persistActiveCustomOrderDraftId,
  upsertCustomOrderDraft,
} from '../../lib/customOrderDraftStorage.js';
import { toast } from '../../stores/uiStore.js';
import CustomOrderProductVerifyModal from './CustomOrderProductVerifyModal.jsx';

const emptyRetrial = () => ({ date: '', notes: '' });

const emptyForm = () => ({
  status: 'in_progress',
  customer_id: null,
  customer_name: '',
  customer_phone: '',
  customer_phone2: '',
  customer_phone2_name: '',
  customer_whatsapp: '',
  customer_whatsapp_source: 'phone1',
  customer_address: '',
  delivery_date: '',
  return_date: '',
  marriage_date: '',
  design_name: '',
  category_id: '',
  product_name: '',
  color: '',
  size: '',
  remarks: '',
  given_to_tailor: false,
  tailor_name: '',
  tailor_date: '',
  trial_date: '',
  trial_product: '',
  retrials: [],
  measurements: {},
  design_images: [],
  trial_images: [],
});

function resolveWhatsappValue({ whatsappSource, whatsappManual, phone1, phone2 }) {
  const p1 = phoneInputDigits(phone1);
  const p2 = phoneInputDigits(phone2);
  if (whatsappSource === 'phone1') return p1 || '';
  if (whatsappSource === 'phone2') return p2.length === 10 ? p2 : '';
  return phoneInputDigits(whatsappManual);
}

const RULES = {
  customer_name: { required: true, label: 'Customer name' },
  customer_phone: { type: 'phone', required: true, label: 'Contact No.1' },
};

const statusOptions = CUSTOM_ORDER_SELECTABLE_STATUS_VALUES.map((v) => ({
  value: v,
  label: CUSTOM_ORDER_STATUS_LABELS[v] || v,
}));

const sectionTitleClass =
  'text-sm font-semibold text-gray-900 border-b border-gray-100 pb-1 mb-2';

const formGridClass =
  'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-12 gap-x-3 gap-y-2 items-end';

const compactInputClass = 'h-8 text-xs py-1 px-2';
const compactSelectClass = 'h-8 text-xs py-1';

const CustomOrderFormPage = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const viewOnlyFromNav = Boolean(location.state?.viewOnly);
  const queryClient = useQueryClient();
  const [values, setValues] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [customer, setCustomer] = useState(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [contactNo2SameAsPhone1, setContactNo2SameAsPhone1] = useState(false);
  const [whatsappSource, setWhatsappSource] = useState('phone1');
  const [whatsappManual, setWhatsappManual] = useState('');
  const [bookingPromptOrder, setBookingPromptOrder] = useState(null);
  const [pendingEditAfterPrompt, setPendingEditAfterPrompt] = useState(null);
  const [productVerifyOrder, setProductVerifyOrder] = useState(null);
  const [productVerifyWasAlreadyCompleted, setProductVerifyWasAlreadyCompleted] = useState(false);
  const [productCreateRequired, setProductCreateRequired] = useState(false);
  const [orderDateTime, setOrderDateTime] = useState(() => nowDatetimeLocal());
  const [printLoading, setPrintLoading] = useState(false);
  const [customOrderDraftId, setCustomOrderDraftId] = useState(null);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const customOrderDraftIdRef = useRef(null);
  const skipDraftPersistRef = useRef(false);
  const draftHydrateDoneRef = useRef(false);
  const justStartedBlankDraftRef = useRef(false);
  const lastHandledFreshRef = useRef(null);
  const lastHandledStartNewDraftRef = useRef(null);
  const lastHandledManualSaveRef = useRef(null);

  useEffect(() => {
    customOrderDraftIdRef.current = customOrderDraftId;
  }, [customOrderDraftId]);

  const appSettings = useAppSettings();
  const returnOffsetDays = appSettings.getNumber('AUTO_SELECT_RETURN_DATE_DAYS', 3);
  const { data: existing, isLoading: loadingExisting, refetch } = useCustomOrder(id);
  const { createMut, updateMut } = useCustomOrderMutations();

  const { data: fieldsData, isLoading: loadingFields } = useQuery({
    queryKey: ['custom-order-fields'],
    queryFn: () => customOrderFieldsApi.list(),
  });

  const { data: categoriesRes } = useQuery({
    queryKey: ['categories', 'product', 'custom-order'],
    queryFn: () => categoriesApi.list({ type: 'product' }),
  });

  const { data: colorsRes, isLoading: colorsLoading } = useQuery({
    queryKey: ['configurations', 'colors'],
    queryFn: () => configurationsApi.get('colors'),
  });

  const { data: sizesRes, isLoading: sizesLoading } = useQuery({
    queryKey: ['configurations', 'sizes'],
    queryFn: () => configurationsApi.get('sizes'),
  });

  const { data: tailorsRes, isLoading: tailorsLoading } = useQuery({
    queryKey: ['configurations', 'tailors'],
    queryFn: () => configurationsApi.get('tailors'),
  });

  const customerResults = useQuery({
    queryKey: ['customer-search-custom-order', customerQuery],
    queryFn: () => customersApi.search(customerQuery),
    enabled: customerQuery.trim().length >= 2,
  });

  const gstDefaultRate = appSettings.isLoading ? 0 : Number(appSettings.gst?.default_rate || 0);

  const fieldDefs = useMemo(() => {
    const arr = fieldsData?.data || [];
    return [...arr]
      .filter((d) => d.is_active !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [fieldsData]);

  const categories = useMemo(() => {
    const arr = categoriesRes?.data || [];
    return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [categoriesRes]);

  const categoryId = values.category_id || '';

  const { data: codeFormatRes } = useQuery({
    queryKey: ['product-code-format'],
    queryFn: () => productsApi.getCodeFormat(),
    staleTime: 60_000,
  });
  const codeFormat = codeFormatRes?.data;
  const codePadding = Math.max(1, Math.min(10, Number(codeFormat?.padding) || 4));
  const activePrefix = useMemo(
    () => resolveProductCodePrefixFromFormat(codeFormat, categoryId),
    [codeFormat, categoryId]
  );

  const { data: lastCodeRes, isLoading: lastCodeLoading } = useQuery({
    queryKey: ['products', 'last-code', categoryId],
    queryFn: () => productsApi.lastCode({ category_id: categoryId }),
    enabled: Boolean(categoryId),
    staleTime: 30_000,
  });

  const { data: nextCodeRes, isFetching: nextCodeLoading } = useQuery({
    queryKey: ['products', 'next-code', 'custom-order-form', categoryId, values.size],
    queryFn: () =>
      productsApi.nextCode({
        category_id: categoryId || undefined,
        size: values.size || '',
      }),
    enabled: Boolean(categoryId),
    staleTime: 30_000,
  });

  const maxCategoryCode = lastCodeRes?.data?.code || null;
  const maxCategoryNumber = lastCodeRes?.data?.max_number ?? null;
  const nextCategoryNumber = lastCodeRes?.data?.next_number ?? null;
  const nextCategoryCodePreview =
    nextCodeRes?.data?.code ||
    (activePrefix && nextCategoryNumber != null
      ? buildProductCode(activePrefix, nextCategoryNumber, codePadding, values.size)
      : activePrefix
        ? buildProductCode(activePrefix, 1, codePadding, values.size)
        : '');

  const selectedCategoryLabel = useMemo(() => {
    if (!categoryId) return '';
    return categories.find((c) => c.id === categoryId)?.label || '';
  }, [categoryId, categories]);

  const colors = sortColorsAZ(colorsRes?.data?.items);
  const sizes = sizesRes?.data?.items || [];
  const tailors = tailorsRes?.data?.items || [];

  const orphanTailorName = useMemo(() => {
    const saved = values.tailor_name?.trim();
    if (!saved) return '';
    const inList = tailors.some((t) => t.toLowerCase() === saved.toLowerCase());
    return inList ? '' : saved;
  }, [values.tailor_name, tailors]);

  const tailorSelectValue = useMemo(() => {
    const saved = values.tailor_name?.trim();
    if (!saved) return '';
    return tailors.some((t) => t.toLowerCase() === saved.toLowerCase()) ? saved : '';
  }, [values.tailor_name, tailors]);

  const effectiveContactNo2 = contactNo2SameAsPhone1
    ? values.customer_phone
    : values.customer_phone2;

  const effectiveContactNo2Name = contactNo2SameAsPhone1
    ? values.customer_name
    : values.customer_phone2_name;

  useEffect(() => {
    if (!contactNo2SameAsPhone1) return;
    setValues((v) => ({
      ...v,
      customer_phone2_name: String(v.customer_name || '').slice(0, 60),
    }));
  }, [contactNo2SameAsPhone1, values.customer_name]);

  useEffect(() => {
    if (!isEdit || !existing) return;
    const retrials = Array.isArray(existing.retrials)
        ? existing.retrials.map((r) => ({
          date: r.date || '',
          notes: r.notes || '',
        }))
      : [];
    const p1 = normalizePhone(existing.customer_phone || '');
    const p2 = normalizePhone(existing.customer_phone2 || '');
    const sameAsP1 = p2 && p1 && p2 === p1;
    setContactNo2SameAsPhone1(sameAsP1);
    const waSource = existing.customer_whatsapp_source || 'phone1';
    setWhatsappSource(waSource);
    setWhatsappManual(waSource === 'other' ? existing.customer_whatsapp || '' : '');
    if (existing.customer_id) {
      setCustomer({
        id: existing.customer_id,
        name: existing.customer_name,
        phone1: existing.customer_phone,
      });
      setCustomerQuery(existing.customer_name || '');
    } else {
      setCustomer(null);
      setCustomerQuery(existing.customer_name || '');
    }
    setValues({
      ...emptyForm(),
      ...existing,
      customer_id: existing.customer_id || null,
      customer_phone: existing.customer_phone || '',
      customer_phone2: existing.customer_phone2 || '',
      customer_phone2_name: existing.customer_phone2_name || '',
      customer_whatsapp: existing.customer_whatsapp || '',
      customer_whatsapp_source: existing.customer_whatsapp_source || 'phone1',
      customer_address: existing.customer_address || '',
      category_id: existing.category_id || '',
      product_name: existing.product_name || '',
      color: existing.color || '',
      size: existing.size || '',
      tailor_name: existing.tailor_name || '',
      delivery_date: existing.delivery_date || '',
      return_date: existing.return_date || '',
      marriage_date: existing.marriage_date || '',
      tailor_date: existing.tailor_date || '',
      trial_date: existing.trial_date || '',
      trial_product: existing.trial_product || '',
      retrials,
      measurements: existing.measurements || {},
      design_images: existing.design_images || [],
      trial_images: existing.trial_images || [],
    });
    setOrderDateTime(
      toDatetimeLocalValue(existing.order_date, existing.order_time) || nowDatetimeLocal()
    );
    setErrors({});
  }, [isEdit, existing]);

  const set = (key, val) => setValues((v) => ({ ...v, [key]: val }));

  const pickCustomer = (c) => {
    if (!c) return;
    setCustomer(c);
    setCustomerQuery(c.name || '');
    setCustomerOpen(false);
    const p1 = normalizePhone(c.phone1 || '');
    const p2 = normalizePhone(c.phone2 || '');
    setValues((v) => ({
      ...v,
      customer_id: c.id,
      customer_name: c.name || '',
      customer_phone: p1,
      customer_phone2: p2,
      customer_phone2_name: c.phone2_name || '',
      customer_address: c.address || v.customer_address,
      customer_whatsapp: c.whatsapp || v.customer_whatsapp,
    }));
    if (p2 && p1 && p2 === p1) setContactNo2SameAsPhone1(true);
    if (c.whatsapp) {
      const wa = normalizePhone(c.whatsapp);
      if (wa === p1) setWhatsappSource('phone1');
      else if (wa === p2) setWhatsappSource('phone2');
      else {
        setWhatsappSource('other');
        setWhatsappManual(wa);
      }
    }
  };

  const setMeasurement = (fieldKey, val) => {
    setValues((v) => ({
      ...v,
      measurements: { ...v.measurements, [fieldKey]: val },
    }));
  };

  const setRetrial = (index, key, val) => {
    setValues((v) => {
      const next = [...(v.retrials || [])];
      next[index] = { ...next[index], [key]: val };
      return { ...v, retrials: next };
    });
  };

  const addRetrial = () => {
    setValues((v) => ({
      ...v,
      retrials: [...(v.retrials || []), emptyRetrial()],
    }));
  };

  const removeRetrial = (index) => {
    setValues((v) => ({
      ...v,
      retrials: (v.retrials || []).filter((_, i) => i !== index),
    }));
  };

  const setDeliveryDate = (nextDelivery) => {
    setValues((v) => {
      const next = { ...v, delivery_date: nextDelivery };
      if (nextDelivery) {
        next.return_date = toISODate(addDays(nextDelivery, returnOffsetDays));
      }
      return next;
    });
  };

  const measurementsSummary = useMemo(() => {
    const lines = [];
    for (const def of fieldDefs) {
      const val = values.measurements?.[def.id];
      const s = String(val ?? '').trim();
      if (!s) continue;
      lines.push(`${def.label}: ${s}${def.unit ? ` ${def.unit}` : ''}`);
    }
    return lines.join('; ');
  }, [fieldDefs, values.measurements]);

  const getBlankCustomOrderSnapshot = useCallback(
    () => ({
      values: emptyForm(),
      customer: null,
      customerQuery: '',
      contactNo2SameAsPhone1: false,
      whatsappSource: 'phone1',
      whatsappManual: '',
      orderDateTime: nowDatetimeLocal(),
    }),
    []
  );

  const applyCustomOrderDraftSnapshot = useCallback((snap) => {
    if (!snap || typeof snap !== 'object') return;
    const formValues = snap.values && typeof snap.values === 'object' ? snap.values : snap;
    const retrials = Array.isArray(formValues.retrials)
      ? formValues.retrials.map((r) => ({
          date: r.date || '',
          notes: r.notes || '',
        }))
      : [];
    setValues({
      ...emptyForm(),
      ...formValues,
      retrials,
      measurements: formValues.measurements || {},
      design_images: formValues.design_images || [],
      trial_images: formValues.trial_images || [],
    });
    const c = snap.customer;
    if (c?.id) {
      setCustomer({
        id: c.id,
        name: c.name || '',
        phone1: c.phone1 || '',
      });
    } else {
      setCustomer(null);
    }
    setCustomerQuery(String(snap.customerQuery ?? ''));
    setContactNo2SameAsPhone1(!!snap.contactNo2SameAsPhone1);
    setWhatsappSource(snap.whatsappSource || 'phone1');
    setWhatsappManual(String(snap.whatsappManual ?? ''));
    setOrderDateTime(snap.orderDateTime || nowDatetimeLocal());
    setErrors({});
  }, []);

  const buildCustomOrderDraftSnapshot = useCallback(() => {
    return {
      values: JSON.parse(JSON.stringify(values)),
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            phone1: customer.phone1,
          }
        : null,
      customerQuery,
      contactNo2SameAsPhone1,
      whatsappSource,
      whatsappManual,
      orderDateTime,
    };
  }, [
    values,
    customer,
    customerQuery,
    contactNo2SameAsPhone1,
    whatsappSource,
    whatsappManual,
    orderDateTime,
  ]);

  const flushCustomOrderDraftToStorage = useCallback(() => {
    if (skipDraftPersistRef.current) return false;
    const snap = buildCustomOrderDraftSnapshot();
    if (isSnapshotTriviallyEmpty(snap)) {
      if (customOrderDraftIdRef.current && !justStartedBlankDraftRef.current) {
        removeCustomOrderDraft(customOrderDraftIdRef.current);
        setCustomOrderDraftId(null);
        persistActiveCustomOrderDraftId(null);
        customOrderDraftIdRef.current = null;
      }
      return false;
    }
    let id = customOrderDraftIdRef.current;
    if (!id) {
      id = createLocalDraftId();
      customOrderDraftIdRef.current = id;
      setCustomOrderDraftId(id);
      persistActiveCustomOrderDraftId(id);
    }
    upsertCustomOrderDraft({ id, title: draftLabelFromSnapshot(snap), snapshot: snap });
    setLastDraftSavedAt(Date.now());
    return true;
  }, [buildCustomOrderDraftSnapshot]);

  const handleStartNewCustomOrderDraft = useCallback(() => {
    flushCustomOrderDraftToStorage();
    const newId = createLocalDraftId();
    skipDraftPersistRef.current = true;
    justStartedBlankDraftRef.current = true;
    customOrderDraftIdRef.current = newId;
    setCustomOrderDraftId(newId);
    persistActiveCustomOrderDraftId(newId);
    applyCustomOrderDraftSnapshot(getBlankCustomOrderSnapshot());
    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
      justStartedBlankDraftRef.current = false;
    }, 1200);
    toast.success('New draft started. The previous one is kept under Drafts.');
  }, [
    applyCustomOrderDraftSnapshot,
    flushCustomOrderDraftToStorage,
    getBlankCustomOrderSnapshot,
  ]);

  const handleResumeCustomOrderDraft = useCallback(
    (row) => {
      if (!row?.id) return;
      flushCustomOrderDraftToStorage();
      skipDraftPersistRef.current = true;
      const fromList = readDraftList().find((x) => x.id === row.id);
      if (!fromList?.snapshot) {
        skipDraftPersistRef.current = false;
        toast.error('Draft not found');
        return;
      }
      customOrderDraftIdRef.current = row.id;
      setCustomOrderDraftId(row.id);
      persistActiveCustomOrderDraftId(row.id);
      applyCustomOrderDraftSnapshot(fromList.snapshot);
      if (fromList.snapshot?.customer?.id) {
        customersApi
          .get(fromList.snapshot.customer.id)
          .then((resp) => {
            const c = resp?.data;
            if (c?.id) pickCustomer(c);
          })
          .catch(() => {
            /* keep snapshot customer */
          });
      }
      window.setTimeout(() => {
        skipDraftPersistRef.current = false;
      }, 600);
      toast.success('Draft loaded');
    },
    [applyCustomOrderDraftSnapshot, flushCustomOrderDraftToStorage]
  );

  const handleDeleteStoredCustomOrderDraft = useCallback(
    (id) => {
      const sid = String(id || '').trim();
      if (!sid) return;
      removeCustomOrderDraft(sid);
      if (customOrderDraftIdRef.current === sid) {
        skipDraftPersistRef.current = true;
        customOrderDraftIdRef.current = null;
        setCustomOrderDraftId(null);
        persistActiveCustomOrderDraftId(null);
        applyCustomOrderDraftSnapshot(getBlankCustomOrderSnapshot());
        window.setTimeout(() => {
          skipDraftPersistRef.current = false;
        }, 600);
      }
      toast.success('Draft removed');
    },
    [applyCustomOrderDraftSnapshot, getBlankCustomOrderSnapshot]
  );

  const handleManualSaveCustomOrderDraft = useCallback(() => {
    if (flushCustomOrderDraftToStorage()) {
      toast.success('Draft saved on this device');
    } else {
      toast.info('Enter customer, product, or order details to save a draft.');
    }
  }, [flushCustomOrderDraftToStorage]);

  const validate = () => {
    const check = {
      ...values,
      customer_phone: phoneInputDigits(values.customer_phone),
      customer_phone2: phoneInputDigits(effectiveContactNo2),
    };
    const fieldErrors = validateFields(check, RULES);
    const m = validateCustomOrderMeasurements(fieldDefs, values.measurements || {});
    if (!m.ok) {
      fieldErrors['measurements.' + (m.field || '_')] = m.message;
    }
    if (values.status === 'completed') {
      const cv = validateCustomOrderForCompletion({
        ...check,
        customer_id: customer?.id || values.customer_id,
      });
      if (!cv.ok) fieldErrors._completion = cv.message;
      if (!values.category_id) fieldErrors.category_id = 'Category is required';
      if (!String(values.product_name || '').trim()) {
        fieldErrors.product_name = 'Product name is required';
      }
    }
    if (!isEdit) {
      if (!values.category_id) fieldErrors.category_id = 'Category is required';
      if (!String(values.product_name || '').trim()) {
        fieldErrors.product_name = 'Product name is required';
      }
    }
    if (values.given_to_tailor && !tailorSelectValue) {
      fieldErrors.tailor_name =
        tailors.length === 0 ? 'Add tailors under Master → Tailors' : 'Select a tailor';
    }
    if (
      values.delivery_date &&
      values.return_date &&
      values.return_date < values.delivery_date
    ) {
      fieldErrors.return_date = 'Return date cannot be before delivery date';
    }
    setErrors(fieldErrors);
    return { ok: Object.keys(fieldErrors).length === 0, fieldErrors };
  };

  const buildPayload = () => {
    const whatsapp = resolveWhatsappValue({
      whatsappSource,
      whatsappManual,
      phone1: values.customer_phone,
      phone2: effectiveContactNo2,
    });
    const { date: orderDate, time: orderTimeRaw } = splitDatetimeLocal(orderDateTime);
    const order_time = orderTimeRaw ? normalizeTime12(orderTimeRaw) : null;
    return {
      status: values.status,
      customer_id: customer?.id || values.customer_id || null,
      customer_name: values.customer_name.trim(),
      customer_phone: phoneInputDigits(values.customer_phone) || null,
      customer_phone2: phoneInputDigits(effectiveContactNo2) || null,
      customer_phone2_name: contactNo2SameAsPhone1
        ? values.customer_name.trim() || null
        : values.customer_phone2_name?.trim() || null,
      customer_whatsapp: whatsapp || null,
      customer_whatsapp_source: whatsappSource,
      customer_address: values.customer_address?.trim() || null,
      delivery_date: values.delivery_date || null,
      return_date: values.return_date || null,
      marriage_date: values.marriage_date || null,
      order_date: orderDate || null,
      order_time,
      design_name: values.design_name?.trim() || null,
      category_id: values.category_id || null,
      product_name: values.product_name?.trim() || null,
      color: values.color || null,
      size: values.size || null,
      remarks: values.remarks?.trim() || null,
      given_to_tailor: !!values.given_to_tailor,
      tailor_name: values.given_to_tailor ? values.tailor_name?.trim() || null : null,
      tailor_date: values.given_to_tailor ? values.tailor_date || null : null,
      trial_date: values.trial_date || null,
      trial_product: values.trial_product?.trim() || null,
      retrials: normalizeCustomOrderRetrials(values.retrials || []),
      measurements: values.measurements || {},
      design_images: values.design_images || [],
      trial_images: values.trial_images || [],
    };
  };

  const openProductVerify = (order, wasAlreadyCompleted = false) => {
    setProductVerifyWasAlreadyCompleted(wasAlreadyCompleted);
    setProductVerifyOrder(order);
  };

  const handleProductVerifyCreated = (order) => {
    const wasRequired = productCreateRequired;
    setProductCreateRequired(false);
    setProductVerifyOrder(null);
    if (wasRequired) {
      navigate('/custom-orders');
      return;
    }
    refetch();
    if (shouldOfferBookingAfterComplete(order, productVerifyWasAlreadyCompleted)) {
      setBookingPromptOrder(order);
    }
  };

  const dismissBookingPrompt = () => {
    const editId = pendingEditAfterPrompt;
    setBookingPromptOrder(null);
    setPendingEditAfterPrompt(null);
    if (editId) {
      navigate(`/custom-orders/${editId}/edit`);
    } else if (isEdit) {
      refetch();
    }
  };

  const confirmBookingPrompt = () => {
    if (!bookingPromptOrder) return;
    startCustomOrderBookingHandoff(bookingPromptOrder, navigate, { measurementsSummary });
    setBookingPromptOrder(null);
    setPendingEditAfterPrompt(null);
  };

  const handlePrintBill = async () => {
    if (!id || printLoading) return;
    setPrintLoading(true);
    try {
      const { data } = await customOrdersApi.get(id);
      const categoryName =
        categories.find((c) => c.id === data.category_id)?.name || '';
      await printCustomOrderBill(data, { categoryName, gstPercent: gstDefaultRate });
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Could not print bill');
    } finally {
      setPrintLoading(false);
    }
  };

  const save = () => {
    if (busy) return;
    const validation = validate();
    if (!validation.ok) {
      const fe = validation.fieldErrors;
      toast.warning(
        fe._completion || 'Fix the highlighted fields'
      );
      return;
    }
    const body = buildPayload();
    if (isEdit) {
      guardedMutate(
        updateMut,
        { id, body },
        {
          onSuccess: async () => {
            toast.success('Custom order saved');
            await invalidateCustomOrdersDomain(queryClient, { orderId: id });
            navigate('/custom-orders');
          },
          onError: (e) =>
            toast.error(e.response?.data?.error?.message || e?.message || 'Could not save'),
        }
      );
      return;
    }
    guardedMutate(createMut, body, {
      onSuccess: async (data) => {
        toast.success('Custom order created');
        await invalidateCustomOrdersDomain(queryClient, { orderId: data?.id });
        const draftId = customOrderDraftIdRef.current;
        if (draftId) {
          removeCustomOrderDraft(draftId);
          setCustomOrderDraftId(null);
          persistActiveCustomOrderDraftId(null);
          customOrderDraftIdRef.current = null;
        }
        setProductCreateRequired(true);
        openProductVerify(data, false);
      },
      onError: (e) =>
        toast.error(e.response?.data?.error?.message || e?.message || 'Could not create'),
    });
  };

  const handleOpenProductVerify = () => {
    const order = existing || { ...values, id };
    if (order.linked_product_id) {
      toast.info('Product already created for this order');
      return;
    }
    if (!order.id) {
      toast.warning('Save the custom order first');
      return;
    }
    openProductVerify(order, true);
  };

  const handleCreateBooking = () => {
    const order = existing || { ...values, id };
    if (!order.linked_product_id) {
      toast.warning('Create a product for this order first');
      return;
    }
    if (order.linked_order_id) {
      toast.info('This custom order is already linked to a booking');
      return;
    }
    startCustomOrderBookingHandoff(order, navigate, { measurementsSummary });
  };

  const busy = createMut.isPending || updateMut.isPending;
  const readOnly =
    viewOnlyFromNav || (isEdit && existing?.status === 'cancelled');

  const showBookingPanel =
    isEdit && existing?.linked_product_id && existing?.status !== 'cancelled';

  const draftSavedTimeLabel = useMemo(() => {
    if (!lastDraftSavedAt) return '';
    return formatDateTime(lastDraftSavedAt) || '';
  }, [lastDraftSavedAt]);

  useEffect(() => {
    if (isEdit) return;
    const t = window.setTimeout(() => {
      flushCustomOrderDraftToStorage();
    }, 900);
    return () => window.clearTimeout(t);
  }, [isEdit, buildCustomOrderDraftSnapshot, flushCustomOrderDraftToStorage]);

  useEffect(() => {
    if (isEdit) return;
    const fresh = location.state?.fresh;
    if (fresh == null || fresh === lastHandledFreshRef.current) return;
    lastHandledFreshRef.current = fresh;
    skipDraftPersistRef.current = true;
    justStartedBlankDraftRef.current = true;
    persistActiveCustomOrderDraftId(null);
    customOrderDraftIdRef.current = null;
    setCustomOrderDraftId(null);
    applyCustomOrderDraftSnapshot(getBlankCustomOrderSnapshot());
    draftHydrateDoneRef.current = true;
    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
      justStartedBlankDraftRef.current = false;
    }, 1200);
  }, [
    isEdit,
    location.state?.fresh,
    applyCustomOrderDraftSnapshot,
    getBlankCustomOrderSnapshot,
  ]);

  useEffect(() => {
    if (isEdit) return;
    if (draftHydrateDoneRef.current) return;
    if (location.state?.fresh != null) return;

    const activeId = getActiveDraftId();
    if (!activeId) {
      draftHydrateDoneRef.current = true;
      return;
    }
    const row = readDraftList().find((d) => d.id === activeId);
    if (!row?.snapshot) {
      draftHydrateDoneRef.current = true;
      return;
    }

    skipDraftPersistRef.current = true;
    applyCustomOrderDraftSnapshot(row.snapshot);
    customOrderDraftIdRef.current = activeId;
    setCustomOrderDraftId(activeId);

    if (row.snapshot?.customer?.id) {
      customersApi
        .get(row.snapshot.customer.id)
        .then((resp) => {
          const c = resp?.data;
          if (c?.id) pickCustomer(c);
        })
        .catch(() => {
          /* keep snapshot customer */
        });
    }

    window.setTimeout(() => {
      skipDraftPersistRef.current = false;
    }, 600);
    draftHydrateDoneRef.current = true;
  }, [isEdit, location.state?.fresh, applyCustomOrderDraftSnapshot]);

  useEffect(() => {
    if (isEdit) return;
    const token = location.state?.startNewDraft;
    if (token == null || token === lastHandledStartNewDraftRef.current) return;
    lastHandledStartNewDraftRef.current = token;
    const id = window.setTimeout(() => {
      handleStartNewCustomOrderDraft();
    }, 80);
    return () => window.clearTimeout(id);
  }, [isEdit, location.state?.startNewDraft, handleStartNewCustomOrderDraft]);

  useEffect(() => {
    if (isEdit) return;
    const token = location.state?.manualSaveDraft;
    if (token == null || token === lastHandledManualSaveRef.current) return;
    lastHandledManualSaveRef.current = token;
    const id = window.setTimeout(() => {
      handleManualSaveCustomOrderDraft();
    }, 700);
    return () => window.clearTimeout(id);
  }, [isEdit, location.state?.manualSaveDraft, handleManualSaveCustomOrderDraft]);

  if (isEdit && loadingExisting) {
    return <p className="text-sm text-gray-500 p-4">Loading…</p>;
  }

  return (
    <>
      <PageHeader
        title={
          isEdit && existing?.order_number
            ? `Edit custom order · ${existing.order_number}`
            : isEdit
              ? 'Edit custom order'
              : 'New custom order'
        }
        description={
          isEdit && existing?.updated_at
            ? `Last updated ${formatDate(existing.updated_at)}`
            : 'Customized product order — customer, product, measurements, and trials'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isEdit && !readOnly ? (
              <CustomOrderDraftActions
                mode="embedded"
                activeDraftId={customOrderDraftId}
                draftSavedTimeLabel={draftSavedTimeLabel}
                onSaveDraft={handleManualSaveCustomOrderDraft}
                onNewDraft={handleStartNewCustomOrderDraft}
                onResumeDraft={handleResumeCustomOrderDraft}
                onDeleteDraft={handleDeleteStoredCustomOrderDraft}
              />
            ) : null}
            {isEdit ? (
              <Button
                type="button"
                variant="secondary"
                icon={Printer}
                loading={printLoading}
                disabled={printLoading}
                onClick={handlePrintBill}
              >
                Print bill
              </Button>
            ) : null}
            {isEdit && existing?.linked_product_id && !existing?.linked_order_id ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={CalendarPlus}
                onClick={handleCreateBooking}
              >
                Create booking
              </Button>
            ) : null}
            <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/custom-orders')}>
              Back to list
            </Button>
          </div>
        }
      />

      {readOnly && viewOnlyFromNav && existing?.status !== 'cancelled' ? (
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          View only — use Edit from the list to make changes.
        </div>
      ) : null}

      {showBookingPanel ? (
        <section className="card p-3 mb-3 border border-gray-200 bg-gray-50/80">
          <h2 className={sectionTitleClass}>Booking</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {existing?.linked_order_id ? (
              <span className="text-gray-700 inline-flex items-center gap-1">
                Linked booking:
                <BookingBillLink
                  orderId={existing.linked_order_id}
                  returnTo={isEdit ? `/custom-orders/${id}/edit` : '/custom-orders'}
                  returnLabel="Custom order"
                >
                  {existing.linked_bill_no || existing.linked_order_id}
                </BookingBillLink>
              </span>
            ) : (
              <span className="text-gray-600">No booking linked yet</span>
            )}
            {!readOnly && !existing?.linked_order_id ? (
              <Button type="button" size="sm" icon={CalendarPlus} onClick={handleCreateBooking}>
                Create booking
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="space-y-2 pb-4">
        <section className="card p-3">
          <h2 className={sectionTitleClass}>Customer details</h2>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 relative">
              <Input
                label="Customer name*"
                value={customer ? customer.name : customerQuery}
                onChange={(e) => {
                  const q = e.target.value;
                  setCustomerQuery(q);
                  setCustomer(null);
                  set('customer_id', null);
                  set('customer_name', q);
                  setCustomerOpen(true);
                }}
                onFocus={() => setCustomerOpen(true)}
                onBlur={() => window.setTimeout(() => setCustomerOpen(false), 120)}
                error={errors.customer_name}
                disabled={readOnly}
                inputClassName={compactInputClass}
              />
              {!readOnly && customerOpen && customerQuery.trim().length >= 2 ? (
                <div className="absolute z-20 left-0 right-0 mt-1 border border-gray-200 rounded-md max-h-48 overflow-auto bg-white shadow-lg">
                  {(customerResults.data?.data || []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">No matches</div>
                  ) : (
                    (customerResults.data?.data || []).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickCustomer(c)}
                        className="w-full flex items-center justify-between text-xs px-3 py-2 hover:bg-gray-50 text-left border-b border-gray-100"
                      >
                        <span className="font-medium text-gray-800">{c.name}</span>
                        <span className="text-gray-500">{c.phone1 || '—'}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <Input
              label="Contact No.1*"
              value={values.customer_phone}
              onChange={(e) => set('customer_phone', phoneInputDigits(e.target.value))}
              error={errors.customer_phone}
              disabled={readOnly}
              inputClassName={compactInputClass}
              placeholder="10-digit mobile"
              maxLength={10}
            />
            <div className="min-w-0">
              <Input
                label="Contact No.2"
                value={effectiveContactNo2}
                onChange={(e) => set('customer_phone2', phoneInputDigits(e.target.value))}
                disabled={readOnly || contactNo2SameAsPhone1}
                inputClassName={compactInputClass}
                placeholder="10-digit mobile"
                maxLength={10}
              />
              <label className="mt-1 inline-flex items-center gap-2 text-[11px] text-gray-600">
                <input
                  type="checkbox"
                  checked={contactNo2SameAsPhone1}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setContactNo2SameAsPhone1(next);
                    if (next) {
                      setValues((v) => ({
                        ...v,
                        customer_phone2: v.customer_phone,
                        customer_phone2_name: String(v.customer_name || '').slice(0, 60),
                      }));
                    } else {
                      set('customer_phone2', '');
                      set('customer_phone2_name', '');
                    }
                  }}
                  disabled={readOnly || !values.customer_phone}
                />
                Same as Contact No.1
              </label>
            </div>
            <Input
              label="Contact No.2 name"
              value={effectiveContactNo2Name}
              onChange={(e) => set('customer_phone2_name', e.target.value.slice(0, 60))}
              disabled={readOnly || contactNo2SameAsPhone1}
              placeholder={contactNo2SameAsPhone1 ? 'Same as customer name' : 'Optional'}
              inputClassName={compactInputClass}
            />
            <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
              <div className="md:col-span-2 min-w-0">
                <label htmlFor="custom-order-whatsapp-source" className="label">WhatsApp number</label>
                <select
                  id="custom-order-whatsapp-source"
                  className={`input w-full ${compactSelectClass}`}
                  value={whatsappSource}
                  onChange={(e) => setWhatsappSource(e.target.value)}
                  disabled={readOnly}
                >
                  <option value="phone1">Same as Contact No.1</option>
                  <option value="phone2">Same as Contact No.2</option>
                  <option value="other">Other</option>
                </select>
                {whatsappSource === 'other' ? (
                  <Input
                    className="mt-1"
                    value={whatsappManual}
                    onChange={(e) => setWhatsappManual(phoneInputDigits(e.target.value))}
                    disabled={readOnly}
                    inputClassName={compactInputClass}
                    placeholder="10-digit WhatsApp"
                    maxLength={10}
                  />
                ) : null}
              </div>
              <Input
                label="Address"
                className="md:col-span-4 min-w-0"
                value={values.customer_address}
                onChange={(e) => set('customer_address', e.target.value)}
                disabled={readOnly}
                inputClassName={compactInputClass}
              />
            </div>
          </div>
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>
            Order details
            {isEdit && existing?.order_number ? (
              <span className="ml-2 font-mono text-xs font-semibold text-brand">
                {existing.order_number}
              </span>
            ) : null}
            {isEdit && existing?.linked_order_id ? (
              <span className="ml-2 font-normal text-xs text-gray-600">
                · Booking{' '}
                <BookingBillLink
                  orderId={existing.linked_order_id}
                  returnTo={`/custom-orders/${id}/edit`}
                  returnLabel="Custom order"
                >
                  {existing.linked_bill_no || existing.linked_order_id}
                </BookingBillLink>
              </span>
            ) : null}
          </h2>
          <div className={formGridClass}>
            {isEdit ? (
              <Select
                label="Status"
                className="col-span-2 sm:col-span-1 lg:col-span-2"
                selectClassName={compactSelectClass}
                value={values.status}
                onChange={(e) => set('status', e.target.value)}
                options={statusOptions}
                disabled={readOnly}
              />
            ) : null}
            <Input
              label="Date of order"
              type="datetime-local"
              className="col-span-2 sm:col-span-2 lg:col-span-3"
              inputClassName={compactInputClass}
              value={orderDateTime}
              onChange={(e) => setOrderDateTime(e.target.value)}
              disabled={readOnly}
            />
            <Input
              label="Marriage date"
              type="date"
              className="col-span-2 sm:col-span-1 lg:col-span-2"
              inputClassName={compactInputClass}
              value={values.marriage_date}
              onChange={(e) => set('marriage_date', e.target.value)}
              disabled={readOnly}
            />
            <Input
              label="Delivery date"
              type="date"
              className="col-span-2 sm:col-span-1 lg:col-span-2"
              inputClassName={compactInputClass}
              value={values.delivery_date}
              onChange={(e) => setDeliveryDate(e.target.value)}
              disabled={readOnly}
            />
            <Input
              label="Return date"
              type="date"
              className="col-span-2 sm:col-span-1 lg:col-span-2"
              inputClassName={compactInputClass}
              value={values.return_date}
              onChange={(e) => set('return_date', e.target.value)}
              error={errors.return_date}
              disabled={readOnly}
              min={values.delivery_date || undefined}
            />
          </div>
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>Product</h2>
          <div className={formGridClass}>
            <Input
              label="Design name"
              className="col-span-2 sm:col-span-4 lg:col-span-6"
              inputClassName={compactInputClass}
              value={values.design_name}
              onChange={(e) => set('design_name', e.target.value)}
              disabled={readOnly}
            />
            <Select
              label="Category"
              className="col-span-2 sm:col-span-2 lg:col-span-3"
              selectClassName={compactSelectClass}
              value={values.category_id || ''}
              onChange={(e) => set('category_id', e.target.value)}
              options={[
                { value: '', label: 'Select category' },
                ...categories.map((c) => ({ value: c.id, label: c.label })),
              ]}
              error={errors.category_id}
              disabled={readOnly}
            />
            <Input
              label="Product name"
              className="col-span-2 sm:col-span-2 lg:col-span-3"
              inputClassName={compactInputClass}
              value={values.product_name}
              onChange={(e) => set('product_name', e.target.value)}
              error={errors.product_name}
              disabled={readOnly}
            />
            <Select
              label="Color"
              className="col-span-2 sm:col-span-1 lg:col-span-2"
              selectClassName={compactSelectClass}
              value={values.color || ''}
              onChange={(e) => set('color', e.target.value)}
              options={[
                { value: '', label: colorsLoading ? 'Loading…' : 'Select' },
                ...colors.map((c) => ({ value: c, label: c })),
              ]}
              disabled={readOnly || colorsLoading}
            />
            <Select
              label="Size"
              className="col-span-2 sm:col-span-1 lg:col-span-2"
              selectClassName={compactSelectClass}
              value={values.size || ''}
              onChange={(e) => set('size', e.target.value)}
              options={[
                { value: '', label: sizesLoading ? 'Loading…' : 'Select' },
                ...sizes.map((s) => ({ value: s, label: s })),
              ]}
              disabled={readOnly || sizesLoading}
            />
            {categoryId ? (
              <div className="col-span-2 sm:col-span-4 lg:col-span-12 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs text-gray-600 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                  <span className="text-gray-500">Last code in</span>
                  <span className="font-medium text-gray-800">
                    {selectedCategoryLabel || 'this category'}
                  </span>
                  <span className="text-gray-500">:</span>
                  {lastCodeLoading ? (
                    <span className="text-gray-400">Loading…</span>
                  ) : maxCategoryCode ? (
                    <span className="font-mono font-semibold text-gray-900">{maxCategoryCode}</span>
                  ) : maxCategoryNumber != null && maxCategoryNumber > 0 && activePrefix ? (
                    <span className="font-mono font-semibold text-gray-900">
                      {activePrefix}
                      {String(maxCategoryNumber).padStart(codePadding, '0')}
                    </span>
                  ) : (
                    <span className="text-gray-500 italic">None yet</span>
                  )}
                </div>
                {activePrefix ? (
                  <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-gray-500">
                    <span>Next code</span>
                    {nextCodeLoading ? (
                      <span className="text-gray-400">Loading…</span>
                    ) : (
                      <span className="font-mono font-medium text-brand">
                        {nextCategoryCodePreview || '—'}
                      </span>
                    )}
                    {values.size ? (
                      <span className="text-gray-400">(includes size {values.size})</span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-amber-700">
                    Configure a prefix for this category under Configuration → Code format.
                  </p>
                )}
              </div>
            ) : null}
            {existing?.linked_product_id ? (
              <div className="col-span-2 sm:col-span-4 lg:col-span-12 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-brand">
                  Product: {existing.generated_product_code || '—'}
                </span>
                <Link
                  to={`/products/${existing.linked_product_id}/edit`}
                  className="text-brand hover:underline inline-flex items-center gap-1"
                >
                  Open product <ExternalLink size={12} />
                </Link>
              </div>
            ) : null}
            {!readOnly && isEdit && existing && !existing.linked_product_id ? (
              <div className="col-span-2 sm:col-span-4 lg:col-span-12">
                <Button type="button" size="sm" variant="secondary" onClick={handleOpenProductVerify}>
                  Create product
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>
            Measurements
            {!loadingFields && fieldDefs.length > 0 ? (
              <span className="ml-2 font-normal text-gray-500">({fieldDefs.length} fields)</span>
            ) : null}
          </h2>
          {loadingFields ? (
            <p className="text-xs text-gray-500">Loading fields…</p>
          ) : fieldDefs.length === 0 ? (
            <p className="text-xs text-gray-500">
              No measurement fields configured. Add fields under Master → Custom order measurements.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-2">
              {fieldDefs.map((def) => {
                const errKey = `measurements.${def.id}`;
                const err = errors[errKey] || errors['measurements._'];
                return (
                  <div key={def.id}>
                    <label className="label">
                      {def.label}
                      {def.unit ? ` (${def.unit})` : ''}
                      {def.required ? <span className="text-red-500 ml-0.5">*</span> : null}
                    </label>
                    {def.field_type === 'number' ? (
                      <NumberInput
                        className={`input w-full text-sm ${compactInputClass}`}
                        allowEmpty
                        value={values.measurements?.[def.id] ?? ''}
                        onChange={(e) => setMeasurement(def.id, e.target.value)}
                        disabled={readOnly}
                      />
                    ) : (
                      <input
                        className={`input w-full text-sm ${compactInputClass}`}
                        value={values.measurements?.[def.id] ?? ''}
                        onChange={(e) => setMeasurement(def.id, e.target.value)}
                        disabled={readOnly}
                      />
                    )}
                    {err ? <p className="mt-1 text-xs text-red-600">{err}</p> : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>Tailor</h2>
          <div className={formGridClass}>
            <label className="col-span-2 sm:col-span-2 lg:col-span-3 flex items-center gap-1.5 pb-1 text-xs text-gray-700 whitespace-nowrap min-h-[2rem]">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-brand"
                checked={values.given_to_tailor}
                onChange={(e) => set('given_to_tailor', e.target.checked)}
                disabled={readOnly}
              />
              Given to tailor
            </label>
            <div className="col-span-2 sm:col-span-2 lg:col-span-3">
              {orphanTailorName ? (
                <p className="mb-1 text-xs text-amber-700">
                  Saved tailor: {orphanTailorName} — add this name under Master → Tailors to select
                  it.
                </p>
              ) : null}
              <Select
                label="Tailor"
                selectClassName={compactSelectClass}
                value={tailorSelectValue}
                onChange={(e) => set('tailor_name', e.target.value)}
                options={[
                  { value: '', label: tailorsLoading ? 'Loading…' : 'Select tailor' },
                  ...tailors.map((t) => ({ value: t, label: t })),
                ]}
                disabled={readOnly || !values.given_to_tailor || tailorsLoading}
                error={errors.tailor_name}
                hint={
                  !errors.tailor_name &&
                  !tailorsLoading &&
                  tailors.length === 0 &&
                  values.given_to_tailor
                    ? 'Add tailors under Master → Tailors.'
                    : undefined
                }
              />
            </div>
            <Input
              label="Tailor date"
              type="date"
              className="col-span-2 sm:col-span-1 lg:col-span-2"
              inputClassName={compactInputClass}
              value={values.tailor_date}
              onChange={(e) => set('tailor_date', e.target.value)}
              disabled={readOnly || !values.given_to_tailor}
            />
          </div>
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>Trial</h2>
          <div className={formGridClass}>
            <Input
              label="Trial date"
              type="date"
              className="col-span-2 sm:col-span-2 lg:col-span-4"
              inputClassName={compactInputClass}
              value={values.trial_date}
              onChange={(e) => set('trial_date', e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="mt-2 border-t border-gray-100 pt-2">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs font-medium text-gray-700">Re-trials</span>
              {!readOnly ? (
                <Button type="button" variant="ghost" size="sm" icon={Plus} onClick={addRetrial}>
                  Add re-trial
                </Button>
              ) : null}
            </div>
            {(values.retrials || []).length === 0 ? (
              <p className="text-xs text-gray-500">No re-trials added yet.</p>
            ) : (
              <div className="space-y-1.5">
                {(values.retrials || []).map((row, index) => (
                  <div key={index} className={formGridClass}>
                    <Input
                      label="Date"
                      type="date"
                      className="col-span-2 sm:col-span-1 lg:col-span-2"
                      inputClassName={compactInputClass}
                      value={row.date}
                      onChange={(e) => setRetrial(index, 'date', e.target.value)}
                      disabled={readOnly}
                    />
                    <Input
                      label="Notes"
                      className="col-span-2 sm:col-span-2 lg:col-span-9"
                      inputClassName={compactInputClass}
                      value={row.notes}
                      onChange={(e) => setRetrial(index, 'notes', e.target.value)}
                      placeholder="Optional"
                      disabled={readOnly}
                    />
                    {!readOnly ? (
                      <div className="col-span-2 sm:col-span-4 lg:col-span-1 flex items-end justify-end pb-1">
                        <button
                          type="button"
                          onClick={() => removeRetrial(index)}
                          className="p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                          aria-label="Remove re-trial"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>Design & trial</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <div className="rounded-md border border-gray-200 bg-gray-50/40 p-2 min-w-0">
              <MultiImageUploader
                label="Design images"
                folder="custom-orders/design"
                value={values.design_images}
                onChange={(urls) => set('design_images', urls)}
                disabled={readOnly}
              />
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50/40 p-2 min-w-0">
              <MultiImageUploader
                label="Customer trial images"
                folder="custom-orders/trial"
                value={values.trial_images}
                onChange={(urls) => set('trial_images', urls)}
                disabled={readOnly}
              />
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50/40 p-2 min-w-0">
              <Input
                label="Trial product (code or name)"
                value={values.trial_product}
                onChange={(e) => set('trial_product', e.target.value)}
                placeholder="e.g. FA-0123 or product name"
                disabled={readOnly}
                inputClassName={compactInputClass}
              />
            </div>
          </div>
        </section>

        <section className="card p-3">
          <h2 className={sectionTitleClass}>Remarks</h2>
          <textarea
            className={`input w-full min-h-[2.5rem] text-sm ${compactInputClass}`}
            value={values.remarks}
            onChange={(e) => set('remarks', e.target.value)}
            placeholder="Notes for workshop or tailor"
            disabled={readOnly}
          />
          {errors._completion ? (
            <p className="mt-1 text-xs text-red-600">{errors._completion}</p>
          ) : null}
        </section>

        {!readOnly ? (
          <div className="flex flex-wrap gap-2 pt-1 pb-2">
            <Button type="button" variant="primary" icon={Save} loading={busy} onClick={save}>
              {isEdit ? 'Save changes' : 'Create order'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate('/custom-orders')}>
              Cancel
            </Button>
          </div>
        ) : null}
      </div>

      <CustomOrderProductVerifyModal
        order={productVerifyOrder}
        isOpen={Boolean(productVerifyOrder)}
        onClose={() => {
          if (productCreateRequired) return;
          setProductVerifyOrder(null);
        }}
        onCreated={handleProductVerifyCreated}
        required={productCreateRequired}
      />

      <ConfirmDialog
        isOpen={Boolean(bookingPromptOrder)}
        onClose={dismissBookingPrompt}
        onConfirm={confirmBookingPrompt}
        title="Create booking?"
        message={
          bookingPromptOrder ? (
            <>
              Product{' '}
              <span className="font-mono font-medium">
                {bookingPromptOrder.generated_product_code || '—'}
              </span>{' '}
              created for order{' '}
              <span className="font-mono font-medium">{bookingPromptOrder.order_number}</span>.
              Open a new booking with customer and product pre-filled?
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Create booking"
        cancelLabel="Not now"
      />
    </>
  );
};

export default CustomOrderFormPage;
