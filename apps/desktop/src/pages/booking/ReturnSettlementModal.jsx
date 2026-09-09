import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2, todayIndiaISODate } from '@wrs/shared';
import { Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import { useModalSize } from '../../hooks/useModalSize.js';
import { applyUpdatesToStageDraft, diffStageUpdates } from '../../lib/orderChecklistMerge.js';
import { runStageTemplateWhatsApp } from '../../lib/whatsappOutbound.js';
import { ordersApi } from '../../lib/api/orders.js';
import { syncService } from '../../services/syncService.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { classifyReturnSettlementError } from '../../lib/returnSettlementError.js';
import {
  datetimeLocalToReminderFields,
  nowReminderDatetimeLocal,
} from '../../lib/reminderDateTime.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import {
  invalidateOrderDomain,
  invalidateSecurityChargesDomain,
} from '../../lib/queryInvalidation.js';
import {
  isActiveSecurityAccount,
  paymentAccountsByGroup,
} from '../../lib/paymentAccountFilters.js';
import { toast } from '../../stores/uiStore.js';
import ModalSecurityOnOrderHint from './ModalSecurityOnOrderHint.jsx';
import ReplacementRequirementsPanel from './ReplacementRequirementsPanel.jsx';
import SecurityTransactionsModal from './SecurityTransactionsModal.jsx';
import { formatSingleSecurityTxInline } from './securityTxInlineSummary.js';
import { runReturnMissingWhatsAppFlow } from '../../lib/returnMissingWhatsAppFlow.js';

const toNonNegativeNumber = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

const REFUND_VIA_SECURITY = 'security';
const REFUND_VIA_BANK_CASH = 'bank_cash';

const MAX_RETURN_REMARK = 500;
const today = () => todayIndiaISODate();


