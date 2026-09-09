import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2 } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { salesApi } from '../../lib/api/sales.js';
import { invalidateSalesDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';

function normGroup(g) {
  return String(g || '').trim().toLowerCase();
}

function toNonNegativeNumber(value) {
  if (value === '' || value == null) return 0;
  return round2(Math.max(0, Number(value) || 0));
}

const SalePaymentModal = ({ isOpen, saleId, onClose }) => {
  const queryClient = useQueryClient();
  const [receiveAmount, setReceiveAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');

  const saleQuery = useQuery({
    queryKey: ['sale', 'payment', saleId],
    queryFn: () => salesApi.get(saleId),
    enabled: Boolean(isOpen && saleId),
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen && saleId),
  });

  const sale = saleQuery.data?.data;
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

  const totalAmount = useMemo(() => round2(Number(sale?.net_amount || 0)), [sale?.net_amount]);
  const discountAmount = useMemo(() => round2(Number(sale?.discount_amount || 0)), [sale?.discount_amount]);
  const billAmount = useMemo(() => round2(Number(sale?.total_amount || 0)), [sale?.total_amount]);
  const advancePaid = useMemo(() => round2(Number(sale?.advance || 0)), [sale?.advance]);
  const receiveNum = useMemo(() => toNonNegativeNumber(receiveAmount), [receiveAmount]);
  const pendingAmount = useMemo(() => round2(Math.max(0, billAmount - advancePaid)), [billAmount, advancePaid]);
  const maxReceiveNow = pendingAmount;
  const totalReceivePreview = useMemo(
    () => round2(Math.max(0, advancePaid + receiveNum)),
    [advancePaid, receiveNum]
  );
  const pendingAfterReceivePreview = useMemo(
    () => round2(Math.max(0, billAmount - totalReceivePreview)),
    [billAmount, totalReceivePreview]
  );
  const hasPaymentAccounts = bankCashAccounts.length > 0;
  const receiveAmountExceedsPending = receiveNum > maxReceiveNow;
  const canRecordPayment = Boolean(
    sale &&
      sale.status !== 'cancelled' &&
      maxReceiveNow > 0 &&
      receiveNum > 0 &&
      !receiveAmountExceedsPending &&
      String(paymentAccountId || '').trim() &&
      hasPaymentAccounts
  );

  useEffect(() => {
    if (!isOpen || !sale) return;
    setReceiveAmount('');
    setPaymentAccountId(sale.advance_account_id || '');
  }, [isOpen, sale?.id, sale?.advance_account_id]);

  useEffect(() => {
    if (!paymentAccountsQuery.isSuccess) return;
    const allowed = new Set(bankCashAccounts.map((a) => a.id));
    if (paymentAccountId && !allowed.has(paymentAccountId)) {
      setPaymentAccountId('');
    }
  }, [paymentAccountsQuery.isSuccess, paymentAccountId, bankCashAccounts]);

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!sale) throw new Error('missing_sale');
      if (sale.status === 'cancelled') {
        toast.warning('Cancelled sale cannot accept payments');
        throw new Error('validation');
      }
      if (maxReceiveNow <= 0) {
        toast.warning('This sale has no pending amount');
        throw new Error('validation');
      }
      if (receiveNum <= 0) {
        toast.warning('Enter a receive amount greater than zero');
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
      if (receiveNum > maxReceiveNow) {
        toast.warning(`Receive amount cannot be more than pending (${formatCurrency(maxReceiveNow)})`);
        throw new Error('validation');
      }
      if (round2(advancePaid + receiveNum) > billAmount) {
        toast.warning(`Total received cannot be more than bill amount (${formatCurrency(billAmount)})`);
        throw new Error('validation');
      }
      return salesApi.recordPayment(sale.id, {
        amount: receiveNum,
        payment_account_id: payId,
        payment_date: String(sale.sale_date || '').slice(0, 10) || undefined,
      });
    },
    onSuccess: async () => {
      toast.success('Payment recorded');
      await invalidateSalesDomain(queryClient, { saleId });
      onClose?.();
    },
    onError: (err) => {
      if (err?.message === 'validation' || err?.message === 'missing_sale') return;
      const msg = err?.response?.data?.message || err?.response?.data?.error?.message || 'Payment failed';
      toast.error(msg);
    },
  });

  const submit = (e) => {
    e?.preventDefault?.();
    if (!sale) return;
    if (sale.status === 'cancelled') {
      toast.warning('Cancelled sale cannot accept payments');
      return;
    }
    if (maxReceiveNow <= 0) {
      toast.warning('This sale has no pending amount');
      return;
    }
    if (receiveNum <= 0) {
      toast.warning('Enter a receive amount greater than zero');
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
    if (receiveNum > maxReceiveNow) {
      toast.warning(`Receive amount cannot be more than pending (${formatCurrency(maxReceiveNow)})`);
      return;
    }
    if (round2(advancePaid + receiveNum) > billAmount) {
      toast.warning(`Total received cannot be more than bill amount (${formatCurrency(billAmount)})`);
      return;
    }
    submitMut.mutate();
  };

  const handleReceiveAmountChange = (value) => {
    if (value === '') {
      setReceiveAmount('');
      return;
    }
    const next = toNonNegativeNumber(value);
    setReceiveAmount(String(maxReceiveNow > 0 ? Math.min(next, maxReceiveNow) : next));
  };

  const loading = submitMut.isPending || saleQuery.isLoading || paymentAccountsQuery.isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={sale ? `Payment of ${sale.sale_number}` : 'Payment'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} loading={submitMut.isPending} disabled={saleQuery.isLoading || !canRecordPayment}>
            Submit
          </Button>
        </>
      }
    >
      {saleQuery.isError ? (
        <p className="text-sm text-red-600">Could not load sale.</p>
      ) : saleQuery.isLoading || !sale ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : sale.status === 'cancelled' ? (
        <p className="text-sm text-red-600">Cancelled sale cannot accept payments.</p>
      ) : maxReceiveNow <= 0 ? (
        <p className="text-sm text-green-600">This sale is fully paid. Pending amount is {formatCurrency(0)}.</p>
      ) : (
        <form className="space-y-4 text-sm" onSubmit={submit}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sale-payment-total" className="block text-[11px] font-medium text-gray-500 mb-1">Total Amount</label>
              <input
                id="sale-payment-total"
                readOnly
                value={formatCurrency(totalAmount)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="sale-payment-discount" className="block text-[11px] font-medium text-gray-500 mb-1">Discount</label>
              <input
                id="sale-payment-discount"
                readOnly
                value={formatCurrency(discountAmount)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="sale-payment-bill" className="block text-[11px] font-medium text-gray-500 mb-1">Bill Amount</label>
              <input
                id="sale-payment-bill"
                readOnly
                value={formatCurrency(billAmount)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label htmlFor="sale-payment-advance" className="block text-[11px] font-medium text-gray-500 mb-1">Advance</label>
              <input
                id="sale-payment-advance"
                readOnly
                value={formatCurrency(advancePaid)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="sale-payment-amount" className="block text-[11px] font-medium text-gray-500 mb-1">Receive Amt.</label>
              <div className="flex gap-2">
                <input
                  id="sale-payment-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  max={maxReceiveNow}
                  value={receiveAmount}
                  onChange={(e) => handleReceiveAmountChange(e.target.value)}
                  disabled={maxReceiveNow <= 0}
                  className={`w-24 border rounded h-9 px-3 py-2 text-sm tabular-nums focus:border-brand outline-none ${
                    receiveAmountExceedsPending ? 'border-red-500' : 'border-gray-300'
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
              {receiveAmountExceedsPending ? (
                <p className="mt-1 text-xs text-red-600">
                  Receive amount cannot be more than pending ({formatCurrency(maxReceiveNow)}).
                </p>
              ) : null}
              {!hasPaymentAccounts ? (
                <p className="mt-1 text-xs text-red-600">Add a bank or cash account before recording payment.</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="sale-payment-preview" className="block text-[11px] font-medium text-gray-500 mb-1">Total Receive Amount</label>
              <input
                id="sale-payment-preview"
                readOnly
                value={formatCurrency(totalReceivePreview)}
                className="w-full border border-gray-200 rounded h-9 px-3 py-2 text-sm bg-gray-100 tabular-nums"
              />
            </div>
          </div>

          <p className={`text-sm font-semibold ${pendingAfterReceivePreview <= 0 ? 'text-green-600' : 'text-red-600'}`}>
            Pending Amount: {formatCurrency(pendingAfterReceivePreview)}
          </p>
        </form>
      )}
    </Modal>
  );
};

SalePaymentModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  saleId: PropTypes.string,
  onClose: PropTypes.func,
};

SalePaymentModal.defaultProps = {
  saleId: null,
  onClose: undefined,
};

export default SalePaymentModal;
