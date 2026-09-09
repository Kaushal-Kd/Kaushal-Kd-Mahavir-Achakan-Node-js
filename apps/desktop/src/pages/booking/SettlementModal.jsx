import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2, todayIndiaISODate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useModalSize } from '../../hooks/useModalSize.js';
import { ordersApi } from '../../lib/api/orders.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { paymentsApi } from '../../lib/api/payments.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';

const today = () => todayIndiaISODate();
const toNonNegativeNumber = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

const normPaymentAccountGroup = (g) =>
  String(g ?? '')
    .trim()
    .toLowerCase();

const SettlementModal = ({ isOpen, orderId, onClose, onSuccess }) => {
  const modalSize = useModalSize('xl');
  const queryClient = useQueryClient();
  const [securityAmount, setSecurityAmount] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveMode, setReceiveMode] = useState('receive');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  // Extra discount to apply now (label shows total discount; input is +extra).
  const [discountDraft, setDiscountDraft] = useState('0');

  const orderQuery = useQuery({
    queryKey: ['order', 'settlement', orderId],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'settlement-modal'],
    queryFn: () => securityAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const order = orderQuery.data;
  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = securityAccountsQuery.data?.data || [];

  const settlementBankAccounts = useMemo(
    () =>
      paymentAccounts.filter((a) => normPaymentAccountGroup(a.account_group) === 'bank accounts'),
    [paymentAccounts]
  );
  const settlementCashAccounts = useMemo(
    () =>
      paymentAccounts.filter((a) => normPaymentAccountGroup(a.account_group) === 'cash accounts'),
    [paymentAccounts]
  );
  const hasLedgerBankCash = settlementBankAccounts.length + settlementCashAccounts.length > 0;

  const balance = useMemo(() => round2(Number(order?.balance || 0)), [order]);
  const paidAmount = useMemo(() => round2(Number(order?.paid_amount || 0)), [order]);

  const savedDiscountTotal = useMemo(
    () => round2(Number(order?.discount_total || 0)),
    [order?.discount_total]
  );
  const discountDraftNum = useMemo(() => round2(Number(discountDraft) || 0), [discountDraft]);
  const discountTotalPreview = useMemo(
    () => round2(savedDiscountTotal + discountDraftNum),
    [savedDiscountTotal, discountDraftNum]
  );
  const discountDelta = useMemo(
    () => round2(discountTotalPreview - savedDiscountTotal),
    [discountTotalPreview, savedDiscountTotal]
  );
  const balancePreview = useMemo(
    () => (order ? round2(Number(order.balance || 0) - discountDelta) : 0),
    [order, discountDelta]
  );
  const totalPreview = useMemo(
    () => (order ? round2(Number(order.total_amount || 0) - discountDelta) : 0),
    [order, discountDelta]
  );

  const receiveNum = round2(Number(receiveAmount) || 0);
  const secNum = round2(Number(securityAmount) || 0);
  const isRefund = receiveMode === 'refund';
  const maxReceiveNow = useMemo(() => round2(Math.max(0, balancePreview)), [balancePreview]);
  const maxRefundNow = useMemo(() => round2(Math.max(0, paidAmount)), [paidAmount]);

  const orderPayments = Array.isArray(order?.payments) ? order.payments : [];
  const depositCollected = useMemo(
    () =>
      orderPayments
        .filter((p) => p.category === 'deposit')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [orderPayments]
  );
  const depositRefunded = useMemo(
    () =>
      orderPayments
        .filter((p) => p.category === 'deposit_refund')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [orderPayments]
  );
  const securityHeldNow = useMemo(
    () => round2(Math.max(0, Number(depositCollected || 0) - Number(depositRefunded || 0))),
    [depositCollected, depositRefunded]
  );
  const expectedDeposit = useMemo(
    () => round2(Number(order?.deposit_amount || 0)),
    [order?.deposit_amount]
  );
  const maxSecurityCollectNow = useMemo(
    () => round2(Math.max(0, expectedDeposit - securityHeldNow)),
    [expectedDeposit, securityHeldNow]
  );
  const securityRemainingAfterEntry = useMemo(
    () => round2(Math.max(0, maxSecurityCollectNow - secNum)),
    [maxSecurityCollectNow, secNum]
  );

  const pendingAfterEntryPreview = useMemo(() => {
    if (!order) return 0;
    const nextPending = isRefund
      ? round2(maxReceiveNow + receiveNum)
      : round2(maxReceiveNow - receiveNum);
    return round2(Math.max(0, nextPending));
  }, [order, isRefund, maxReceiveNow, receiveNum]);
  const totalReceivePreview = useMemo(() => {
    const next = isRefund ? round2(paidAmount - receiveNum) : round2(paidAmount + receiveNum);
    return round2(Math.max(0, next));
  }, [isRefund, paidAmount, receiveNum]);

  useEffect(() => {
    if (!isOpen || !order) return;
    setPaymentAccountId('');
    setSecurityAccountId(order.security_account_id || '');
    setSecurityAmount('');
    setReceiveAmount('');
    setReceiveMode('receive');
    setDiscountDraft('0');
  }, [isOpen, order?.id]);

  useEffect(() => {
    if (!paymentAccountsQuery.isSuccess) return;
    const allowed = new Set([
      ...settlementBankAccounts.map((a) => a.id),
      ...settlementCashAccounts.map((a) => a.id),
    ]);
    if (paymentAccountId && !allowed.has(paymentAccountId)) {
      setPaymentAccountId('');
    }
  }, [
    paymentAccountsQuery.isSuccess,
    paymentAccountId,
    settlementBankAccounts,
    settlementCashAccounts,
  ]);

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!order?.customer_id) {
        toast.error('This order has no customer linked; add a customer before recording payments.');
        throw new Error('no_customer');
      }

      const orderSubtotal = round2(Number(order.subtotal || 0));
      if (discountTotalPreview > orderSubtotal) {
        toast.error('The discount does not exceed the bill amount');
        throw new Error('validation');
      }
      if (discountDraftNum < 0) {
        toast.error('Discount total cannot be negative');
        throw new Error('validation');
      }
      if (secNum > 0 && expectedDeposit <= 0) {
        toast.error('Add the Security Amount through Booking Edit before collecting it');
        throw new Error('validation');
      }
      if (secNum > maxSecurityCollectNow) {
        toast.error(
          `Security collection cannot be more than the configured pending amount (${formatCurrency(maxSecurityCollectNow)})`
        );
        throw new Error('validation');
      }

      let workingOrder = order;
      if (discountTotalPreview !== savedDiscountTotal) {
        const res = await ordersApi.adjustDiscountTotal(order.id, {
          discount_total: discountTotalPreview,
        });
        workingOrder = res.data;
      }

      const payId = String(paymentAccountId || '').trim() || null;
      if (receiveNum > 0 && hasLedgerBankCash && !payId) {
        toast.error('Select the payment ledger account');
        throw new Error('validation');
      }
      const secId = String(securityAccountId || '').trim() || null;
      if (secNum > 0 && securityAccounts.length > 0 && !secId) {
        toast.error('Select the security ledger account');
        throw new Error('validation');
      }
      if (receiveNum < 0) {
        toast.error('Amounts cannot be negative');
        throw new Error('validation');
      }
      if (secNum < 0) {
        toast.error('Amounts cannot be negative');
        throw new Error('validation');
      }
      const workingBalance = round2(Number(workingOrder.balance || 0));
      if (!isRefund && receiveNum > workingBalance) {
        toast.error(
          `Receive amount cannot be more than pending (${formatCurrency(maxReceiveNow)})`
        );
        throw new Error('validation');
      }
      if (isRefund && receiveNum > maxRefundNow) {
        toast.error(
          `Refund amount cannot be more than paid amount (${formatCurrency(maxRefundNow)})`
        );
        throw new Error('validation');
      }
      if (secNum > 0) {
        const initialStatus = workingOrder.deposit_returned
          ? 'returned'
          : workingOrder.deposit_received || workingOrder.paid_security_amt
            ? 'paid'
            : 'unpaid';
        const willBeFullyPaid =
          expectedDeposit > 0 && round2(securityHeldNow + secNum) + 1e-6 >= expectedDeposit;
        const nextStatus = willBeFullyPaid ? 'paid' : initialStatus;
        if (nextStatus !== initialStatus) {
          const res = await ordersApi.setSecurityStatus(workingOrder.id, {
            status: nextStatus,
            deposit_amount: expectedDeposit,
          });
          workingOrder = res.data;
        }
      }

      const base = {
        order_id: workingOrder.id,
        customer_id: workingOrder.customer_id,
        payment_type: 'cash',
        payment_date: today(),
        transaction_id: null,
        notes: null,
      };

      if (secNum > 0) {
        await paymentsApi.create({
          ...base,
          amount: secNum,
          category: 'deposit',
          payment_account_id: null,
          security_account_id: secId,
        });
      }

      if (receiveNum > 0) {
        const category = isRefund ? 'refund' : receiveNum >= workingBalance ? 'final' : 'partial';
        await paymentsApi.create({
          ...base,
          amount: receiveNum,
          category,
          payment_account_id: payId,
          security_account_id: null,
        });
      }
    },
    onSuccess: async () => {
      onClose();
      toast.success('Settlement saved');
      await invalidateOrderDomain(queryClient, { orderId });
      if (onSuccess) await onSuccess();
    },
    onError: (err) => {
      if (err?.message === 'no_customer' || err?.message === 'validation') return;
      toast.error(err?.response?.data?.message || err?.message || 'Could not save settlement');
    },
  });

  const submit = (e) => {
    e.preventDefault();
    if (submitMut.isPending) return;
    if (!order) return;
    const orderSubtotal = round2(Number(order.subtotal || 0));
    if (discountTotalPreview > orderSubtotal) {
      toast.error('The discount does not exceed the bill amount');
      return;
    }
    if (discountDraftNum < 0) {
      toast.error('Discount total cannot be negative');
      return;
    }
    if (!isRefund && receiveNum > maxReceiveNow) {
      toast.error(`Receive amount cannot be more than pending (${formatCurrency(maxReceiveNow)})`);
      return;
    }
    if (isRefund && receiveNum > maxRefundNow) {
      toast.error(
        `Refund amount cannot be more than paid amount (${formatCurrency(maxRefundNow)})`
      );
      return;
    }
    if (secNum > 0 && expectedDeposit <= 0) {
      toast.error('Add the Security Amount through Booking Edit before collecting it');
      return;
    }
    if (secNum > maxSecurityCollectNow) {
      toast.error(
        `Security collection cannot be more than the configured pending amount (${formatCurrency(maxSecurityCollectNow)})`
      );
      return;
    }
    if (discountDraftNum <= 0 && secNum <= 0 && receiveNum <= 0) {
      toast.error('No changes to save');
      return;
    }
    submitMut.mutate();
  };

  const loading =
    submitMut.isPending ||
    orderQuery.isLoading ||
    paymentAccountsQuery.isLoading ||
    securityAccountsQuery.isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={order ? `Bill No: ${order.order_number}` : 'Settlement'}
      size={modalSize}
      footer={
        <>
          <div className="mr-auto self-center min-w-0">
            <p className="text-[10px] text-gray-600">
              Security on order: {formatCurrency(expectedDeposit)} · Change through Booking Edit
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            loading={submitMut.isPending}
            disabled={orderQuery.isLoading}
          >
            Submit
          </Button>
        </>
      }
    >
      {orderQuery.isError ? (
        <p className="text-sm text-red-600">Could not load order.</p>
      ) : orderQuery.isLoading || !order ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <form className="space-y-2 text-[10px] leading-tight" onSubmit={submit}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="min-w-0">
              <label
                htmlFor="settlement-bill-amount"
                className="block text-[9px] font-medium text-gray-600 mb-0.5"
              >
                Bill Amount
              </label>
              <input
                id="settlement-bill-amount"
                readOnly
                value={formatCurrency(totalPreview)}
                className="input w-full h-7 py-0.5 px-1.5 text-[10px] bg-gray-100 text-gray-900 tabular-nums"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 mb-0.5">
                <span className="text-[9px] font-medium text-gray-600">Total Discount:</span>
                <span className="text-[10px] font-semibold text-green-700 tabular-nums">
                  {formatCurrency(discountTotalPreview)}
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                max={round2(Math.max(0, Number(order.subtotal || 0) - savedDiscountTotal))}
                value={discountDraft}
                onChange={(e) =>
                  setDiscountDraft(
                    e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                  )
                }
                className="input w-full h-7 py-0.5 px-1.5 text-[10px] bg-white tabular-nums"
                title={`Add extra discount (max ${formatCurrency(round2(Math.max(0, Number(order.subtotal || 0) - savedDiscountTotal)))})`}
              />
            </div>
            <div className="min-w-0">
              <p className="inline-flex flex-nowrap items-center gap-x-1.5 mb-0.5 w-full min-w-0 whitespace-nowrap overflow-x-auto text-[9px] leading-snug">
                <span className="font-medium text-gray-600 shrink-0">Remaining to collect:</span>
                <span className="text-[10px] font-semibold text-green-700 tabular-nums shrink-0">
                  {formatCurrency(securityRemainingAfterEntry)}
                </span>
              </p>
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={maxSecurityCollectNow}
                  value={securityAmount}
                  onChange={(e) =>
                    setSecurityAmount(
                      e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                    )
                  }
                  disabled={expectedDeposit <= 0 || maxSecurityCollectNow <= 0}
                  className="input min-w-0 flex-1 h-7 py-0.5 px-1 text-[10px] tabular-nums"
                  title={
                    expectedDeposit <= 0
                      ? 'Add the Security Amount through Booking Edit before collecting it'
                      : `Collect pending security (max ${formatCurrency(maxSecurityCollectNow)})`
                  }
                />
                {securityAccounts.length > 0 ? (
                  <AccountSelectWithQr
                    accountId={securityAccountId}
                    accounts={securityAccounts}
                    accountKind="security"
                    size="sm"
                    className="min-w-0 flex-1"
                  >
                    <select
                      className="input min-w-0 w-full h-7 py-0.5 px-1 text-[10px] bg-surface pr-5"
                      value={securityAccountId}
                      onChange={(e) => setSecurityAccountId(e.target.value)}
                      disabled={expectedDeposit <= 0 || maxSecurityCollectNow <= 0}
                    >
                      <option value="">Select account</option>
                      {securityAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </AccountSelectWithQr>
                ) : (
                  <span className="text-[9px] text-gray-500">No accounts</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <div className="min-w-0">
              <label
                htmlFor="settlement-advance"
                className="block text-[9px] font-medium text-gray-600 mb-0.5"
              >
                Advance
              </label>
              <input
                id="settlement-advance"
                readOnly
                value={formatCurrency(paidAmount)}
                className="input w-full h-7 py-0.5 px-1.5 text-[10px] bg-gray-100 text-gray-900 tabular-nums"
              />
            </div>

            <div className="min-w-0">
              <div className="flex gap-3 items-center mb-0.5">
                <label className="inline-flex items-center gap-2 text-[10px] text-gray-700">
                  <input
                    type="radio"
                    name="settlement-receive-mode"
                    checked={receiveMode === 'receive'}
                    onChange={() => setReceiveMode('receive')}
                  />
                  Receive
                </label>
                <label className="inline-flex items-center gap-2 text-[10px] text-gray-700">
                  <input
                    type="radio"
                    name="settlement-receive-mode"
                    checked={receiveMode === 'refund'}
                    onChange={() => setReceiveMode('refund')}
                  />
                  Refund
                </label>
              </div>
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={isRefund ? maxRefundNow : maxReceiveNow}
                  value={receiveAmount}
                  onChange={(e) =>
                    setReceiveAmount(
                      e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                    )
                  }
                  className="input min-w-0 flex-1 h-7 py-0.5 px-1 text-[10px] tabular-nums"
                  title={`Max ${formatCurrency(isRefund ? maxRefundNow : maxReceiveNow)}`}
                />
                {hasLedgerBankCash ? (
                  <AccountSelectWithQr
                    accountId={paymentAccountId}
                    accounts={paymentAccounts}
                    accountKind="payment"
                    size="sm"
                    className="min-w-0 flex-1"
                  >
                    <select
                      className="input min-w-0 w-full h-7 py-0.5 px-1 text-[10px] bg-surface pr-5"
                      value={paymentAccountId}
                      onChange={(e) => setPaymentAccountId(e.target.value)}
                    >
                      <option value="">Select account</option>
                      {settlementBankAccounts.length ? (
                        <optgroup label="Bank">
                          {settlementBankAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {settlementCashAccounts.length ? (
                        <optgroup label="Cash">
                          {settlementCashAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </AccountSelectWithQr>
                ) : (
                  <span className="text-[9px] text-gray-500">No accounts</span>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex flex-row gap-1 items-baseline justify-between">
                <label
                  htmlFor="settlement-total-receive"
                  className="block text-[9px] font-medium text-gray-600 mb-0.5"
                >
                  Total Receive Amount
                </label>
                <span
                  className={`text-[9px] font-semibold tabular-nums ${
                    pendingAfterEntryPreview > 0 ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  Pending Amount: {formatCurrency(pendingAfterEntryPreview)}
                </span>
              </div>
              <input
                id="settlement-total-receive"
                readOnly
                value={formatCurrency(totalReceivePreview)}
                className="input w-full h-7 py-0.5 px-1.5 text-[10px] bg-gray-100 text-gray-900 tabular-nums"
              />
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
};

SettlementModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};

SettlementModal.defaultProps = {
  orderId: null,
  onSuccess: null,
};

export default SettlementModal;
