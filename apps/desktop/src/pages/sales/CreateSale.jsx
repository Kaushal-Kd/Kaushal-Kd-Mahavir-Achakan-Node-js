import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  accessoryRentableQty,
  formatAccessoryQtyExceededMessage,
  formatAccessorySpareMessage,
  formatCurrency,
  isIndianPhone,
  todayIndiaISODate,
} from '@wrs/shared';
import { Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import SelectAccessoriesModal from '../../components/catalog/SelectAccessoriesModal.jsx';
import SelectProductsModal from '../../components/catalog/SelectProductsModal.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import NumberInput from '../../components/ui/NumberInput.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { parseNonNegativeNumber } from '../../lib/numberInput.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { productsApi } from '../../lib/api/products.js';
import { validateSellProductQty } from '../../lib/productAvailability.js';
import { salesApi } from '../../lib/api/sales.js';
import { buildSalesmanSelectOptions } from '../../lib/salesmanOptions.js';
import { usersApi } from '../../lib/api/users.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useAppSettings } from '../../hooks/useAppSettings.js';
import {
  computeItemTotals,
  computeTransactionTotals,
  round2,
} from '../../lib/transactionLineTotals.js';
import { invalidateSalesDomain } from '../../lib/queryInvalidation.js';
import { clearFieldError, fieldShellClass, rejectSubmit } from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';

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

const CreateSale = ({ mode }) => {
  const { id: saleId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { gst } = useAppSettings();
  const isEdit = mode === 'edit' && !!saleId;

  const [saleDate, setSaleDate] = useState(todayStr());
  const [billType, setBillType] = useState('kaccha');
  const [customerName, setCustomerName] = useState('');
  const [contactNo, setContactNo] = useState('');
  const [address, setAddress] = useState('');
  const [salesPersonId, setSalesPersonId] = useState('');
  const [remark, setRemark] = useState('');
  const [discountType, setDiscountType] = useState('flat');
  const [discountValue, setDiscountValue] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [advanceAccountId, setAdvanceAccountId] = useState('');
  const [items, setItems] = useState([]);
  const [saleType, setSaleType] = useState('item');

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
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const customerFieldRef = useRef(null);
  const itemsFieldRef = useRef(null);
  const err = (key) => fieldErrors[key];

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });

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
    queryKey: ['products', 'sale-search', itemSearch],
    queryFn: () => productsApi.list({ search: itemSearch, per_page: 50, sale_only: true }),
    enabled: saleType === 'product' && itemSearch.length > 0,
  });
  const productOptions = useMemo(
    () => (productsQuery.data?.data || []).filter(isSellableProduct),
    [productsQuery.data]
  );

  const saleQuery = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => salesApi.get(saleId),
    enabled: isEdit,
  });

  const shopUsersQuery = useQuery({
    queryKey: ['users', 'sale-salesman'],
    queryFn: () => usersApi.list({ per_page: 200, is_active: 'true' }),
    staleTime: 60_000,
  });

  const salesmanOptions = useMemo(() => {
    const sale = saleQuery.data?.data;
    const extras = sale?.sales_person_id
      ? [{ id: sale.sales_person_id, label: sale.sales_person_name }]
      : [];
    return buildSalesmanSelectOptions(shopUsersQuery.data?.data || [], currentUser, extras);
  }, [shopUsersQuery.data, currentUser, saleQuery.data?.data]);

  useEffect(() => {
    if (isEdit || salesPersonId) return;
    if (currentUser?.id && salesmanOptions.some((o) => o.value === currentUser.id)) {
      setSalesPersonId(currentUser.id);
    }
  }, [isEdit, currentUser?.id, salesPersonId, salesmanOptions]);

  const recordedAdvancePayments = useMemo(() => {
    if (!isEdit) return [];
    return (saleQuery.data?.data?.payments || []).filter((p) => Number(p.amount) > 0);
  }, [isEdit, saleQuery.data]);

  useEffect(() => {
    if (!isEdit || !saleQuery.data?.data) return;
    const s = saleQuery.data.data;
    setSaleDate(String(s.sale_date || '').slice(0, 10) || todayStr());
    setBillType(s.bill_type || (Number(s.tax_total || 0) > 0 ? 'gst' : 'kaccha'));
    setCustomerName(s.customer_name || '');
    setContactNo(s.contact_no || '');
    setAddress(s.address || '');
    setSalesPersonId(s.sales_person_id || '');
    setRemark(s.remark || '');
    setDiscountType(s.discount_type || 'flat');
    setDiscountValue(Number(s.discount_value) || 0);
    setAdvance(Number(s.advance) || 0);
    setAdvanceAccountId(s.advance_account_id || '');
    const saleItems = s.items || [];
    const hasProduct = saleItems.some((it) => it.item_type === 'product' && it.product_id);
    const hasAccessory = saleItems.some((it) => it.item_type === 'item' && it.accessory_id);
    setSaleType(hasProduct && !hasAccessory ? 'product' : 'item');
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
  }, [isEdit, saleQuery.data]);

  const handleBillTypeChange = useCallback(
    (nextBillType) => {
      setBillType(nextBillType);
      const configuredRates =
        nextBillType === 'gst'
          ? { cgst_percent: Number(gst.cgst || 0), sgst_percent: Number(gst.sgst || 0) }
          : { cgst_percent: 0, sgst_percent: 0 };
      setAddCgst(configuredRates.cgst_percent);
      setAddSgst(configuredRates.sgst_percent);
      setAddIgst(0);
      setItems((current) =>
        current.map((item) => {
          const hasTaxRate =
            Number(item.cgst_percent) || Number(item.sgst_percent) || Number(item.igst_percent);
          if (nextBillType === 'gst' && hasTaxRate) return item;
          return computeItemTotals({
            ...item,
            ...configuredRates,
            igst_percent: 0,
          });
        })
      );
    },
    [gst.cgst, gst.sgst]
  );

  const searchResults = productOptions;

  const saleAccessoryIds = useMemo(
    () =>
      items
        .filter((it) => it.item_type === 'item' && it.accessory_id)
        .map((it) => String(it.accessory_id)),
    [items]
  );

  const saleProductIds = useMemo(
    () =>
      items
        .filter((it) => it.item_type === 'product' && it.product_id)
        .map((it) => String(it.product_id)),
    [items]
  );

  const selectedAvailableQty = useMemo(() => {
    if (!selectedItem?.id) return null;
    return getSaleAvailableQty(getCatalogStockQty(selectedItem), items, saleType, selectedItem);
  }, [selectedItem, items, saleType]);

  const selectItem = useCallback(
    (item) => {
      if (item?.id) {
        const available = getSaleAvailableQty(getCatalogStockQty(item), items, saleType, item);
        if (available <= 0) {
          warnSaleStockLimit(item, 0);
          return;
        }
        setSelectedItem(item);
        setItemSearch(item.name || item.code || '');
        setAddPrice(catalogSellPrice(item));
        setAddDiscount(0);
        setAddQty(Math.min(1, available));
        setAddCgst(billType === 'gst' ? Number(gst.cgst || 0) : 0);
        setAddSgst(billType === 'gst' ? Number(gst.sgst || 0) : 0);
        setAddIgst(0);
        return;
      }
      setSelectedItem(item);
      setItemSearch(item.name || item.code || '');
      setAddPrice(catalogSellPrice(item));
      setAddDiscount(0);
      setAddQty(1);
      setAddCgst(billType === 'gst' ? Number(gst.cgst || 0) : 0);
      setAddSgst(billType === 'gst' ? Number(gst.sgst || 0) : 0);
      setAddIgst(0);
    },
    [billType, gst.cgst, gst.sgst, items, saleType]
  );

  const incrementAddQty = useCallback(() => {
    if (!selectedItem && !itemSearch.trim()) {
      toast.warning('Select an item first');
      return;
    }
    if (selectedItem?.id) {
      const available = getSaleAvailableQty(
        getCatalogStockQty(selectedItem),
        items,
        saleType,
        selectedItem
      );
      const nextQty = Math.max(1, Number(addQty) || 1) + 1;
      if (nextQty > available) {
        warnSaleStockLimit(selectedItem, available, nextQty);
        return;
      }
      setAddQty(nextQty);
      return;
    }
    setAddQty((prev) => Math.max(1, Number(prev) || 1) + 1);
  }, [addQty, itemSearch, items, saleType, selectedItem]);

  const handleAddQtyChange = useCallback(
    (value) => {
      if (value === '' || value == null) {
        setAddQty('');
        return;
      }
      const nextQty = Math.max(1, Number(value) || 1);
      if (!selectedItem?.id) {
        setAddQty(nextQty);
        return;
      }
      const available = getSaleAvailableQty(
        getCatalogStockQty(selectedItem),
        items,
        saleType,
        selectedItem
      );
      if (nextQty > available) {
        warnSaleStockLimit(selectedItem, available, nextQty);
        setAddQty(Math.max(1, available));
        return;
      }
      setAddQty(nextQty);
    },
    [items, saleType, selectedItem]
  );

  useEffect(() => {
    const p = Number(addPrice) || 0;
    const d = Number(addDiscount) || 0;
    setAddTaxable(round2(Math.max(0, p - d)));
  }, [addPrice, addDiscount]);

  const addItemToList = async () => {
    if (!selectedItem && !itemSearch.trim()) {
      toast.warning('Select an item first');
      return;
    }
    const name = selectedItem?.name || itemSearch.trim();
    if (!name) return;

    const nextQty = addQty === '' || addQty == null ? 1 : Math.max(1, Number(addQty) || 1);
    if (saleType === 'product' && selectedItem?.id) {
      const sellResult = await validateSellProductQty({
        productId: selectedItem.id,
        label: selectedItem.name || selectedItem.code || name,
      });
      if (!sellResult.ok) {
        toast.warning(sellResult.message);
        return;
      }
    }
    if (selectedItem?.id) {
      const available = getSaleAvailableQty(
        getCatalogStockQty(selectedItem),
        items,
        saleType,
        selectedItem
      );
      if (nextQty > available) {
        warnSaleStockLimit(selectedItem, available, nextQty);
        return;
      }
    }

    const newItem = {
      _id: localId(),
      item_type: saleType,
      product_id: saleType === 'product' ? selectedItem?.id || null : null,
      accessory_id: saleType === 'item' ? selectedItem?.id || null : null,
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
    setAddCgst(billType === 'gst' ? Number(gst.cgst || 0) : 0);
    setAddSgst(billType === 'gst' ? Number(gst.sgst || 0) : 0);
    setAddIgst(0);
  };

  const addProductsFromModal = async (picked) => {
    if (!picked?.length) return;
    let added = 0;
    let skipped = 0;
    const next = [...items];
    for (const product of picked) {
      const sellResult = await validateSellProductQty({
        productId: product.id,
        label: product.name || product.code || 'Product',
      });
      if (!sellResult.ok) {
        skipped += 1;
        toast.warning(sellResult.message);
        continue;
      }
      const available = getSaleAvailableQty(getCatalogStockQty(product), next, 'product', product);
      if (available <= 0) {
        skipped += 1;
        continue;
      }
      const price = catalogSellPrice(product);
      next.push(
        computeItemTotals({
          _id: localId(),
          item_type: 'product',
          product_id: product.id,
          accessory_id: null,
          name_snapshot: product.name || product.code || '',
          qty: 1,
          catalog_qty: getCatalogStockQty(product),
          price,
          discount: 0,
          taxable_price: price,
          cgst_percent: billType === 'gst' ? Number(gst.cgst || 0) : 0,
          cgst_amount: 0,
          sgst_percent: billType === 'gst' ? Number(gst.sgst || 0) : 0,
          sgst_amount: 0,
          igst_percent: 0,
          igst_amount: 0,
          net_price: 0,
          total_amount: 0,
        })
      );
      added += 1;
    }
    if (added > 0) setItems(next);
    if (added > 0) toast.success(`Added ${added} product${added === 1 ? '' : 's'}`);
    if (skipped > 0)
      toast.warning(`${skipped} product${skipped === 1 ? '' : 's'} skipped — unavailable`);
  };

  const addAccessoriesFromModal = (picked) => {
    if (!picked?.length) return;
    let added = 0;
    let skipped = 0;
    setItems((prev) => {
      const next = [...prev];
      for (const acc of picked) {
        const available = getSaleAvailableQty(getCatalogStockQty(acc), next, 'item', acc);
        if (available <= 0) {
          skipped += 1;
          continue;
        }
        const price = catalogSellPrice(acc);
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
            cgst_percent: billType === 'gst' ? Number(acc.cgst_percent ?? gst.cgst ?? 0) || 0 : 0,
            cgst_amount: 0,
            sgst_percent: billType === 'gst' ? Number(acc.sgst_percent ?? gst.sgst ?? 0) || 0 : 0,
            sgst_amount: 0,
            igst_percent: billType === 'gst' ? Number(acc.igst_percent) || 0 : 0,
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
    if (skipped > 0)
      toast.warning(`${skipped} item${skipped === 1 ? '' : 's'} skipped — out of stock`);
  };

  const removeItem = (id) => {
    setItems((prev) => prev.filter((it) => it._id !== id));
  };

  const updateItemField = async (id, field, value) => {
    if (field === 'qty') {
      const row = items.find((it) => it._id === id);
      if (row?.product_id) {
        const nextQty = Math.max(1, Number(value) || 1);
        const sellResult = await validateSellProductQty({
          productId: row.product_id,
          label: row.name_snapshot || 'Product',
        });
        if (!sellResult.ok) {
          toast.warning(sellResult.message);
          return;
        }
      }
    }
    setItems((prev) =>
      prev.map((it) => {
        if (it._id !== id) return it;
        if (field === 'qty' && (it.product_id || it.accessory_id)) {
          const nextQty = Math.max(1, Number(value) || 1);
          const available = getSaleAvailableQty(
            Number(it.catalog_qty ?? 0),
            prev,
            it.item_type,
            it,
            { omitLineId: id }
          );
          if (nextQty > available) {
            warnSaleStockLimit(it, available, nextQty);
            return computeItemTotals({ ...it, qty: Math.max(1, available) });
          }
        }
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

  const handleSubmit = async () => {
    if (submitLockRef.current || submitting) return;

    const errors = {};
    let firstMessage = null;
    const add = (key, msg) => {
      if (!errors[key]) errors[key] = msg;
      if (!firstMessage) firstMessage = msg;
    };

    if (!customerName.trim()) add('customerName', 'Customer name is required');
    const contactDigits = contactNo.replace(/\D/g, '');
    if (contactDigits && !isIndianPhone(contactDigits)) {
      add('contactNo', 'Enter a valid 10-digit mobile number');
    }
    if (items.length === 0) add('items', 'Add at least one item');
    else if (items.some((it) => !it.product_id && !it.accessory_id)) {
      add('items', 'Each line must be picked from the catalog (Product Sale or Accessory Sale)');
    }
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
        fieldRefs: { customerName: customerFieldRef, items: itemsFieldRef },
        scrollOrder: ['customerName', 'items', 'advanceAccountId'],
      })
    ) {
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        sale_date: saleDate,
        bill_type: billType,
        customer_name: customerName.trim(),
        contact_no: contactDigits || null,
        address: address.trim() || null,
        sales_person_id: salesPersonId || null,
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

      if (isEdit) {
        await salesApi.update(saleId, payload);
        toast.success('Sale updated');
      } else {
        await salesApi.create(payload);
        toast.success('Sale created');
      }
      await invalidateSalesDomain(queryClient);
      navigate('/sales');
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error?.message ||
        'Failed to save sale';
      toast.error(msg);
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
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

  const saleNumber = isEdit ? saleQuery.data?.data?.sale_number : null;

  return (
    <div className="overflow-auto">
      <PageHeader
        title={isEdit ? 'Edit Sale' : 'Create Sale'}
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'Sales', to: '/sales' },
          { label: isEdit ? 'Edit Sale' : 'Create Sale' },
        ]}
      />
      {saleNumber ? (
        <div className="-mt-2 mb-4">
          <span className="inline-block font-mono text-xs px-2 py-0.5 rounded border border-brand/25 bg-brand-light text-brand">
            {saleNumber}
          </span>
        </div>
      ) : null}

      {/* ── Customer Details ── */}
      <fieldset
        ref={customerFieldRef}
        className={clsx(
          'border rounded-lg px-4 pt-2 pb-3 mb-4 bg-white',
          err('customerName') ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200'
        )}
      >
        <legend className="text-xs font-semibold text-gray-600 px-1">Customer Details</legend>
        <div className="grid grid-cols-4 gap-x-5 gap-y-2">
          <div>
            <label
              htmlFor="sale-date"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Date<span className="text-red-500">*</span>
            </label>
            <input
              id="sale-date"
              type="date"
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="sale-customer-name"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Name<span className="text-red-500">*</span>
            </label>
            <input
              id="sale-customer-name"
              type="text"
              placeholder="Customer Name"
              className={fieldShellClass(
                err('customerName'),
                'w-full border rounded px-2.5 py-1.5 text-sm focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none'
              )}
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
                clearFieldError(setFieldErrors, 'customerName');
              }}
            />
            {err('customerName') ? (
              <p className="text-xs text-red-600 mt-0.5">{err('customerName')}</p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="sale-contact-number"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Contact No.
            </label>
            <input
              id="sale-contact-number"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile"
              className={fieldShellClass(
                err('contactNo'),
                'w-full border rounded px-2.5 py-1.5 text-sm focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none'
              )}
              value={contactNo}
              onChange={(e) => {
                setContactNo(e.target.value.replace(/\D/g, '').slice(0, 10));
                clearFieldError(setFieldErrors, 'contactNo');
              }}
            />
            {err('contactNo') ? (
              <p className="text-xs text-red-600 mt-0.5">{err('contactNo')}</p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="sale-bill-type"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Bill Type
            </label>
            <select
              id="sale-bill-type"
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm bg-white focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none"
              value={billType}
              onChange={(event) => handleBillTypeChange(event.target.value)}
            >
              <option value="kaccha">Kaccha Bill</option>
              <option value="gst">GST Bill</option>
            </select>
          </div>
          <div className="col-span-2">
            <label
              htmlFor="sale-customer-address"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Address<span className="text-red-500">*</span>
            </label>
            <textarea
              id="sale-customer-address"
              placeholder="Type your address here"
              rows={1}
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm resize-none focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="sale-salesman"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Salesman
            </label>
            <select
              id="sale-salesman"
              className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-sm bg-white focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none"
              value={salesPersonId}
              onChange={(e) => setSalesPersonId(e.target.value)}
            >
              <option value="">Select salesman</option>
              {salesmanOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
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
                name="saleType"
                value="item"
                checked={saleType === 'item'}
                onChange={() => {
                  setSaleType('item');
                  setSelectedItem(null);
                  setItemSearch('');
                  setAccessoryPickerOpen(false);
                  setProductPickerOpen(false);
                }}
                className="accent-brand"
              />
              Accessory Sale
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="radio"
                name="saleType"
                value="product"
                checked={saleType === 'product'}
                onChange={() => {
                  setSaleType('product');
                  setSelectedItem(null);
                  setItemSearch('');
                  setAccessoryPickerOpen(false);
                  setProductPickerOpen(false);
                }}
                className="accent-brand"
              />
              Product Sale
            </label>
          </div>

          {saleType === 'item' ? (
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
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" onClick={() => setProductPickerOpen(true)}>
                  Select Products
                </Button>
                <span className="text-xs text-gray-500">
                  Sells catalog products — updates Product List qty and Sold status.
                </span>
              </div>
              <div className="flex flex-nowrap items-end gap-2">
                <div className="w-[min(480px,100%)] shrink-0">
                  <div className="flex justify-end min-h-[14px] mb-0.5">
                    {selectedItem ? (
                      <span
                        className={`text-xs font-semibold leading-none ${
                          Number(selectedAvailableQty ?? 0) <= 0 ? 'text-red-600' : 'text-green-600'
                        }`}
                      >
                        {Number(selectedAvailableQty ?? 0)}
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
                          const available = getSaleAvailableQty(
                            getCatalogStockQty(r),
                            items,
                            saleType,
                            r
                          );
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
                                className={`shrink-0 text-xs ${available <= 0 ? 'text-red-500' : 'text-gray-400'}`}
                              >
                                Stock: {available}
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
                    htmlFor="sale-line-quantity"
                    className="block text-[10px] font-medium text-gray-500 mb-0.5"
                  >
                    Qty<span className="text-red-500">*</span>
                  </label>
                  <NumberInput
                    id="sale-line-quantity"
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
        {saleType === 'product' ? (
          <div className="flex items-end gap-2.5 mb-3">
            <div>
              <label
                htmlFor="sale-line-price"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Price
              </label>
              <NumberInput
                id="sale-line-price"
                allowEmpty
                className="w-[80px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addPrice}
                onChange={(e) => setAddPrice(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="sale-line-discount"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Discount
              </label>
              <NumberInput
                id="sale-line-discount"
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
                htmlFor="sale-line-taxable-price"
                className="block text-[10px] font-medium text-green-600 mb-0.5"
              >
                Taxable Price
              </label>
              <NumberInput
                id="sale-line-taxable-price"
                readOnly
                className="w-[80px] border border-green-200 rounded px-2 py-1.5 text-sm bg-green-50 font-semibold text-green-700"
                value={addTaxable}
              />
            </div>
            <div>
              <label
                htmlFor="sale-line-cgst"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                CGST(%)
              </label>
              <NumberInput
                id="sale-line-cgst"
                allowEmpty
                className="w-[65px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addCgst}
                onChange={(e) => setAddCgst(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="sale-line-sgst"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                SGST(%)
              </label>
              <NumberInput
                id="sale-line-sgst"
                allowEmpty
                className="w-[65px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addSgst}
                onChange={(e) => setAddSgst(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="sale-line-igst"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                IGST(%)
              </label>
              <NumberInput
                id="sale-line-igst"
                allowEmpty
                className="w-[65px] border border-gray-300 rounded px-2 py-1.5 text-sm focus:border-brand outline-none"
                value={addIgst}
                onChange={(e) => setAddIgst(parseNonNegativeNumber(e.target.value, { empty: '' }))}
              />
            </div>
            <div>
              <label
                htmlFor="sale-line-net-price"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Net Price
              </label>
              <NumberInput
                id="sale-line-net-price"
                readOnly
                className="w-[80px] border border-gray-200 rounded px-2 py-1.5 text-sm bg-gray-50"
                value={addRowNetPrice}
              />
            </div>
            <div>
              <label
                htmlFor="sale-line-total"
                className="block text-[10px] font-medium text-gray-500 mb-0.5"
              >
                Total Amt.
              </label>
              <NumberInput
                id="sale-line-total"
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
                    <td className="px-3 py-1.5 font-medium text-gray-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={it.product_id ? 'brand' : 'gray'}>
                          {saleLineKindLabel(it)}
                        </Badge>
                        <span>{it.name_snapshot}</span>
                      </div>
                    </td>
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

      <SelectProductsModal
        isOpen={productPickerOpen}
        onClose={() => setProductPickerOpen(false)}
        onSave={addProductsFromModal}
        title="Select products for sale"
        alreadyAddedProductIds={saleProductIds}
        filterProduct={isSellableProduct}
        renderProductMeta={(p) => {
          const available = getSaleAvailableQty(getCatalogStockQty(p), items, 'product', p);
          return ` · stock ${available}`;
        }}
      />

      <SelectAccessoriesModal
        isOpen={accessoryPickerOpen}
        onClose={() => setAccessoryPickerOpen(false)}
        onSave={addAccessoriesFromModal}
        title="Select items for sale"
        alreadyAddedAccessoryIds={saleAccessoryIds}
        filterAccessory={isSellableAccessory}
        renderAccessoryMeta={(a) => {
          const available = getSaleAvailableQty(getCatalogStockQty(a), items, 'item', a);
          return ` · available ${available}`;
        }}
      />

      {/* ── Footer: Remark + Discount/Advance + Totals ── */}
      <fieldset className="border border-gray-200 rounded-lg px-4 pt-2 pb-3 bg-white">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-6">
          {/* Left: Remark */}
          <div>
            <label
              htmlFor="sale-remark"
              className="block text-[11px] font-medium text-gray-500 mb-0.5"
            >
              Remark
            </label>
            <textarea
              id="sale-remark"
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
                htmlFor="sale-total-discount"
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
                  id="sale-total-discount"
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
                htmlFor="sale-advance"
                className="block text-[11px] font-medium text-gray-500 mb-1"
              >
                Advance
              </label>
              <div className="flex items-center gap-2">
                <NumberInput
                  id="sale-advance"
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
              {err('advanceAccountId') ? (
                <p className="text-xs text-red-600 mt-1">{err('advanceAccountId')}</p>
              ) : null}
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
            onClick={() => navigate('/sales')}
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

CreateSale.propTypes = {
  mode: PropTypes.oneOf(['create', 'edit']),
};

CreateSale.defaultProps = {
  mode: 'create',
};

function catalogSellPrice(catalog) {
  const sell = Number(catalog?.price_sell ?? catalog?.catalog_price_sell ?? 0);
  if (Number.isFinite(sell)) return sell;
  return Number(catalog?.price ?? 0) || 0;
}

function isSellableAccessory(row) {
  const kind = String(row?.default_type || 'both').toLowerCase();
  return kind === 'sell' || kind === 'both';
}

function saleLineKindLabel(row) {
  if (row?.product_id || row?.item_type === 'product') return 'Product';
  if (row?.accessory_id || row?.item_type === 'item') return 'Accessory';
  return 'Unknown';
}

function isSellableProduct(row) {
  const type = String(row?.type || 'both');
  return type === 'sell' || type === 'both';
}

function isAccessoryStockRow(row) {
  if (row?.accessory_id != null) return true;
  if (String(row?.item_type) === 'item') return true;
  return row?.default_type != null && row?.type == null;
}

function getAccessorySpareQty(row) {
  return Math.max(0, Number(row?.spare_qty ?? 0) || 0);
}

function getAccessoryDamagedQty(row) {
  return Math.max(0, Number(row?.damaged_qty ?? 0) || 0);
}

function warnSaleStockLimit(row, available, requestedQty) {
  const name = row?.name || row?.name_snapshot || 'Item';
  if (isAccessoryStockRow(row)) {
    const spare = getAccessorySpareQty(row);
    const damaged = getAccessoryDamagedQty(row);
    if (requestedQty != null && Number(requestedQty) > available) {
      toast.warning(
        formatAccessoryQtyExceededMessage(name, requestedQty, available, spare, 'sell', damaged)
      );
    } else {
      toast.warning(formatAccessorySpareMessage(name, spare, available, 'sell', damaged));
    }
    return;
  }
  toast.warning(
    available <= 0 ? 'No stock available for this item' : `Only ${available} available in stock`
  );
}

function getCatalogStockQty(row) {
  if (isAccessoryStockRow(row)) {
    if (row?.rentable_qty != null) return Math.max(0, Number(row.rentable_qty) || 0);
    if (row?.catalog_qty != null && row?.spare_qty == null && row?.qty == null) {
      return Math.max(0, Number(row.catalog_qty) || 0);
    }
    return accessoryRentableQty(row);
  }
  return Math.max(0, Number(row?.qty ?? row?.catalog_qty ?? 0) || 0);
}

function getSaleStockKey(itemType, row) {
  const productId = row?.product_id ?? (String(itemType) === 'product' ? row?.id : null);
  const accessoryId = row?.accessory_id ?? (String(itemType) === 'item' ? row?.id : null);
  if (productId) return `p:${productId}`;
  if (accessoryId) return `a:${accessoryId}`;
  return '';
}

function collectSaleLineAllocations(lines, options = {}) {
  const omitLineId = options.omitLineId ? String(options.omitLineId) : '';
  const map = new Map();

  for (const line of lines || []) {
    if (omitLineId && String(line._id) === omitLineId) continue;
    const key = getSaleStockKey(line.item_type, line);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + Number(line.qty || 0));
  }

  return map;
}

function getSaleAvailableQty(catalogQty, lines, itemType, row, options = {}) {
  const key = getSaleStockKey(itemType, row);
  if (!key) return catalogQty;

  const allocatedElsewhere = collectSaleLineAllocations(lines, options).get(key) || 0;
  let reclaimQty = 0;

  if (options.omitLineId) {
    const line = (lines || []).find((entry) => String(entry._id) === String(options.omitLineId));
    if (line && getSaleStockKey(line.item_type, line) === key) {
      reclaimQty += Number(line.qty || 0);
    }
  }

  return Math.max(0, catalogQty - allocatedElsewhere + reclaimQty);
}

export default CreateSale;
