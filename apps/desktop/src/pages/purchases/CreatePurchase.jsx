import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDaysIso, formatCurrency, formatDate, todayIndiaISODate } from '@wrs/shared';
import { Plus, Trash2, X } from 'lucide-react';
import PropTypes from 'prop-types';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import PaymentAccountFormModal, {
  createPaymentAccountLocalId,
  emptyPaymentAccountDraft,
} from '../../components/accounts/PaymentAccountFormModal.jsx';
import SelectAccessoriesModal from '../../components/catalog/SelectAccessoriesModal.jsx';
import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import NumberInput from '../../components/ui/NumberInput.jsx';
import MultiImageUploader from '../../components/ui/MultiImageUploader.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { parseNonNegativeNumber } from '../../lib/numberInput.js';
import { accessoriesApi } from '../../lib/api/accessories.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { productsApi } from '../../lib/api/products.js';
import { purchasesApi } from '../../lib/api/purchases.js';
import {
  computeItemTotals,
  computeTransactionTotals,
  round2,
} from '../../lib/transactionLineTotals.js';
import { clearFieldError, fieldShellClass, rejectSubmit } from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';
import PurchaseAccessoryStockConfirmModal, {
  buildAccessoryStockSummary,
} from './PurchaseAccessoryStockConfirmModal.jsx';

const todayStr = () => todayIndiaISODate();
let _localId = 0;
const localId = () => `sl_${++_localId}_${Date.now()}`;

function normGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const emptyItem = () => ({
  _id: localId(),
  item_type: 'item',
  product_id: null,
  accessory_id: null,
  name_snapshot: '',
  qty: 1,
  price: 0,
  discount: 0,
  taxable_price: 0,
  cgst_percent: 0,
  cgst_amount: 0,
  sgst_percent: 0,
  sgst_amount: 0,
  igst_percent: 0,
  igst_amount: 0,
  net_price: 0,
  total_amount: 0,
});

