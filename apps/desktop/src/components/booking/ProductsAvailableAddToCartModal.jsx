import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIsoDateDisplay, isIndianPhone } from '@wrs/shared';
import { Plus, Search, UserPlus, XCircle } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addProductToAvailabilityCart,
  AVAILABILITY_CART_DRAFT_KIND,
  draftToCartLine,
} from '../../lib/availabilityCart.js';
import { customersApi } from '../../lib/api/customers.js';
import { draftsApi } from '../../lib/api/drafts.js';
import { timeSlotsApi } from '../../lib/api/timeSlots.js';
import { queryKeys } from '../../lib/queryKeys.js';
import {
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
  FALLBACK_TIME_OPTIONS,
  resolveTimeSlotDefaults,
  timeSlotsToSelectOptions,
} from '../../lib/timeSelectOptions.js';
import { toast } from '../../stores/uiStore.js';
import Button from '../ui/Button.jsx';
import DatePicker from '../ui/DatePicker.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';
import Select from '../ui/Select.jsx';

const ProductsAvailableAddToCartModal = ({
  isOpen,
  onClose,
  product,
  deliveryDate,
  returnDate,
}) => {
  const queryClient = useQueryClient();
  const [qty, setQty] = useState(1);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customer, setCustomer] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [deliveryTime, setDeliveryTime] = useState(FALLBACK_DEFAULT_DELIVERY_TIME);
  const [returnTime, setReturnTime] = useState(FALLBACK_DEFAULT_RETURN_TIME);
  const [saving, setSaving] = useState(false);

  const freeQty = Number(product?.free_qty ?? 0);

  useEffect(() => {
    if (!isOpen) return;
    setQty(1);
    setCustomer(null);
    setCustomerQuery('');
    setCustomerOpen(false);
  }, [isOpen, product?.id]);

  const { data: customerResults } = useQuery({
    queryKey: ['customer-search', customerQuery, 'products-available-cart'],
    queryFn: () => customersApi.search(customerQuery),
    enabled: isOpen && customerQuery.trim().length >= 2,
  });

  const timeSlotsQuery = useQuery({
    queryKey: ['time-slots'],
    queryFn: () => timeSlotsApi.list(),
    enabled: isOpen,
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
    if (!isOpen) return;
    if (defaultTimesAppliedRef.current) return;
    if (!timeSlotsQuery.isSuccess) return;
    defaultTimesAppliedRef.current = true;
    setDeliveryTime(defaultBookingTimes.delivery);
    setReturnTime(defaultBookingTimes.return);
  }, [isOpen, timeSlotsQuery.isSuccess, defaultBookingTimes.delivery, defaultBookingTimes.return]);

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
      toast.error(
        err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err.message ||
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

  const modalTitle = product
    ? `Add to Cart / Code: ${product.code}${product.size ? ` [${product.size}]` : ''}`
    : 'Add to Cart';

  const handleAdd = async () => {
    if (!product?.id) return;
    if (!customer) {
      toast.warning('Please select a customer');
      setCustomerOpen(true);
      return;
    }
    if (!deliveryDate || !returnDate) {
      toast.warning('Delivery and return dates are required');
      return;
    }
    if (deliveryDate > returnDate) {
      toast.error('Return date must be after delivery date');
      return;
    }
    const requestedQty = Math.max(1, Number(qty) || 1);

    setSaving(true);
    try {
      const res = await draftsApi.list({ kind: AVAILABILITY_CART_DRAFT_KIND });
      const cart = (res?.data || []).map(draftToCartLine);

      await addProductToAvailabilityCart({
        cart,
        customer,
        product,
        from: deliveryDate,
        to: returnDate,
        qty: requestedQty,
        deliveryTime,
        returnTime,
      });

      toast.success(`Added to ${customer.name}'s cart`);
      queryClient.invalidateQueries({ queryKey: queryKeys.drafts.availabilityCart });
      onClose();
    } catch (err) {
      toast.error(
        err?.response?.data?.error?.message || err.message || 'Failed to save cart'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" title={modalTitle}>
      {product ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="Delivery"
              value={deliveryDate}
              disabled
              onChange={() => {}}
            />
            <DatePicker
              label="Return"
              value={returnDate}
              disabled
              onChange={() => {}}
            />
          </div>
          {(deliveryDate || returnDate) && (
            <p className="text-[11px] text-gray-500 -mt-2">
              {deliveryDate ? formatIsoDateDisplay(deliveryDate) : '—'} →{' '}
              {returnDate ? formatIsoDateDisplay(returnDate) : '—'}
            </p>
          )}

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
                  <div className="text-sm font-semibold text-gray-900 truncate">{customer.name}</div>
                  {customer.phone1 ? (
                    <div className="text-[11px] text-gray-500 leading-tight">{customer.phone1}</div>
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
                    if (rows.length === 0) tryInlineCreateCustomerFromSearch();
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

          <Input
            label="Qty"
            type="number"
            min={1}
            max={freeQty > 0 ? freeQty : 1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            hint={freeQty > 0 ? `Max ${freeQty} free in range` : undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Delivery time"
              value={deliveryTime}
              onChange={(e) => setDeliveryTime(e.target.value)}
              options={timeSelectOptions}
            />
            <Select
              label="Return time"
              value={returnTime}
              onChange={(e) => setReturnTime(e.target.value)}
              options={timeSelectOptions}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleAdd} loading={saving} disabled={!customer || saving}>
              Add to Cart
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
};

ProductsAvailableAddToCartModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  product: PropTypes.shape({
    id: PropTypes.string.isRequired,
    code: PropTypes.string,
    name: PropTypes.string,
    size: PropTypes.string,
    category_id: PropTypes.string,
    main_image: PropTypes.string,
    price_rent: PropTypes.number,
    free_qty: PropTypes.number,
    total_qty: PropTypes.number,
    booked_qty: PropTypes.number,
  }),
  deliveryDate: PropTypes.string.isRequired,
  returnDate: PropTypes.string.isRequired,
};

ProductsAvailableAddToCartModal.defaultProps = {
  product: null,
};

export default ProductsAvailableAddToCartModal;
