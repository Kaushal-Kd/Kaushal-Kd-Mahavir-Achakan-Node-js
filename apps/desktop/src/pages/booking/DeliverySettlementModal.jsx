import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2, todayIndiaISODate } from '@wrs/shared';
import { Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import { useModalSize } from '../../hooks/useModalSize.js';
import { ordersApi } from '../../lib/api/orders.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { runDeliveryWhatsAppFlow } from '../../lib/deliveryWhatsAppFlow.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { syncService } from '../../services/syncService.js';
import { toast } from '../../stores/uiStore.js';
import SecurityTransactionsModal from './SecurityTransactionsModal.jsx';
import { formatSingleSecurityTxInline } from './securityTxInlineSummary.js';

const today = () => todayIndiaISODate();
const toNonNegativeNumber = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

const normPaymentAccountGroup = (g) =>
  String(g ?? '')
    .trim()
    .toLowerCase();

const MAX_DELIVERY_REMARK = 500;

const DeliverySettlementModal = ({
  isOpen,
  orderId,
  onClose,
  onSuccess,
  stageUpdates,
  stageDraftAfter,
}) => {
  const modalSize = useModalSize('xl');
  const queryClient = useQueryClient();
  const wa = useWhatsAppOutbound();
  const online = useOnlineStatus();
  const [securityAmount, setSecurityAmount] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [depositStatus, setDepositStatus] = useState('unpaid');
  const [deliveryRemark, setDeliveryRemark] = useState('');
  // Extra discount to apply at delivery time (shown as +value in input; label shows total).
  const [discountDraft, setDiscountDraft] = useState('0');
  const [securityTxOpen, setSecurityTxOpen] = useState(false);

  const orderQuery = useQuery({
    queryKey: ['order', 'delivery-settlement', orderId],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'delivery-settlement-modal'],
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
  const totalReceivePreview = useMemo(
    () => round2(paidAmount + receiveNum),
    [paidAmount, receiveNum]
  );
  const maxReceivePreview = useMemo(() => round2(Math.max(0, balancePreview)), [balancePreview]);
  const pendingAfterReceivePreview = useMemo(
    () => round2(Math.max(0, balancePreview - receiveNum)),
    [balancePreview, receiveNum]
  );

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
  const securityHeldNow = useMemo(() => {
    const serverHeld = Number(order?.security_held_amount);
    if (Number.isFinite(serverHeld)) return round2(Math.max(0, serverHeld));
    return round2(Math.max(0, Number(depositCollected || 0) - Number(depositRefunded || 0)));
  }, [depositCollected, depositRefunded, order?.security_held_amount]);
  const securityDepositCap = useMemo(
    () => round2(Number(order?.deposit_amount) || 0),
    [order?.deposit_amount]
  );
  const maxSecurityCollectNow = useMemo(
    () => round2(Math.max(0, securityDepositCap - securityHeldNow)),
    [securityDepositCap, securityHeldNow]
  );
  const securityRemainingAfterEntry = useMemo(
    () => round2(Math.max(0, maxSecurityCollectNow - secNum)),
    [maxSecurityCollectNow, secNum]
  );
  const totalSecurityAfterCollect = useMemo(
    () => round2(securityHeldNow + secNum),
    [securityHeldNow, secNum]
  );
  const securityCollectDue = maxSecurityCollectNow;
  const securityAmountMismatch = useMemo(
    () => secNum > 0 && Math.abs(secNum - securityCollectDue) > 0.009,
    [securityCollectDue, secNum]
  );
  const securityAmountWarningMessage = useMemo(() => {
    if (!securityAmountMismatch) return null;
    return `Security amount should be ${formatCurrency(securityCollectDue)} (Pending security deposit). You entered ${formatCurrency(secNum)}.`;
  }, [securityAmountMismatch, securityCollectDue, secNum]);

  const singleSecurityTxInline = useMemo(
    () =>
      formatSingleSecurityTxInline(order?.payments, {
        paymentAccounts,
        securityAccounts,
      }),
    [order?.payments, paymentAccounts, securityAccounts]
  );

  useEffect(() => {
    if (!isOpen || !order) return;
    setSecurityAccountId('');
    setPaymentAccountId('');
    setSecurityAmount('');
    setReceiveAmount('');
    setDiscountDraft('0');
    setDeliveryRemark('');
    const initialStatus = order.deposit_returned
      ? 'returned'
      : order.deposit_received || order.paid_security_amt
        ? 'paid'
        : 'unpaid';
    setDepositStatus(initialStatus);
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

  const paymentNotes = useMemo(() => {
    const t = String(deliveryRemark || '').trim();
    if (!t) return null;
    return t.slice(0, MAX_DELIVERY_REMARK);
  }, [deliveryRemark]);

  const submitMut = useMutation({
    mutationFn: async ({ discountTotal }) => {
      if ((receiveNum > 0 || secNum > 0) && !order?.customer_id) {
        toast.error('This order has no customer linked; add a customer before recording payments.');
        throw new Error('no_customer');
      }
      const payId = String(paymentAccountId || '').trim() || null;
      const secId = String(securityAccountId || '').trim() || null;
      if (secNum > 0 && !secId) {
        toast.error('Select the security ledger account');
        throw new Error('validation');
      }
      if (receiveNum > 0 && !payId) {
        toast.error('Select the payment ledger account');
        throw new Error('validation');
      }
      const depositCapNum = round2(Number(order.deposit_amount) || 0);
      if (secNum > 0 && Math.abs(secNum - maxSecurityCollectNow) > 0.009) {
        toast.warning(
          `Security amount should be ${formatCurrency(maxSecurityCollectNow)} (Pending security deposit). You entered ${formatCurrency(secNum)}.`
        );
        throw new Error('validation');
      }
      const willSecurityBeFullyPaid =
        depositCapNum > 0 && round2(securityHeldNow + secNum) + 1e-6 >= depositCapNum;
      const nextDepositStatus =
        depositStatus === 'returned' ? 'returned' : willSecurityBeFullyPaid ? 'paid' : 'unpaid';

      const payload = {
        idempotency_key: syncService.createIdempotencyKey(),
        discount_total: round2(Number(discountTotal)),
        deposit_amount: depositCapNum,
        security_status: nextDepositStatus,
        security_amount: secNum,
        security_account_id: secId,
        receive_amount: receiveNum,
        payment_account_id: payId,
        payment_date: today(),
        delivery_remark: paymentNotes,
        stage_updates: Array.isArray(stageUpdates) ? stageUpdates : [],
      };
      return syncService.submitOrQueueDeliverySettlement(order.id, payload, {
        orderNumber: order.order_number,
      });
    },
    onSuccess: async (result) => {
      const queued = result?.queued === true;
      const label = queued
        ? online
          ? 'Settlement queued after a connection error'
          : 'Settlement queued and will sync when online'
        : stageUpdates?.length
          ? 'Delivery saved'
          : 'Settlement saved';
      onClose();
      toast.success(label);
      if (!queued && order && orderId) {
        const savedOrder = result?.response?.data || order;
        await runDeliveryWhatsAppFlow({
          wa,
          orderBefore: order,
          orderAfter: savedOrder,
          orderId,
          stageUpdates,
          stageDraftAfter,
          actionLabel: label,
        });
      }
      if (!queued) await invalidateOrderDomain(queryClient, { orderId });
      onSuccess?.();
    },
    onError: (err) => {
      if (err?.message === 'no_customer' || err?.message === 'validation') return;
      const apiMsg =
        err?.response?.data?.error?.message || err?.response?.data?.message || err?.message;
      toast.error(apiMsg || 'Could not save settlement');
    },
  });

  const submit = (e) => {
    e.preventDefault();
    if (submitMut.isPending) return;
    if (!order) return;
    const discountDraftNumLocal = round2(Number(discountDraft) || 0);
    const discountTotalDraft = round2(savedDiscountTotal + discountDraftNumLocal);
    const orderSubtotal = round2(Number(order.subtotal || 0));
    if (discountTotalDraft > orderSubtotal) {
      toast.error('The discount does not exceed the bill amount');
      return;
    }
    if (discountDraftNumLocal < 0) {
      toast.error('Discount total cannot be negative');
      return;
    }
    if (receiveNum > maxReceivePreview) {
      toast.error(
        `Receive amount cannot be more than pending (${formatCurrency(maxReceivePreview)})`
      );
      return;
    }
    if (securityAmountMismatch && securityAmountWarningMessage) {
      toast.warning(securityAmountWarningMessage);
      return;
    }
    const deliversAnyLine = (stageUpdates || []).some(
      (update) => update.field === 'delivered' && update.value === true
    );
    if (
      deliversAnyLine &&
      securityDepositCap > 0 &&
      totalSecurityAfterCollect + 0.009 < securityDepositCap
    ) {
      toast.error(
        `Collect the full Security Amount (${formatCurrency(securityDepositCap)}) before delivery`
      );
      return;
    }
    const initialDiscount = round2(Number(order.discount_total || 0));
    const discChanged = discountTotalDraft !== initialDiscount;
    const hasStageUpdates = Array.isArray(stageUpdates) && stageUpdates.length > 0;
    if (secNum <= 0 && receiveNum <= 0) {
      const initialStatus = order.deposit_returned
        ? 'returned'
        : order.deposit_received || order.paid_security_amt
          ? 'paid'
          : 'unpaid';
      if (depositStatus === initialStatus && !discChanged && !hasStageUpdates) {
        toast.error('No changes to save');
        return;
      }
    }
    submitMut.mutate({ discountTotal: discountTotalDraft });
  };

  const loading =
    submitMut.isPending ||
    orderQuery.isLoading ||
    paymentAccountsQuery.isLoading ||
    securityAccountsQuery.isLoading;

  const securityOptions = [
    { value: '', label: 'Select account' },
    ...securityAccounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={order ? `Bill No: ${order.order_number}` : 'Bill'}
        size={modalSize}
        footer={
          <>
            <div className="mr-auto self-center min-w-0 flex flex-col gap-0.5 text-left max-w-[58%]">
              {order && String(order.reference_name || '').trim() ? (
                <span
                  className="text-[10px] font-semibold text-gray-900 truncate"
                  title={order.reference_name}
                >
                  Reference: {order.reference_name}
                </span>
              ) : null}
              <span className="text-[10px] text-gray-600">
                Security on order: <strong>{formatCurrency(securityDepositCap)}</strong>
                {securityDepositCap <= 0 ? ' · Add it in Booking Edit before collection.' : ''}
              </span>
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
          <p className="text-[11px] text-red-600">Could not load order.</p>
        ) : orderQuery.isLoading || !order ? (
          <p className="text-[11px] text-gray-500">Loading…</p>
        ) : (
          <form className="space-y-3 text-[11px] leading-snug " onSubmit={submit}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
              <div className="min-w-0">
                <label
                  htmlFor="delivery-bill-amount"
                  className="block text-[10px] font-medium text-gray-600 mb-1"
                >
                  Bill Amount
                </label>
                <input
                  id="delivery-bill-amount"
                  readOnly
                  value={formatCurrency(order.total_amount)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 mb-0.5">
                  <span className="text-[10px] font-medium text-gray-600">Total Discount:</span>
                  <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                    {formatCurrency(discountTotalPreview)}
                  </span>
                </div>
                <div className="flex gap-1 items-center">
                  <input
                    id="delivery-discount-total"
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
                    className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] bg-white tabular-nums"
                    title={`Add extra discount (max ${formatCurrency(round2(Math.max(0, Number(order.subtotal || 0) - savedDiscountTotal)))})`}
                  />
                  <span
                    className="inline-flex text-gray-500 shrink-0"
                    title="This adds extra discount at delivery. Label shows the final total discount. Saved when you click Submit."
                  >
                    <Info size={12} aria-hidden />
                  </span>
                </div>
              </div>
              <div className="min-w-0">
                <p className="inline-flex flex-nowrap items-center gap-x-1.5 mb-0.5 w-full min-w-0 whitespace-nowrap overflow-x-auto text-[10px] leading-snug">
                  <span className="font-medium text-gray-600 shrink-0">Pending deposit:</span>
                  <span className="text-[11px] font-semibold text-red-700 tabular-nums shrink-0">
                    {formatCurrency(securityRemainingAfterEntry)}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1 items-center">
                  <div className="flex min-w-0 flex-1 gap-1 items-center">
                    <input
                      id="delivery-settlement-security-amt"
                      type="number"
                      step="0.01"
                      min="0"
                      value={securityAmount}
                      disabled={securityDepositCap <= 0}
                      onChange={(e) =>
                        setSecurityAmount(
                          e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                        )
                      }
                      className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] tabular-nums"
                      title={
                        securityCollectDue > 0
                          ? `Enter ${formatCurrency(securityCollectDue)} (Pending security deposit)`
                          : 'Collect security deposit'
                      }
                    />
                    {securityAccounts.length > 0 ? (
                      <AccountSelectWithQr
                        accountId={securityAccountId}
                        accounts={securityAccounts}
                        accountKind="security"
                        size="md"
                        className="min-w-0 flex-1"
                      >
                        <select
                          id="delivery-settlement-security-account"
                          className="input min-w-0 w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
                          value={securityAccountId}
                          disabled={securityDepositCap <= 0}
                          onChange={(e) => setSecurityAccountId(e.target.value)}
                        >
                          {securityOptions.map((o) => (
                            <option key={o.value === '' ? '_empty' : o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </AccountSelectWithQr>
                    ) : null}
                  </div>
                  {singleSecurityTxInline ? (
                    <span
                      className="text-[10px] font-medium text-gray-800 tabular-nums truncate min-w-0 max-w-[11rem] sm:max-w-[15rem]"
                      title={singleSecurityTxInline}
                    >
                      {singleSecurityTxInline}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="inline-flex text-gray-500 shrink-0 cursor-pointer rounded p-0.5 hover:bg-gray-100"
                    title="Security transactions"
                    aria-label="Security transactions"
                    onClick={() => setSecurityTxOpen(true)}
                  >
                    <Info size={12} aria-hidden />
                  </button>
                </div>
                {securityDepositCap > 0 ? (
                  <p className="mt-1 text-[10px] text-gray-600">
                    Total security received:{' '}
                    <span
                      className={`font-semibold tabular-nums ${
                        secNum > 0 && totalSecurityAfterCollect + 0.009 < securityDepositCap
                          ? 'text-yellow-700'
                          : 'text-green-700'
                      }`}
                    >
                      {formatCurrency(totalSecurityAfterCollect)}
                    </span>
                    <span className="text-gray-500"> / {formatCurrency(securityDepositCap)}</span>
                  </p>
                ) : null}
                {securityAmountWarningMessage ? (
                  <p className="mt-1 text-[10px] font-medium text-yellow-700" role="alert">
                    {securityAmountWarningMessage}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
              <div className="min-w-0">
                <label
                  htmlFor="delivery-advance"
                  className="block text-[10px] font-medium text-gray-600 mb-1"
                >
                  Advance
                </label>
                <input
                  id="delivery-advance"
                  readOnly
                  value={formatCurrency(paidAmount)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
                <div className="mt-0.5 min-h-[18px]" aria-hidden="true" />
              </div>
              <div className="min-w-0 sm:col-span-1">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-1">
                  <div className="min-w-0">
                    <label
                      htmlFor="delivery-settlement-receive"
                      className="block text-[10px] font-medium text-gray-600 mb-1"
                    >
                      Receive
                    </label>
                    <input
                      id="delivery-settlement-receive"
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxReceivePreview}
                      value={receiveAmount}
                      onChange={(e) =>
                        setReceiveAmount(
                          e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                        )
                      }
                      className="input w-full h-9 py-1 px-2 text-[11px] tabular-nums"
                      title={`Max ${formatCurrency(maxReceivePreview)}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="delivery-settlement-payment-account"
                      className="block text-[10px] font-medium text-gray-600 mb-1"
                    >
                      Account
                    </label>
                    {hasLedgerBankCash ? (
                      <AccountSelectWithQr
                        accountId={paymentAccountId}
                        accounts={paymentAccounts}
                        accountKind="payment"
                        size="md"
                      >
                        <select
                          id="delivery-settlement-payment-account"
                          className="input w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
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
                      <span className="flex h-9 items-center text-[10px] text-gray-500">
                        No accounts
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-0.5 min-h-[18px]" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <label
                  htmlFor="delivery-total-receive"
                  className="block text-[10px] font-medium text-gray-600 mb-1"
                >
                  Total Receive Amount
                </label>
                <input
                  id="delivery-total-receive"
                  readOnly
                  value={formatCurrency(totalReceivePreview)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
                <span
                  className={`mt-1 block text-[10px] font-semibold tabular-nums ${
                    pendingAfterReceivePreview > 0 ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  Pending Amount: {formatCurrency(pendingAfterReceivePreview)}
                </span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="flex justify-between gap-1 mb-0.5">
                <label
                  htmlFor="delivery-settlement-remark"
                  className="text-[10px] font-medium text-gray-600"
                >
                  Delivery Remark
                </label>
                <span className="text-[9px] text-gray-400 tabular-nums shrink-0">
                  {deliveryRemark.length}/{MAX_DELIVERY_REMARK}
                </span>
              </div>
              <textarea
                id="delivery-settlement-remark"
                rows={2}
                maxLength={MAX_DELIVERY_REMARK}
                value={deliveryRemark}
                onChange={(e) => setDeliveryRemark(e.target.value)}
                className="input w-full resize-y min-h-[5rem] py-2 px-2 text-[11px] leading-snug"
                placeholder="Type your Delivery remark"
              />
            </div>
          </form>
        )}
      </Modal>

      <SecurityTransactionsModal
        isOpen={securityTxOpen}
        orderId={orderId}
        onClose={() => setSecurityTxOpen(false)}
      />
    </>
  );
};

DeliverySettlementModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  stageDraftAfter: PropTypes.object,
  stageUpdates: PropTypes.arrayOf(
    PropTypes.shape({
      item_id: PropTypes.string.isRequired,
      item_type: PropTypes.oneOf(['item', 'accessory']).isRequired,
      field: PropTypes.string.isRequired,
      value: PropTypes.bool.isRequired,
    })
  ),
};

DeliverySettlementModal.defaultProps = {
  orderId: null,
  onSuccess: undefined,
  stageUpdates: null,
  stageDraftAfter: null,
};

export default DeliverySettlementModal;