const CreatePurchase = ({ mode }) => {
  const { id: purchaseId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit' && !!purchaseId;

  const [purchaseDate, setPurchaseDate] = useState(todayStr());
  const [vendorAccountId, setVendorAccountId] = useState('');
  const [purchaseAccountId, setPurchaseAccountId] = useState('');
  const [termsDays, setTermsDays] = useState(0);
  const [imageUrls, setImageUrls] = useState([]);
  const [remark, setRemark] = useState('');
  const [discountType, setDiscountType] = useState('flat');
  const [discountValue, setDiscountValue] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [advanceAccountId, setAdvanceAccountId] = useState('');
  const [items, setItems] = useState([]);
  const [lineType, setLineType] = useState('item');
  const [vendorAccModalOpen, setVendorAccModalOpen] = useState(false);
  const [purchaseAccModalOpen, setPurchaseAccModalOpen] = useState(false);
  const [vendorAccDraft, setVendorAccDraft] = useState(() =>
    emptyPaymentAccountDraft({ account_group: 'Vendors' })
  );
  const [purchaseAccDraft, setPurchaseAccDraft] = useState(() =>
    emptyPaymentAccountDraft({ account_group: 'Purchase' })
  );
  const [vendorAccSaving, setVendorAccSaving] = useState(false);
  const [purchaseAccSaving, setPurchaseAccSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const vendorFieldRef = useRef(null);
  const itemsFieldRef = useRef(null);
  const err = (key) => fieldErrors[key];

  const [itemSearch, setItemSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [addQty, setAddQty] = useState(1);
  const [addPrice, setAddPrice] = useState(0);
  const [addDiscount, setAddDiscount] = useState(0);
  const [addTaxable, setAddTaxable] = useState(0);
  const [addCgst, setAddCgst] = useState(0);
  const [addSgst, setAddSgst] = useState(0);
  const [addIgst, setAddIgst] = useState(0);
  const [accessoryPickerOpen, setAccessoryPickerOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const [stockConfirmOpen, setStockConfirmOpen] = useState(false);
  const [stockSummary, setStockSummary] = useState([]);
  const [stockFetchLoading, setStockFetchLoading] = useState(false);

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });

  const vendorAccounts = useMemo(
    () =>
      (paymentAccountsQuery.data?.data || []).filter(
        (a) => normGroup(a.account_group) === 'vendors'
      ),
    [paymentAccountsQuery.data]
  );

  const purchaseLedgerAccounts = useMemo(
    () =>
      (paymentAccountsQuery.data?.data || []).filter(
        (a) => normGroup(a.account_group) === 'purchase'
      ),
    [paymentAccountsQuery.data]
  );

  const bankCashAccounts = useMemo(() => {
    const all = paymentAccountsQuery.data?.data || [];
    return all.filter(
      (a) =>
        normGroup(a.account_group) === 'bank accounts' ||
        normGroup(a.account_group) === 'cash accounts'
    );
  }, [paymentAccountsQuery.data]);

  const selectedAdvanceAccountName = useMemo(() => {
    const id = String(advanceAccountId || '').trim();
    if (!id) return '';
    return bankCashAccounts.find((a) => String(a.id) === id)?.name || '';
  }, [advanceAccountId, bankCashAccounts]);

  const productsQuery = useQuery({
    queryKey: ['products', 'purchase-search', itemSearch],
    queryFn: () => productsApi.list({ search: itemSearch, per_page: 50 }),
    enabled: lineType === 'product' && itemSearch.length > 0,
  });
  const productOptions = useMemo(
    () => (productsQuery.data?.data || []).filter(isCatalogProduct),
    [productsQuery.data]
  );

  const purchaseQuery = useQuery({
    queryKey: ['purchase', purchaseId],
    queryFn: () => purchasesApi.get(purchaseId),
    enabled: isEdit,
  });

  const buildLedgerAccountPayload = (draft, group) => ({
    id: createPaymentAccountLocalId(),
    name: String(draft.name || '').trim(),
    contact_no: String(draft.contact_no || '').trim() || '0000000000',
    account_group: group,
    opening_balance: Number(draft.opening_balance || 0),
    date: draft.date || '',
    email: String(draft.email || '').trim(),
    address: String(draft.address || '').trim(),
    remarks: String(draft.remarks || '').trim(),
  });

  const saveVendorAccount = async () => {
    const name = String(vendorAccDraft.name || '').trim();
    if (!name) {
      toast.warning('Account name is required');
      return;
    }
    setVendorAccSaving(true);
    try {
      const payload = buildLedgerAccountPayload(vendorAccDraft, 'Vendors');
      await paymentAccountsApi.create(payload);
      const id = payload.id;
      await queryClient.invalidateQueries({ queryKey: ['payment-accounts'] });
      setVendorAccountId(id);
      setVendorAccModalOpen(false);
      toast.success('Vendor account created');
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not create account');
    } finally {
      setVendorAccSaving(false);
    }
  };

  const savePurchaseAccount = async () => {
    const name = String(purchaseAccDraft.name || '').trim();
    if (!name) {
      toast.warning('Account name is required');
      return;
    }
    setPurchaseAccSaving(true);
    try {
      const payload = buildLedgerAccountPayload(purchaseAccDraft, 'Purchase');
      await paymentAccountsApi.create(payload);
      const id = payload.id;
      await queryClient.invalidateQueries({ queryKey: ['payment-accounts'] });
      setPurchaseAccountId(id);
      setPurchaseAccModalOpen(false);
      toast.success('Purchase account created');
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not create account');
    } finally {
      setPurchaseAccSaving(false);
    }
  };

  const recordedAdvancePayments = useMemo(() => {
    if (!isEdit) return [];
    return (purchaseQuery.data?.data?.payments || []).filter((p) => Number(p.amount) > 0);
  }, [isEdit, purchaseQuery.data]);

  useEffect(() => {
    if (!isEdit || !purchaseQuery.data?.data) return;
    const s = purchaseQuery.data.data;
    setPurchaseDate(String(s.purchase_date || '').slice(0, 10) || todayStr());
    setVendorAccountId(s.vendor_account_id || '');
    setPurchaseAccountId(s.purchase_account_id || '');
    setTermsDays(Number(s.terms_days) || 0);
    setImageUrls(Array.isArray(s.image_urls) ? s.image_urls : []);
    setRemark(s.remark || '');
    setDiscountType(s.discount_type || 'flat');
    setDiscountValue(Number(s.discount_value) || 0);
    setAdvance(Number(s.advance) || 0);
    setAdvanceAccountId(s.advance_account_id || '');
    setItems(
      (s.items || []).map((it) => ({
        _id: localId(),
        persisted_id: it.id,
        item_type: it.item_type || 'item',
        product_id: it.product_id || null,
        accessory_id: it.accessory_id || null,
        name_snapshot: it.name_snapshot || '',
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
        discount: Number(it.discount) || 0,
        taxable_price: Number(it.taxable_price) || 0,
        cgst_percent: Number(it.cgst_percent) || 0,
        cgst_amount: Number(it.cgst_amount) || 0,
        sgst_percent: Number(it.sgst_percent) || 0,
        sgst_amount: Number(it.sgst_amount) || 0,
        igst_percent: Number(it.igst_percent) || 0,
        igst_amount: Number(it.igst_amount) || 0,
        net_price: Number(it.net_price) || 0,
        total_amount: Number(it.total_amount) || 0,
        catalog_qty: Number(it.catalog_qty ?? it.qty) || 0,
      }))
    );
  }, [isEdit, purchaseQuery.data]);

  const searchResults = productOptions;

  const purchaseAccessoryIds = useMemo(
    () =>
      items
        .filter((it) => it.item_type === 'item' && it.accessory_id)
        .map((it) => String(it.accessory_id)),
    [items]
  );

  const selectedCatalogStockQty = useMemo(() => {
    if (!selectedItem?.id) return null;
    return getCatalogStockQty(selectedItem);
  }, [selectedItem]);

  const selectItem = useCallback((item) => {
    if (item?.id) {
      setSelectedItem(item);
      setItemSearch(item.name || item.code || '');
      setAddPrice(catalogPurchasePrice(item));
      setAddDiscount(0);
      setAddQty(1);
      return;
    }
    setSelectedItem(item);
    setItemSearch(item.name || item.code || '');
    setAddPrice(catalogPurchasePrice(item));
    setAddDiscount(0);
    setAddQty(1);
  }, []);

  const incrementAddQty = useCallback(() => {
    if (!selectedItem && !itemSearch.trim()) {
      toast.warning('Select an item first');
      return;
    }
    setAddQty((prev) => Math.max(1, Number(prev) || 1) + 1);
  }, [itemSearch, selectedItem]);

  const handleAddQtyChange = useCallback((value) => {
    if (value === '' || value == null) {
      setAddQty('');
      return;
    }
    setAddQty(Math.max(1, Number(value) || 1));
  }, []);

  useEffect(() => {
    const p = Number(addPrice) || 0;
    const d = Number(addDiscount) || 0;
    setAddTaxable(round2(Math.max(0, p - d)));
  }, [addPrice, addDiscount]);

  const addItemToList = () => {
    if (!selectedItem && !itemSearch.trim()) {
      toast.warning('Select an item first');
      return;
    }
    const name = selectedItem?.name || itemSearch.trim();
    if (!name) return;

    const nextQty = addQty === '' || addQty == null ? 1 : Math.max(1, Number(addQty) || 1);

    const newItem = {
      _id: localId(),
      item_type: lineType,
      product_id: lineType === 'product' ? selectedItem?.id || null : null,
      accessory_id: lineType === 'item' ? selectedItem?.id || null : null,
      name_snapshot: name,
      qty: nextQty,
      catalog_qty: selectedItem?.id ? getCatalogStockQty(selectedItem) : 0,
      price: Number(addPrice) || 0,
      discount: Number(addDiscount) || 0,
      taxable_price: addTaxable,
      cgst_percent: Number(addCgst) || 0,
      cgst_amount: 0,
      sgst_percent: Number(addSgst) || 0,
      sgst_amount: 0,
      igst_percent: Number(addIgst) || 0,
      igst_amount: 0,
      net_price: 0,
      total_amount: 0,
    };

    const computed = computeItemTotals(newItem);
    setItems((prev) => [...prev, computed]);
    setSelectedItem(null);
    setItemSearch('');
    setAddPrice(0);
    setAddDiscount(0);
    setAddQty(1);
    setAddCgst(0);
    setAddSgst(0);
    setAddIgst(0);
  };

  const addAccessoriesFromModal = (picked) => {
    if (!picked?.length) return;
    let added = 0;
    setItems((prev) => {
      const next = [...prev];
      for (const acc of picked) {
        const price = catalogPurchasePrice(acc);
        next.push(
          computeItemTotals({
            _id: localId(),
            item_type: 'item',
            product_id: null,
            accessory_id: acc.id,
            name_snapshot: acc.name || acc.code || '',
            qty: 1,
            catalog_qty: getCatalogStockQty(acc),
            price,
            discount: 0,
            taxable_price: price,
            cgst_percent: Number(acc.cgst_percent) || 0,
            cgst_amount: 0,
            sgst_percent: Number(acc.sgst_percent) || 0,
            sgst_amount: 0,
            igst_percent: Number(acc.igst_percent) || 0,
            igst_amount: 0,
            net_price: 0,
            total_amount: 0,
          })
        );
        added += 1;
      }
      return next;
    });
    if (added > 0) toast.success(`Added ${added} item${added === 1 ? '' : 's'}`);
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it._id !== id));
  };

  const updateItemField = (id, field, value) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it._id !== id) return it;
        const updated = { ...it, [field]: value };
        return computeItemTotals(updated);
      })
    );
  };

  const totals = useMemo(
    () => computeTransactionTotals(items, { type: discountType, value: discountValue }),
    [items, discountType, discountValue]
  );

  const payable = round2(Math.max(0, totals.total_amount - Number(advance || 0)));

  const dueDate = useMemo(() => {
    if (!purchaseDate) return null;
    const days = Math.max(0, Math.floor(Number(termsDays) || 0));
    if (!days) return purchaseDate;
    return addDaysIso(purchaseDate, days);
  }, [purchaseDate, termsDays]);

  const purchaseNumber = isEdit ? purchaseQuery.data?.data?.purchase_number : null;

  const buildPurchasePayload = useCallback(() => {
    return {
      purchase_date: purchaseDate,
      vendor_account_id: vendorAccountId,
      purchase_account_id: purchaseAccountId,
      terms_days: Math.max(0, Math.floor(Number(termsDays) || 0)),
      remark: remark.trim() || null,
      discount_type: discountType,
      discount_value: Number(discountValue) || 0,
      discount_amount: totals.discount_amount,
      subtotal: totals.subtotal,
      cgst_total: totals.cgst_total,
      sgst_total: totals.sgst_total,
      igst_total: totals.igst_total,
      tax_total: totals.tax_total,
      net_amount: totals.net_amount,
      total_amount: totals.total_amount,
      advance: Number(advance) || 0,
      advance_account_id: advanceAccountId || null,
      image_urls: imageUrls,
      items: items.map((it) => ({
        item_type: it.item_type,
        product_id: it.product_id || null,
        accessory_id: it.accessory_id || null,
        name_snapshot: it.name_snapshot,
        qty: it.qty,
        price: it.price,
        discount: it.discount,
        taxable_price: it.taxable_price,
        cgst_percent: it.cgst_percent,
        cgst_amount: it.cgst_amount,
        sgst_percent: it.sgst_percent,
        sgst_amount: it.sgst_amount,
        igst_percent: it.igst_percent,
        igst_amount: it.igst_amount,
        net_price: it.net_price,
        total_amount: it.total_amount,
      })),
    };
  }, [
    advance,
    advanceAccountId,
    imageUrls,
    discountType,
    discountValue,
    items,
    purchaseAccountId,
    purchaseDate,
    remark,
    termsDays,
    totals,
    vendorAccountId,
  ]);

  const persistPurchase = useCallback(
    async (updateAccessoryStock) => {
      if (submitLockRef.current || submitting) return;
      submitLockRef.current = true;
      setSubmitting(true);
      try {
        const payload = {
          ...buildPurchasePayload(),
          update_accessory_stock: updateAccessoryStock,
        };
        if (isEdit) {
          await purchasesApi.update(purchaseId, payload);
          toast.success('Purchase updated');
        } else {
          await purchasesApi.create(payload);
          toast.success('Purchase created');
        }
        queryClient.invalidateQueries({ queryKey: ['purchases'] });
        navigate('/purchases');
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error?.message ||
          'Failed to save purchase';
        toast.error(msg);
      } finally {
        submitLockRef.current = false;
        setSubmitting(false);
        setStockConfirmOpen(false);
      }
    },
    [buildPurchasePayload, isEdit, navigate, purchaseId, queryClient, submitting]
  );

  const handleSubmit = async () => {
    if (submitting || stockFetchLoading || submitLockRef.current) return;

    const errors = {};
    let firstMessage = null;
    const add = (key, msg) => {
      if (!errors[key]) errors[key] = msg;
      if (!firstMessage) firstMessage = msg;
    };

    if (!String(vendorAccountId || '').trim()) add('vendorAccountId', 'Vendor account is required');
    if (!String(purchaseAccountId || '').trim())
      add('purchaseAccountId', 'Purchase account is required');
    if (items.length === 0) add('items', 'Add at least one item');
    const advanceAmount = Number(advance) || 0;
    if (advanceAmount > 0 && !String(advanceAccountId || '').trim()) {
      add('advanceAccountId', 'Select an account for the advance amount');
    }

    if (
      rejectSubmit({
        errors,
        setErrors: setFieldErrors,
        toast,
        message: firstMessage,
        fieldRefs: { vendorAccountId: vendorFieldRef, items: itemsFieldRef },
        scrollOrder: ['vendorAccountId', 'purchaseAccountId', 'items', 'advanceAccountId'],
      })
    ) {
      return;
    }

    const hasAccessoryLines = items.some((it) => it.item_type === 'item' && it.accessory_id);
    if (!hasAccessoryLines) {
      await persistPurchase(true);
      return;
    }

    setStockFetchLoading(true);
    setStockConfirmOpen(true);
    setStockSummary([]);
    try {
      const res = await accessoriesApi.list({ per_page: 500 });
      const stockById = new Map((res?.data || []).map((a) => [String(a.id), a]));
      setStockSummary(buildAccessoryStockSummary(items, stockById));
    } catch {
      toast.error('Could not load current accessory stock');
      setStockConfirmOpen(false);
    } finally {
      setStockFetchLoading(false);
    }
  };

  const addRowNetPrice = (() => {
    const qty = Math.max(1, Number(addQty) || 1);
    const taxableTotal = round2(addTaxable * qty);
    const cgstAmt = round2((taxableTotal * (Number(addCgst) || 0)) / 100);
    const sgstAmt = round2((taxableTotal * (Number(addSgst) || 0)) / 100);
    const igstAmt = round2((taxableTotal * (Number(addIgst) || 0)) / 100);
    return round2(taxableTotal + cgstAmt + sgstAmt + igstAmt);
  })();

  const addRowTotalAmt = addRowNetPrice;

  return (
    <div className="overflow-auto">
      <PageHeader
        title={isEdit ? 'Edit Purchase' : 'Create Purchase'}
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'Purchases', to: '/purchases' },
          { label: isEdit ? 'Edit Purchase' : 'Create Purchase' },
        ]}
      />

      {purchaseNumber ? (
        <div className="-mt-2 mb-4">
          <span className="inline-block font-mono text-xs px-2 py-0.5 rounded border border-brand/25 bg-brand-light text-brand">
            {purchaseNumber}
          </span>
        </div>
      ) : null}

      {/* ── Vendor Details ── */}
      <fieldset
        ref={vendorFieldRef}
        className={clsx(
          'border rounded-lg px-4 pt-2 pb-3 mb-4 bg-white',
          err('vendorAccountId') || err('purchaseAccountId')
            ? 'border-red-400 ring-1 ring-red-400'
            : 'border-gray-200'
        )}
      >
        <legend className="text-xs font-semibold text-gray-600 px-1">Vendor Details</legend>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-2">
          <div>
            <label
              htmlFor="purchase-date"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Date<span className="text-red-500">*</span>
            </label>
            <input
              id="purchase-date"
              type="date"
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="purchase-vendor-account"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Vendor Acc.<span className="text-red-500">*</span>
            </label>
            <div className="flex gap-1">
              <select
                id="purchase-vendor-account"
                className={fieldShellClass(
                  err('vendorAccountId'),
                  'min-w-0 flex-1 border rounded px-2.5 py-1.5 text-sm bg-white focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none'
                )}
                value={vendorAccountId}
                onChange={(e) => {
                  setVendorAccountId(e.target.value);
                  clearFieldError(setFieldErrors, 'vendorAccountId');
                }}
              >
                <option value="">Select Account</option>
                {vendorAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                title="Create vendor account"
                onClick={() => {
                  setVendorAccDraft(emptyPaymentAccountDraft({ account_group: 'Vendors' }));
                  setVendorAccModalOpen(true);
                }}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="purchase-ledger-account"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Purchase Acc.<span className="text-red-500">*</span>
            </label>
            <div className="flex gap-1">
              <select
                id="purchase-ledger-account"
                className={fieldShellClass(
                  err('purchaseAccountId'),
                  'min-w-0 flex-1 border rounded px-2.5 py-1.5 text-sm bg-white focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none'
                )}
                value={purchaseAccountId}
                onChange={(e) => {
                  setPurchaseAccountId(e.target.value);
                  clearFieldError(setFieldErrors, 'purchaseAccountId');
                }}
              >
                <option value="">Select Account</option>
                {purchaseLedgerAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Plus}
                title="Create purchase account"
                onClick={() => {
                  setPurchaseAccDraft(emptyPaymentAccountDraft({ account_group: 'Purchase' }));
                  setPurchaseAccModalOpen(true);
                }}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="purchase-terms-days"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Terms Days
            </label>
            <NumberInput
              id="purchase-terms-days"
              className="w-full"
              min={0}
              value={termsDays}
              onChange={(e) =>
                setTermsDays(Math.max(0, parseNonNegativeNumber(e.target.value, termsDays)))
              }
            />
            <p className="text-[10px] text-gray-500 mt-0.5">
              Vendor credit period before payment is due.
            </p>
          </div>
          <div>
            <div className="block text-[11px] font-medium text-gray-500 mb-0.5">Due Date</div>
            <p className="text-sm text-gray-800 py-1.5 tabular-nums">
              {dueDate ? formatDate(dueDate) : '—'}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <MultiImageUploader
            label="Bill attachments"
            hint="Attach purchase-bill images or PDF files. Image preview and delete controls are stacked on the thumbnail."
            folder="purchases"
            value={imageUrls}
            onChange={setImageUrls}
            allowPdf
          />
        </div>
      </fieldset>

      {/* ── Items ── */}
      <fieldset
        ref={itemsFieldRef}
        className={clsx(
          'border rounded-lg px-4 pt-2 pb-3 mb-4 bg-white',
          err('items') ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200'
        )}
      >
        <legend className="text-xs font-semibold text-gray-600 px-1">Items</legend>
        {err('items') ? <p className="text-xs text-red-600 mb-2">{err('items')}</p> : null}

        <div className="mb-3">
          <div className="flex items-center gap-4 mb-1">
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="radio"
                name="lineType"
                value="item"
                checked={lineType === 'item'}
                onChange={() => {
                  setLineType('item');
                  setSelectedItem(null);
                  setItemSearch('');
                  setAccessoryPickerOpen(false);
                }}
                className="accent-brand"
              />
              Item Purchase
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="radio"
                name="lineType"
                value="product"
                checked={lineType === 'product'}
                onChange={() => {
                  setLineType('product');
                  setSelectedItem(null);
                  setItemSearch('');
                  setAccessoryPickerOpen(false);
                }}
                className="accent-brand"
              />
              Product Purchase
            </label>
          </div>

          {lineType === 'item' ? (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" onClick={() => setAccessoryPickerOpen(true)}>
                Select Accessories
              </Button>
              <span className="text-xs text-gray-500">
                Pick accessories by category and search (same as Create Order).
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-nowrap items-end gap-2">
                <div className="w-[min(480px,100%)] shrink-0">
                  <div className="flex justify-end min-h-[14px] mb-0.5">
                    {selectedItem ? (
                      <span
                        className={`text-xs font-semibold leading-none ${
                          Number(selectedCatalogStockQty ?? 0) <= 0
                            ? 'text-red-600'
                            : 'text-green-600'
                        }`}
                        title="Current stock in catalog"
                      >
                        Stock: {Number(selectedCatalogStockQty ?? 0)}
                      </span>
                    ) : null}
                  </div>
                  <div className="relative w-full">
                    <input
                      type="text"
                      placeholder="Select Product"
                      className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none"
                      value={itemSearch}
                      onChange={(e) => {
                        setItemSearch(e.target.value);
                        setSelectedItem(null);
                      }}
                    />
                    {itemSearch.length > 0 && searchResults.length > 0 && !selectedItem ? (
                      <div className="absolute z-30 left-0 right-0 top-full mt-0.5 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto">
                        {searchResults.map((r) => {
                          const stock = getCatalogStockQty(r);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-brand-light hover:text-brand border-b border-gray-50 last:border-0"
                              onClick={() => selectItem(r)}
                            >
                              <span className="min-w-0 truncate">
                                {r.name}
                                {r.code ? ` (${r.code})` : ''}
                              </span>
                              <span
                                className={`shrink-0 text-xs ${stock <= 0 ? 'text-red-500' : 'text-gray-400'}`}
                              >
                                Stock: {stock}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  className="h-[34px] w-9 shrink-0 flex items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  onClick={incrementAddQty}
                  title="Increase quantity"
                >
                  <Plus size={14} />
                </button>

                <div className="shrink-0">
                  <label
                    htmlFor="purchase-line-quantity"
                    className="block text-[10px] font-medium text-gray-500 mb-0.5"
                  >
                    Qty<span className="text-red-500">*</span>
                  </label>
                  <NumberInput
                    id="purchase-line-quantity"
                    min={1}
                    allowEmpty
                    className="w-16 h-[34px] border border-gray-300 rounded px-2 py-1.5 text-sm text-center focus:border-brand outline-none"
                    value={addQty}
                    onChange={(e) => handleAddQtyChange(e.target.value)}
                    onBlur={(e) => {
                      if (e.target.value === '') handleAddQtyChange('1');
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Row 2: Price fields + Add button (product sale only) */}
        {lineType === 'product' ? (
          <div className="flex items-end gap-2.5 mb-3">
            <div>
              <label
                htmlFor="purchase-line-price"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Price
              </label>
              <NumberInput
                id="purchase-line-price"
                allowEmpty
                className="w-[80px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addPrice}
                onChange={(e) => setAddPrice(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-discount"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Discount
              </label>
              <NumberInput
                id="purchase-line-discount"
                allowEmpty
                className="w-[80px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addDiscount}
                onChange={(e) =>
                  setAddDiscount(parseNonNegativeNumber(e.target.value, { empty: '' }))
                }
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-taxable-price"
                className="block text-[10px] font-medium text-green-600 mb-0.5"
              >
                Taxable Price
              </label>
              <NumberInput
                id="purchase-line-taxable-price"
                readOnly
                className="w-[80px] border border-green-200 rounded px-2 py-1.5 text-sm bg-green-50 font-semibold text-green-700"
                value={addTaxable}
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-cgst"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                CGST(%)
              </label>
              <NumberInput
                id="purchase-line-cgst"
                allowEmpty
                className="w-[65px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addCgst}
                onChange={(e) => setAddCgst(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-sgst"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                SGST(%)
              </label>
              <NumberInput
                id="purchase-line-sgst"
                allowEmpty
                className="w-[65px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addSgst}
                onChange={(e) => setAddSgst(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-igst"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                IGST(%)
              </label>
              <NumberInput
                id="purchase-line-igst"
                allowEmpty
                className="w-[65px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addIgst}
                onChange={(e) => setAddIgst(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-net-price"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Net Price
              </label>
              <NumberInput
                id="purchase-line-net-price"
                readOnly
                className="w-[80px] border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50"
                value={addRowNetPrice}
              />
            </div>
            <div>
              <label
                htmlFor="purchase-line-total"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Total Amt.
              </label>
              <NumberInput
                id="purchase-line-total"
                readOnly
                className="w-[80px] border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50"
                value={addRowTotalAmt}
              />
            </div>
            <Button
              size="sm"
              className="shrink-0 bg-brand hover:bg-brand/90"
              onClick={addItemToList}
            >
              Add
            </Button>
          </div>
        ) : null}

        {/* Items table */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="table w-full text-xs">
            <thead>
              <tr>
                <th className="text-left">
                  <TableHeaderLabel>Name</TableHeaderLabel>
                </th>
                <th className="text-center w-14">
                  <TableHeaderLabel align="center">Qty</TableHeaderLabel>
                </th>
                <th className="text-right w-[72px]">
                  <TableHeaderLabel align="right">Price</TableHeaderLabel>
                </th>
                <th className="text-right w-[68px]">
                  <TableHeaderLabel align="right">Discount</TableHeaderLabel>
                </th>
                <th className="text-right w-[80px]">
                  <TableHeaderLabel align="right">Taxable Price</TableHeaderLabel>
                </th>
                <th className="text-center w-14">
                  <TableHeaderLabel align="center">CGST(%)</TableHeaderLabel>
                </th>
                <th className="text-right w-[68px]">
                  <TableHeaderLabel align="right">CGST Amt.</TableHeaderLabel>
                </th>
                <th className="text-center w-14">
                  <TableHeaderLabel align="center">SGST(%)</TableHeaderLabel>
                </th>
                <th className="text-right w-[68px]">
                  <TableHeaderLabel align="right">SGST Amt.</TableHeaderLabel>
                </th>
                <th className="text-center w-14">
                  <TableHeaderLabel align="center">IGST(%)</TableHeaderLabel>
                </th>
                <th className="text-right w-[68px]">
                  <TableHeaderLabel align="right">IGST Amt.</TableHeaderLabel>
                </th>
                <th className="text-right w-[80px]">
                  <TableHeaderLabel align="right">Net Price</TableHeaderLabel>
                </th>
                <th className="text-right w-[80px]">
                  <TableHeaderLabel align="right">Total Amt.</TableHeaderLabel>
                </th>
                <th className="text-center w-12">
                  <TableHeaderLabel align="center" nowrap>
                    Action
                  </TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center py-10 text-gray-400 text-sm">
                    No Record Found
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it._id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-3 py-1.5 font-medium text-gray-900">{it.name_snapshot}</td>
                    <td className="px-2 py-1.5 text-center">
                      <NumberInput
                        min={1}
                        allowEmpty
                        value={it.qty}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            updateItemField(it._id, 'qty', '');
                            return;
                          }
                          updateItemField(
                            it._id,
                            'qty',
                            parseNonNegativeNumber(raw, { min: 1, empty: '' })
                          );
                        }}
                        onBlur={(e) => {
                          if (e.target.value === '') {
                            updateItemField(it._id, 'qty', 1);
                          }
                        }}
                        className="w-12 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumberInput
                        allowEmpty
                        value={it.price}
                        onChange={(e) =>
                          updateItemField(
                            it._id,
                            'price',
                            parseNonNegativeNumber(e.target.value, { empty: '' })
                          )
                        }
                        onBlur={(e) => {
                          if (e.target.value === '') {
                            updateItemField(it._id, 'price', 0);
                          }
                        }}
                        className="w-[60px] text-right border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <NumberInput
                        allowEmpty
                        value={it.discount}
                        onChange={(e) =>
                          updateItemField(
                            it._id,
                            'discount',
                            parseNonNegativeNumber(e.target.value, { empty: '' })
                          )
                        }
                        className="w-14 text-right border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      {formatCurrency(it.taxable_price * it.qty)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <NumberInput
                        allowEmpty
                        value={it.cgst_percent}
                        onChange={(e) =>
                          updateItemField(
                            it._id,
                            'cgst_percent',
                            parseNonNegativeNumber(e.target.value, { empty: '' })
                          )
                        }
                        className="w-12 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-600">
                      {formatCurrency(it.cgst_amount)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <NumberInput
                        allowEmpty
                        value={it.sgst_percent}
                        onChange={(e) =>
                          updateItemField(
                            it._id,
                            'sgst_percent',
                            parseNonNegativeNumber(e.target.value, { empty: '' })
                          )
                        }
                        className="w-12 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-600">
                      {formatCurrency(it.sgst_amount)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <NumberInput
                        allowEmpty
                        value={it.igst_percent}
                        onChange={(e) =>
                          updateItemField(
                            it._id,
                            'igst_percent',
                            parseNonNegativeNumber(e.target.value, { empty: '' })
                          )
                        }
                        className="w-12 text-center border border-gray-200 rounded px-1 py-0.5 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-600">
                      {formatCurrency(it.igst_amount)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      {formatCurrency(it.net_price)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-gray-900">
                      {formatCurrency(it.total_amount)}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeItem(it._id)}
                        className="p-0.5 rounded hover:bg-red-50 text-red-500"
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </fieldset>

      <PurchaseAccessoryStockConfirmModal
        isOpen={stockConfirmOpen}
        onClose={() => {
          if (!submitting) setStockConfirmOpen(false);
        }}
        summary={stockSummary}
        loading={submitting || stockFetchLoading}
        onConfirmAddToStock={() => persistPurchase(true)}
        onConfirmBillOnly={() => persistPurchase(false)}
      />

      <PaymentAccountFormModal
        isOpen={vendorAccModalOpen}
        onClose={() => setVendorAccModalOpen(false)}
        draft={vendorAccDraft}
        setDraft={setVendorAccDraft}
        fixedAccountGroup="Vendors"
        onSave={saveVendorAccount}
        saveLoading={vendorAccSaving}
      />
      <PaymentAccountFormModal
        isOpen={purchaseAccModalOpen}
        onClose={() => setPurchaseAccModalOpen(false)}
        draft={purchaseAccDraft}
        setDraft={setPurchaseAccDraft}
        fixedAccountGroup="Purchase"
        onSave={savePurchaseAccount}
        saveLoading={purchaseAccSaving}
      />

      <SelectAccessoriesModal
        isOpen={accessoryPickerOpen}
        onClose={() => setAccessoryPickerOpen(false)}
        onSave={addAccessoriesFromModal}
        title="Select items for purchase"
        alreadyAddedAccessoryIds={purchaseAccessoryIds}
        filterAccessory={isCatalogAccessory}
        renderAccessoryMeta={(a) => ` · stock ${getCatalogStockQty(a)}`}
      />

      {/* ── Footer: Remark + Discount/Advance + Totals ── */}
      <fieldset className="border border-gray-200 rounded-lg px-4 pt-2 pb-3 bg-white">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-6">
          {/* Left: Remark */}
          <div>
            <label
              htmlFor="purchase-remark"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Remark
            </label>
            <textarea
              id="purchase-remark"
              placeholder="Type your remark here"
              rows={4}
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm resize-none focus:border-brand outline-none"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </div>

          {/* Center: Discount + Advance */}
          <div className="w-[260px] space-y-3 pt-0.5">
            <div>
              <label
                htmlFor="purchase-total-discount"
                className="block text-[11px] font-medium text-gray-500 mb-1"
              >
                Discount
              </label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                  <input
                    type="radio"
                    name="discountType"
                    value="flat"
                    checked={discountType === 'flat'}
                    onChange={() => setDiscountType('flat')}
                    className="accent-brand"
                  />
                  Flat
                </label>
                <label className="flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap">
                  <input
                    type="radio"
                    name="discountType"
                    value="percent"
                    checked={discountType === 'percent'}
                    onChange={() => setDiscountType('percent')}
                    className="accent-brand"
                  />
                  Per.(%)
                </label>
                <NumberInput
                  id="purchase-total-discount"
                  allowEmpty
                  className="w-24 border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                  value={discountValue}
                  onChange={(e) =>
                    setDiscountValue(parseNonNegativeNumber(e.target.value, { empty: '' }))
                  }
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="purchase-advance"
                className="block text-[11px] font-medium text-gray-500 mb-1"
              >
                Advance
              </label>
              <div className="flex items-center gap-2">
                <NumberInput
                  id="purchase-advance"
                  allowEmpty
                  className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                  value={advance}
                  onChange={(e) =>
                    setAdvance(parseNonNegativeNumber(e.target.value, { empty: '' }))
                  }
                />
                <AccountSelectWithQr
                  accountId={advanceAccountId}
                  accounts={bankCashAccounts}
                  accountKind="payment"
                  size="md"
                  className="min-w-0 flex-1"
                >
                  <select
                    className={fieldShellClass(
                      err('advanceAccountId'),
                      'border rounded px-2 py-1.5 text-sm bg-white w-full focus:border-brand outline-none'
                    )}
                    value={advanceAccountId}
                    onChange={(e) => {
                      setAdvanceAccountId(e.target.value);
                      clearFieldError(setFieldErrors, 'advanceAccountId');
                    }}
                  >
                    <option value="">Select Account</option>
                    {bankCashAccounts.some(
                      (a) => normGroup(a.account_group) === 'bank accounts'
                    ) ? (
                      <optgroup label="Bank Accounts">
                        {bankCashAccounts
                          .filter((a) => normGroup(a.account_group) === 'bank accounts')
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </optgroup>
                    ) : null}
                    {bankCashAccounts.some(
                      (a) => normGroup(a.account_group) === 'cash accounts'
                    ) ? (
                      <optgroup label="Cash Accounts">
                        {bankCashAccounts
                          .filter((a) => normGroup(a.account_group) === 'cash accounts')
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </optgroup>
                    ) : null}
                  </select>
                </AccountSelectWithQr>
              </div>
              <p className="mt-1 text-[10px] text-gray-500 leading-snug">
                Advance is saved as a payment on submit and appears in the income report.
              </p>
              {Number(advance) > 0 && selectedAdvanceAccountName ? (
                <p className="mt-0.5 text-[10px] text-brand leading-snug">
                  {formatCurrency(Number(advance) || 0)} to {selectedAdvanceAccountName}
                </p>
              ) : null}
              {recordedAdvancePayments.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {recordedAdvancePayments.map((payment) => (
                    <p key={payment.id} className="text-[10px] text-gray-600 leading-snug">
                      Recorded: {formatCurrency(Number(payment.amount) || 0)}
                      {payment.payment_account_name ? ` in ${payment.payment_account_name}` : ''}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Right: Summary */}
          <div className="text-xs min-w-[220px]">
            <div className="space-y-[5px]">
              <div className="flex justify-between">
                <span className="text-gray-500">Total Qty:</span>
                <span className="font-semibold text-brand">{totals.total_qty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Taxable Amt.</span>
                <span>{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">CGST Amt.</span>
                <span className="text-brand">{formatCurrency(totals.cgst_total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">SGST Amt.</span>
                <span className="text-brand">{formatCurrency(totals.sgst_total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">IGST Amt.</span>
                <span className="text-brand">{formatCurrency(totals.igst_total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Taxes(+)</span>
                <span>{formatCurrency(totals.tax_total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Net Amt.</span>
                <span>{formatCurrency(totals.net_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Discount(-)</span>
                <span>{formatCurrency(totals.discount_amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Advance(-)</span>
                <span>{formatCurrency(Number(advance) || 0)}</span>
              </div>
            </div>
            <div className="flex justify-between border-t border-gray-300 mt-2 pt-2 font-bold text-sm">
              <span>Payable Amt.</span>
              <span>{formatCurrency(payable)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-gray-200">
          <button
            type="button"
            onClick={() => navigate('/purchases')}
            disabled={submitting}
            className="px-5 py-2 text-sm font-medium border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <Button onClick={handleSubmit} loading={submitting}>
            Submit
          </Button>
        </div>
      </fieldset>
    </div>
  );
};

CreatePurchase.propTypes = {
  mode: PropTypes.oneOf(['create', 'edit']),
};

CreatePurchase.defaultProps = {
  mode: 'create',
};

function catalogPurchasePrice(catalog) {
  if (!catalog) return 0;
  const pp = Number(catalog?.purchase_price);
  if (Number.isFinite(pp) && pp > 0) return pp;
  return Number(catalog?.price ?? 0) || 0;
}

function isCatalogAccessory() {
  return true;
}

function isCatalogProduct() {
  return true;
}

function getCatalogStockQty(row) {
  return Math.max(0, Number(row?.qty ?? row?.catalog_qty ?? 0) || 0);
}

export default CreatePurchase;
