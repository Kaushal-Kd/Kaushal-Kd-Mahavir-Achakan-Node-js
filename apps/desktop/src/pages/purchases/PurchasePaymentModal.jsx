import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2 } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { purchasesApi } from '../../lib/api/purchases.js';
import { toast } from '../../stores/uiStore.js';

function normGroup(g) {
  return String(g || '').trim().toLowerCase();
}

function toNonNegativeNumber(value) {
  if (value === '' || value == null) return 0;
  return round2(Math.max(0, Number(value) || 0));
}

const PurchasePaymentModal = ({ isOpen, purchaseId, onClose }) => {
  const queryClient = useQueryClient();
  const [payAmount, setPayAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');

  const purchaseQuery = useQuery({
    queryKey: ['purchase', 'payment', purchaseId],
    queryFn: () => purchasesApi.get(purchaseId),
    enabled: Boolean(isOpen && purchaseId),
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen && purchaseId),
  });

  const purchase = purchaseQuery.data?.data;
  const bankCashAccounts = useMemo(() => {
    const all = paymentAccountsQuery.data?.data || [];
    return all.filter(
      (a) => normGroup(a.account_group) === 'bank accounts' || normGroup(a.account_group) === 'cash accounts'
    );
  }, [paymentAccountsQuery.data]);

  const bankAccounts = useMemo(
    () => bankCashAccounts.filter((a) => normGroup(a.account_group) === 'bank accounts'),
    [bankCashAccounts]
  );
  const cashAccounts = useMemo(
    () => bankCashAccounts.filter((a) => normGroup(a.account_group) === 'cash accounts'),
    [bankCashAccounts]
  );

  const totalAmount = useMemo(() => round2(Number(purchase?.net_amount || 0)), [purchase?.net_amount]);
  const discountAmount = useMemo(() => round2(Number(purchase?.discount_amount || 0)), [purchase?.discount_amount]);
  const billAmount = useMemo(() => round2(Number(purchase?.total_amount || 0)), [purchase?.total_amount]);
  const advancePaid = useMemo(() => round2(Number(purchase?.advance || 0)), [purchase?.advance]);
  const payNum = useMemo(() => toNonNegativeNumber(payAmount), [payAmount]);
  const pendingAmount = useMemo(() => round2(Math.max(0, billAmount - advancePaid)), [billAmount, advancePaid]);
  const maxPayNow = pendingAmount;
  const totalPayPreview = useMemo(
    () => round2(Math.max(0, advancePaid + payNum)),
    [advancePaid, payNum]
  );
  const pendingAfterPayPreview = useMemo(
    () => round2(Math.max(0, billAmount - totalPayPreview)),
    [billAmount, totalPayPreview]
  );
  const hasPaymentAccounts = bankCashAccounts.length > 0;
  const payAmountExceedsPending = payNum > maxPayNow;
  const canRecordPayment = Boolean(
    purchase &&
      purchase.status !== 'cancelled' &&
      maxPayNow > 0 &&
      payNum > 0 &&
      !payAmountExceedsPending &&
      String(paymentAccountId || '').trim() &&
      hasPaymentAccounts
  );

  useEffect(() => {
    if (!isOpen || !purchase) return;
    setPayAmount('');
    setPaymentAccountId(purchase.advance_account_id || '');
  }, [isOpen, purchase?.id, purchase?.advance_account_id]);

  useEffect(() => {
    if (!paymentAccountsQuery.isSuccess) return;
    const allowed = new Set(bankCashAccounts.map((a) => a.id));
    if (paymentAccountId && !allowed.has(paymentAccountId)) {
      setPaymentAccountId('');
    }
  }, [paymentAccountsQuery.isSuccess, paymentAccountId, bankCashAccounts]);

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!purchase) throw new Error('missing_purchase');
      if (purchase.status === 'cancelled') {
        toast.warning('Cancelled purchase cannot accept payments');
        throw new Error('validation');
      }
      if (maxPayNow <= 0) {
        toast.warning('This purchase has no pending amount');
        throw new Error('validation');
      }
      if (payNum <= 0) {
        toast.warning('Enter a pay amount greater than zero');
        throw new Error('validation');
      }
      const payId = String(paymentAccountId || '').trim();
      if (!payId) {
        toast.warning('Select the payment account');
        throw new Error('validation');
      }
      if (!hasPaymentAccounts) {
        toast.warning('Add a bank or cash account before recording payment');
        throw new Error('validation');
      }
      if (payNum > maxPayNow) {
        toast.warning(`Pay amount cannot be more than pending (${formatCurrency(maxPayNow)})`);
        throw new Error('validation');
      }
      if (round2(advancePaid + payNum) > billAmount) {
        toast.warning(`Total paid cannot be more than bill amount (${formatCurrency(billAmount)})`);
        throw new Error('validation');
      }
      return purchasesApi.recordPayment(purchase.id, {
        amount: payNum,
        payment_account_id: payId,
        payment_date: String(purchase.purchase_date || '').slice(0, 10) || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Payment recorded');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', purchaseId] });
      onClose?.();
    },
    onError: (err) => {
      if (err?.message === 'validation' || err?.message === 'missing_purchase') return;
      const msg = err?.response?.data?.message || err?.response?.data?.error?.message || 'Payment failed';
      toast.error(msg);
    },
  });

  const submit = (e) => {
    e?.preventDefault?.();
    if (!purchase) return;
    if (purchase.status === 'cancelled') {
      toast.warning('Cancelled purchase cannot accept payments');
      return;
    }
    if (maxPayNow <= 0) {
      toast.warning('This purchase has no pending amount');
      return;
    }
    if (payNum <= 0) {
      toast.warning('Enter a pay amount greater than zero');
      return;
    }
    if (!String(paymentAccountId || '').trim()) {
      toast.warning('Select the payment account');
      return;
    }
    if (!hasPaymentAccounts) {
      toast.warning('Add a bank or cash account before recording payment');
      return;
    }
    if (payNum > maxPayNow) {
      toast.warning(`Pay amount cannot be more than pending (${formatCurrency(maxPayNow)})`);
      return;
    }
    if (round2(advancePaid + payNum) > billAmount) {
      toast.warning(`Total paid cannot be more than bill amount (${formatCurrency(billAmount)})`);
      return;
    }
    submitMut.mutate();
  };

  const handlePayAmountChange = (value) => {
    if (value === '') {
      setPayAmount('');
      return;
    }
    const next = toNonNegativeNumber(value);
    setPayAmount(String(maxPayNow > 0 ? Math.min(next, maxPayNow) : next));
  };

  const loading = submitMut.isPending || purchaseQuery.isLoading || paymentAccountsQuery.isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={purchase ? `Payment of ${purchase.purchase_number}` : 'Payment'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={submitMut.isPending} disabled={purchaseQuery.isLoading || !canRecordPayment}>
            Submit
          </Button>
        </>
      }
    >
      {purchaseQuery.isError ? (
        <p className="text-sm text-red-600">Could not load purchase.</p>
      ) : purchaseQuery.isLoading || !purchase ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : purchase.status === 'cancelled' ? (
        <p className="text-sm text-red-600">Cancelled purchase cannot accept payments.</p>
      ) : maxPayNow <= 0 ? (
        <p className="text-sm text-green-600">This purchase is fully paid. Pending amount is {formatCurrency(0)}.</p>
      ) : (
        <form className="space-y-4 text-sm" onSubmit={submit}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="purchase-payment-total" className="block text-[11px] font-medium text-gray-500 mb-1">Total Amount</label>
              <input
                id="purchase-payment-total"
                readOnly
                value={formatCurrency(totalAmount)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="purchase-payment-discount" className="block text-[11px] font-medium text-gray-500 mb-1">Discount</label>
              <input
                id="purchase-payment-discount"
                readOnly
                value={formatCurrency(discountAmount)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="purchase-payment-bill" className="block text-[11px] font-medium text-gray-500 mb-1">Bill Amount</label>
              <input
                id="purchase-payment-bill"
                readOnly
                value={formatCurrency(billAmount)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="purchase-payment-advance" className="block text-[11px] font-medium text-gray-500 mb-1">Advance</label>
              <input
                id="purchase-payment-advance"
                readOnly
                value={formatCurrency(advancePaid)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="purchase-payment-amount" className="block text-[11px] font-medium text-gray-500 mb-1">Pay Amt.</label>
              <div className="flex gap-2">
                <input
                  id="purchase-payment-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  max={maxPayNow}
                  value={payAmount}
                  onChange={(e) => handlePayAmountChange(e.target.value)}
                  disabled={maxPayNow <= 0}
                  className={`w-24 border rounded h-9 px-3 py-2 text-sm tabular-nums focus:border-brand outline-none ${
                    payAmountExceedsPending ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                <AccountSelectWithQr
                  accountId={paymentAccountId}
                  accounts={bankCashAccounts}
                  accountKind="payment"
                  size="md"
                  className="min-w-0 flex-1"
                >
                  <select
                    className="min-w-0 w-full border border-gray-300 rounded h-9 px-3 py-2 text-sm bg-white focus:border-brand outline-none"
                    value={paymentAccountId}
                    onChange={(e) => setPaymentAccountId(e.target.value)}
                  >
                    <option value="">Select Account</option>
                    {bankAccounts.length > 0 ? (
                      <optgroup label="Bank Accounts">
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {cashAccounts.length > 0 ? (
                      <optgroup label="Cash Accounts">
                        {cashAccounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </AccountSelectWithQr>
              </div>
              {payAmountExceedsPending ? (
                <p className="mt-1 text-xs text-red-600">
                  Pay amount cannot be more than pending ({formatCurrency(maxPayNow)}).
                </p>
              ) : null}
              {!hasPaymentAccounts ? (
                <p className="mt-1 text-xs text-red-600">Add a bank or cash account before recording payment.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="purchase-payment-preview" className="block text-[11px] font-medium text-gray-500 mb-1">Total Pay Amount</label>
              <input
                id="purchase-payment-preview"
                readOnly
                value={formatCurrency(totalPayPreview)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
          </div>

          <p className={`text-sm font-semibold ${pendingAfterPayPreview <= 0 ? 'text-green-600' : 'text-red-600'}`}>
            Pending Amount: {formatCurrency(pendingAfterPayPreview)}
          </p>
        </form>
      )}
    </Modal>
  );
};

PurchasePaymentModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  purchaseId: PropTypes.string,
  onClose: PropTypes.func,
};

PurchasePaymentModal.defaultProps = {
  purchaseId: null,
  onClose: undefined,
};

export default PurchasePaymentModal;