const ReturnSettlementModal = ({
  isOpen,
  orderId,
  onClose,
  onSuccess,
  stageUpdates,
  stageDraftAfter,
  conditionUpdates,
}) => {
  const modalSize = useModalSize('xl');
  const queryClient = useQueryClient();
  const wa = useWhatsAppOutbound();
  const [securityRefundAmount, setSecurityRefundAmount] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [refundVia, setRefundVia] = useState(REFUND_VIA_SECURITY);
  const [refundPaymentAccountId, setRefundPaymentAccountId] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [chargePaymentAccountId, setChargePaymentAccountId] = useState('');
  const [conditionCollectAmount, setConditionCollectAmount] = useState('0');
  const [conditionRetainAmount, setConditionRetainAmount] = useState('0');
  const submissionRef = useRef(null);
  const [discountDraft, setDiscountDraft] = useState('0');
  const [returnRemark, setReturnRemark] = useState('');
  const [createReminder, setCreateReminder] = useState(false);
  const [reminderAt, setReminderAt] = useState(nowReminderDatetimeLocal);
  const [securityTxOpen, setSecurityTxOpen] = useState(false);

  const orderQuery = useQuery({
    queryKey: ['order', 'return-settlement', orderId],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'return-settlement-modal'],
    queryFn: () => securityAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const order = orderQuery.data;
  const damagedProductItemIds = useMemo(() => (conditionUpdates || [])
    .filter((update) => update.item_type === 'item' && update.condition === 'damage')
    .map((update) => update.item_id), [conditionUpdates]);
  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = useMemo(
    () => (securityAccountsQuery.data?.data || []).filter((a) => isActiveSecurityAccount(a)),
    [securityAccountsQuery.data?.data]
  );

  const settlementBankAccounts = useMemo(
    () => paymentAccountsByGroup(paymentAccounts, ['bank accounts']),
    [paymentAccounts]
  );
  const settlementCashAccounts = useMemo(
    () => paymentAccountsByGroup(paymentAccounts, ['cash accounts']),
    [paymentAccounts]
  );
  const hasLedgerBankCash = settlementBankAccounts.length + settlementCashAccounts.length > 0;
  const hasActiveSecurityAccounts = securityAccounts.length > 0;

  const savedDiscountTotal = useMemo(
    () => round2(Number(order?.discount_total || 0)),
    [order?.discount_total]
  );
  const discountDraftNum = useMemo(() => round2(Number(discountDraft) || 0), [discountDraft]);
  const discountTotalDraft = useMemo(
    () => round2(savedDiscountTotal + discountDraftNum),
    [savedDiscountTotal, discountDraftNum]
  );

  const balance = useMemo(() => round2(Number(order?.balance || 0)), [order]);
  const paidAmount = useMemo(() => round2(Number(order?.paid_amount || 0)), [order]);
  const receiveNum = round2(Number(receiveAmount) || 0);
  const totalReceivePreview = useMemo(
    () => round2(paidAmount + receiveNum),
    [paidAmount, receiveNum]
  );
  const pendingAfterReceivePreview = useMemo(
    () => round2(Math.max(0, balance - receiveNum)),
    [balance, receiveNum]
  );

  const expectedDeposit = useMemo(
    () => round2(Number(order?.deposit_amount || 0)),
    [order?.deposit_amount]
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
  const securityHeldNow = useMemo(
    () =>
      round2(
        Math.max(
          0,
          Number(
            order?.security_held_amount ??
              Number(depositCollected || 0) - Number(depositRefunded || 0)
          )
        )
      ),
    [order?.security_held_amount, depositCollected, depositRefunded]
  );
  const refundNum = round2(Number(securityRefundAmount) || 0);
  const conditionChargeTotal = useMemo(
    () =>
      round2(
        (conditionUpdates || []).reduce((sum, update) => sum + Number(update.charge_amount || 0), 0)
      ),
    [conditionUpdates]
  );
  const retainedConditionCharge = toNonNegativeNumber(conditionRetainAmount);
  const directConditionCharge = toNonNegativeNumber(conditionCollectAmount);
  const maxRefundNow = useMemo(
    () => round2(Math.max(0, securityHeldNow - retainedConditionCharge)),
    [securityHeldNow, retainedConditionCharge]
  );
  const securityRemainingToCollect = useMemo(
    () => round2(Math.max(0, expectedDeposit - depositCollected)),
    [expectedDeposit, depositCollected]
  );
  const securityRefundRequired = maxRefundNow > 0;
  const securityRefundComplete =
    !securityRefundRequired ||
    (refundNum >= 0 && refundNum <= maxRefundNow + 0.005);

  const singleSecurityTxInline = useMemo(
    () =>
      formatSingleSecurityTxInline(order?.payments, {
        paymentAccounts,
        securityAccounts,
      }),
    [order?.payments, paymentAccounts, securityAccounts]
  );

  const paymentNotes = useMemo(() => {
    const t = String(returnRemark || '').trim();
    if (!t) return null;
    return t.slice(0, MAX_RETURN_REMARK);
  }, [returnRemark]);

  const securityPrefilledRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      securityPrefilledRef.current = false;
      submissionRef.current = null;
      return;
    }
    if (!order) return;
    setSecurityAccountId('');
    setRefundVia(REFUND_VIA_SECURITY);
    setRefundPaymentAccountId('');
    setPaymentAccountId('');
    setChargePaymentAccountId('');
    setConditionCollectAmount('0');
    setConditionRetainAmount('0');
    setReceiveAmount('');
    setDiscountDraft('0');
    setReturnRemark('');
    setSecurityRefundAmount('');
    setCreateReminder(false);
    setReminderAt(nowReminderDatetimeLocal());
  }, [isOpen, order?.id]);


  useEffect(() => {
    if (!isOpen || !order) return;
    if (maxRefundNow <= 0) {
      setSecurityRefundAmount('');
      securityPrefilledRef.current = false;
      return;
    }
    if (securityPrefilledRef.current) return;
    setSecurityRefundAmount(String(maxRefundNow));
    securityPrefilledRef.current = true;
  }, [isOpen, order, securityHeldNow, maxRefundNow]);

  useEffect(() => {
    if (!paymentAccountsQuery.isSuccess) return;
    const allowed = new Set(
      [...settlementBankAccounts, ...settlementCashAccounts].map((a) => a.id)
    );
    if (paymentAccountId && !allowed.has(paymentAccountId)) setPaymentAccountId('');
    if (refundPaymentAccountId && !allowed.has(refundPaymentAccountId))
      setRefundPaymentAccountId('');
    if (chargePaymentAccountId && !allowed.has(chargePaymentAccountId)) {
      setChargePaymentAccountId('');
    }
  }, [
    paymentAccountsQuery.isSuccess,
    paymentAccountId,
    chargePaymentAccountId,
    refundPaymentAccountId,
    settlementBankAccounts,
    settlementCashAccounts,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (hasActiveSecurityAccounts) setRefundVia(REFUND_VIA_SECURITY);
    else if (hasLedgerBankCash) setRefundVia(REFUND_VIA_BANK_CASH);
  }, [isOpen, hasActiveSecurityAccounts, hasLedgerBankCash]);

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('no_order');

      const orderSubtotal = round2(Number(order.subtotal || 0));
      if (discountTotalDraft > orderSubtotal) {
        toast.error('The discount does not exceed the bill amount');
        throw new Error('validation');
      }
      if (discountDraftNum < 0) {
        toast.error('Discount total cannot be negative');
        throw new Error('validation');
      }
      const payId = String(paymentAccountId || '').trim() || null;
      const secId = String(securityAccountId || '').trim() || null;
      const refundPayId = String(refundPaymentAccountId || '').trim() || null;
      const chargePayId = String(chargePaymentAccountId || '').trim() || null;

      const effectiveRefund = maxRefundNow > 0 ? refundNum : 0;

      if (receiveNum > 0 && hasLedgerBankCash && !payId) {
        toast.error('Select the payment ledger account for amount received');
        throw new Error('validation');
      }
      if (effectiveRefund < 0 || receiveNum < 0) {
        toast.error('Amounts cannot be negative');
        throw new Error('validation');
      }
      if (effectiveRefund > maxRefundNow) {
        toast.error(`Return to customer cannot exceed held (${formatCurrency(maxRefundNow)})`);
        throw new Error('validation');
      }
      if (directConditionCharge > 0 && !chargePayId) {
        toast.error('Select the bank/cash account used to collect the condition charge');
        throw new Error('validation');
      }
      if (retainedConditionCharge > securityHeldNow || retainedConditionCharge + directConditionCharge > conditionChargeTotal + 0.009) {
        toast.error('Funding cannot exceed the assessed charge or available security');
        throw new Error('validation');
      }
      if (effectiveRefund > 0) {
        if (refundVia === REFUND_VIA_SECURITY) {
          if (!hasActiveSecurityAccounts) {
            toast.error('No active security account. Use Bank/Cash or add under Accounts.');
            throw new Error('validation');
          }
          if (!secId) {
            toast.error('Select the security account to pay from');
            throw new Error('validation');
          }
        } else if (!hasLedgerBankCash || !refundPayId) {
          toast.error('Select the bank/cash account to pay the customer from');
          throw new Error('validation');
        }
      }

      const workingBalance = round2(
        Math.max(0, Number(order.balance || 0) - (discountTotalDraft - savedDiscountTotal))
      );
      if (receiveNum > workingBalance) {
        toast.error(
          `Receive amount cannot be more than pending (${formatCurrency(workingBalance)})`
        );
        throw new Error('validation');
      }

      let updates = Array.isArray(stageUpdates) ? [...stageUpdates] : [];
      if (updates.length === 0 && stageDraftAfter) {
        updates = diffStageUpdates(order, stageDraftAfter);
      }
      const reminder = createReminder ? datetimeLocalToReminderFields(reminderAt) : null;
      const payload = {
        discount_total: discountTotalDraft,
        security_refund_amount: effectiveRefund,
        refund_via: effectiveRefund > 0 ? refundVia : null,
        refund_payment_account_id:
          effectiveRefund > 0 && refundVia === REFUND_VIA_BANK_CASH ? refundPayId : null,
        refund_security_account_id:
          effectiveRefund > 0 && refundVia === REFUND_VIA_SECURITY ? secId : null,
        receive_amount: receiveNum,
        payment_account_id: receiveNum > 0 ? payId : null,
        payment_date: today(),
        return_remark: paymentNotes,
        security_charge_remarks: paymentNotes,
        charge_payment_account_id: directConditionCharge > 0 ? chargePayId : null,
        condition_collect_amount: directConditionCharge,
        condition_retain_amount: retainedConditionCharge,
        condition_updates: conditionUpdates || [],
        reminder,
        stage_updates: updates,
      };
      const fingerprint = JSON.stringify(payload);
      if (submissionRef.current?.fingerprint !== fingerprint) {
        submissionRef.current = { fingerprint, key: syncService.createIdempotencyKey() };
      }
      return syncService.submitOrQueueReturnSettlement(order.id, {
        ...payload, idempotency_key: submissionRef.current.key,
      }, { orderNumber: order.order_number });
    },
    onSuccess: async (result) => {
      if (result?.queued) {
        onClose();
        onSuccess?.();
        toast.success('Return queued for sync. Stock, future delivery blocks and WhatsApp are not confirmed until synced.');
        return;
      }
      const savedOrder = result?.response?.data || null;
      if (savedOrder && orderId) {
        queryClient.setQueryData(['order', orderId], savedOrder);
        queryClient.setQueryData(['order', 'return-settlement', orderId], savedOrder);
      }
      onClose();
      onSuccess?.();
      toast.success('Return saved');
      if (result?.response?.condition_charges?.skipped_legacy_ids?.length) {
        toast.error('Some historical charges need reconciliation. Their money records were left unchanged.');
      }
      if (orderId && order && !result?.response?.replayed) {
        const draftAfter =
          stageDraftAfter ||
          (stageUpdates?.length ? applyUpdatesToStageDraft(order, stageUpdates) : null);
        await runStageTemplateWhatsApp(wa, {
          order,
          stageDraftAfter: draftAfter,
          orderId,
          actionLabel: 'Return saved',
          excludeDelivered: true,
        });
        await runReturnMissingWhatsAppFlow({ wa, orderBefore: order, orderAfter: savedOrder, orderId });
      }
      await invalidateOrderDomain(queryClient, { orderId });
      await invalidateSecurityChargesDomain(queryClient, { orderId });
    },
    onError: async (err) => {
      if (err?.message === 'validation') return;
      const failure = classifyReturnSettlementError(err);
      if (failure.refreshBooking) {
        await invalidateOrderDomain(queryClient, { orderId });
        await invalidateSecurityChargesDomain(queryClient, { orderId });
      }
      toast.error(failure.message);
    },
  });

  const loading =
    submitMut.isPending ||
    orderQuery.isLoading ||
    paymentAccountsQuery.isLoading ||
    securityAccountsQuery.isLoading;

  const submit = () => {
    if (submitMut.isPending) return;
    submitMut.mutate();
  };

  const renderRefundAccountSelect = () => {
    if (refundVia === REFUND_VIA_BANK_CASH) {
      if (!hasLedgerBankCash) {
        return (
          <span className="flex h-9 items-center text-[10px] text-gray-500 min-w-0 flex-1">
            No active bank/cash accounts
          </span>
        );
      }
      return (
        <AccountSelectWithQr
          accountId={refundPaymentAccountId}
          accounts={paymentAccounts}
          accountKind="payment"
          size="md"
          className="min-w-0 flex-1"
        >
          <select
            className="input min-w-0 w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
            value={refundPaymentAccountId}
            onChange={(e) => setRefundPaymentAccountId(e.target.value)}
            aria-label="Return paid from bank or cash"
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
      );
    }
    if (!hasActiveSecurityAccounts) {
      return (
        <span className="flex h-9 items-center text-[10px] text-gray-500 min-w-0 flex-1">
          No active security accounts
        </span>
      );
    }
    return (
      <AccountSelectWithQr
        accountId={securityAccountId}
        accounts={securityAccounts}
        accountKind="security"
        size="md"
        className="min-w-0 flex-1"
      >
        <select
          className="input min-w-0 w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
          value={securityAccountId}
          onChange={(e) => setSecurityAccountId(e.target.value)}
          aria-label="Return paid from security account"
        >
          <option value="">Select security account</option>
          <optgroup label="Security">
            {securityAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </optgroup>
        </select>
      </AccountSelectWithQr>
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={order ? `Bill No: ${order.order_number}` : 'Return'}
        size={modalSize}
        footer={
          <>
            <div className="mr-auto self-center min-w-0">
              <ModalSecurityOnOrderHint amount={expectedDeposit} />
            </div>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submit}
              loading={submitMut.isPending}
              disabled={orderQuery.isLoading || (securityRefundRequired && !securityRefundComplete)}
              title={
                securityRefundRequired && !securityRefundComplete
                  ? `Return and charges must equal held ${formatCurrency(maxRefundNow)}`
                  : undefined
              }
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
          <div className="space-y-3 text-[11px] leading-snug">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="min-w-0">
                <label
                  htmlFor="return-settlement-bill-amount"
                  className="block text-[10px] font-medium text-gray-600 mb-1"
                >
                  Bill Amount
                </label>
                <input
                  id="return-settlement-bill-amount"
                  readOnly
                  value={formatCurrency(order.total_amount)}
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
                />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 mb-0.5">
                  <span className="text-[10px] font-medium text-gray-600">Total Discount:</span>
                  <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                    {formatCurrency(discountTotalDraft)}
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
                  className="input w-full h-9 py-1 px-2 text-[11px] bg-white tabular-nums"
                  title={`Add extra discount (max ${formatCurrency(round2(Math.max(0, Number(order.subtotal || 0) - savedDiscountTotal)))})`}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 mb-0.5">
                  <span className="text-[10px] font-medium text-gray-600">Security Amt.:</span>
                  {refundNum > 0 ? (
                    <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                      {formatCurrency(round2(Math.max(0, maxRefundNow - refundNum)), {
                        decimals: 0,
                      })}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                      {formatCurrency(maxRefundNow, { decimals: 0 })}
                    </span>
                  )}
                  {singleSecurityTxInline ? (
                    <span
                      className="text-[10px] font-medium text-gray-800 tabular-nums truncate min-w-0 max-w-[8rem] shrink"
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
                {maxRefundNow > 0 ? (
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={maxRefundNow}
                      value={securityRefundAmount}
                      onChange={(e) =>
                        setSecurityRefundAmount(
                          e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                        )
                      }
                      className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] tabular-nums"
                      title={`Return to customer (max ${formatCurrency(maxRefundNow)})`}
                    />
                    {renderRefundAccountSelect()}
                  </div>
                ) : null}
                {expectedDeposit > 0 && maxRefundNow <= 0 && securityRemainingToCollect > 0 ? (
                  <p className="text-[10px] text-gray-600">
                    No booking security is available to refund now. Manage held condition deposits separately under Missing/Damage Charges.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
              <div className="min-w-0">
                <label
                  htmlFor="return-settlement-advance"
                  className="block text-[10px] font-medium text-gray-600 mb-1"
                >
                  Advance
                </label>
                <input
                  id="return-settlement-advance"
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
                      htmlFor="return-settlement-receive"
                      className="block text-[10px] font-medium text-gray-600 mb-1"
                    >
                      Receive
                    </label>
                    <input
                      id="return-settlement-receive"
                      type="number"
                      step="0.01"
                      min="0"
                      max={balance}
                      value={receiveAmount}
                      onChange={(e) =>
                        setReceiveAmount(
                          e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value))
                        )
                      }
                      className="input w-full h-9 py-1 px-2 text-[11px] tabular-nums"
                      title={`Max ${formatCurrency(balance)}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="return-settlement-payment-account"
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
                          id="return-settlement-payment-account"
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
                  htmlFor="return-settlement-total-received"
                  className="block text-[10px] font-medium text-gray-600 mb-1"
                >
                  Total Receive Amount
                </label>
                <input
                  id="return-settlement-total-received"
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

            <ReplacementRequirementsPanel orderId={orderId} direction="source" sourceItemIds={damagedProductItemIds} />

            {conditionChargeTotal > 0 ? (
              <div className="rounded-md border border-yellow-300 bg-yellow-50 p-2.5">
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-700">
                  <span>
                    Assessed total: <strong>{formatCurrency(conditionChargeTotal)}</strong>
                  </span>
                  <span>
                    From security: <strong>{formatCurrency(retainedConditionCharge)}</strong>
                  </span>
                  <span>
                    Collect directly: <strong>{formatCurrency(directConditionCharge)}</strong>
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-600">Assessment is not payment. Collected or retained money remains a deposit until explicitly settled as income.</p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-[11px] text-gray-700">
                    Collect now
                    <input type="number" min="0" step="0.01" max={conditionChargeTotal} value={conditionCollectAmount}
                      onChange={(event) => setConditionCollectAmount(event.target.value)} className="input mt-1 w-full" />
                  </label>
                  <label className="text-[11px] text-gray-700">
                    Retain from security
                    <input type="number" min="0" step="0.01" max={Math.min(conditionChargeTotal, securityHeldNow)} value={conditionRetainAmount}
                      onChange={(event) => { setConditionRetainAmount(event.target.value); setSecurityRefundAmount('0'); }} className="input mt-1 w-full" />
                  </label>
                </div>
                {directConditionCharge > 0 ? (
                  <select
                    className="input mt-2 h-9 w-full max-w-sm bg-white px-2 py-1 text-[11px]"
                    value={chargePaymentAccountId}
                    onChange={(event) => setChargePaymentAccountId(event.target.value)}
                    aria-label="Condition charge payment account"
                  >
                    <option value="">Select charge collection account</option>
                    {[...settlementBankAccounts, ...settlementCashAccounts].map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <label
                htmlFor="return-settlement-remark"
                className="text-[10px] font-medium text-gray-600"
              >
                Return Remark
              </label>
              <label className="inline-flex items-center gap-3 text-[10px] text-gray-700">
                <input
                  type="checkbox"
                  checked={createReminder}
                  onChange={(e) => setCreateReminder(e.target.checked)}
                />
                Create Reminder
              </label>
              {createReminder ? (
                <div className="ml-auto min-w-[12rem]">
                  <label
                    htmlFor="return-settlement-reminder-at"
                    className="block text-[10px] font-medium text-gray-600 mb-1"
                  >
                    Reminder date & time
                  </label>
                  <input
                    id="return-settlement-reminder-at"
                    type="datetime-local"
                    value={reminderAt}
                    onChange={(e) => setReminderAt(e.target.value)}
                    className="input w-full h-9 py-1 px-2 text-[11px] bg-white tabular-nums"
                  />
                </div>
              ) : null}
            </div>

            <textarea
              id="return-settlement-remark"
              rows={2}
              maxLength={MAX_RETURN_REMARK}
              value={returnRemark}
              onChange={(e) => setReturnRemark(e.target.value)}
              className="input w-full resize-y min-h-[5rem] py-2 px-2 text-[11px] leading-snug"
              placeholder="Type your return remark"
            />
          </div>
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

ReturnSettlementModal.propTypes = {
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
  conditionUpdates: PropTypes.arrayOf(
    PropTypes.shape({
      item_id: PropTypes.string.isRequired,
      item_type: PropTypes.oneOf(['item', 'accessory']).isRequired,
      condition: PropTypes.oneOf(['normal', 'missing', 'damage']).isRequired,
      condition_qty: PropTypes.number,
      charge_amount: PropTypes.number,
    })
  ),
};

ReturnSettlementModal.defaultProps = {
  orderId: null,
  onSuccess: undefined,
  stageUpdates: null,
  stageDraftAfter: null,
  conditionUpdates: null,
};

export default ReturnSettlementModal;
