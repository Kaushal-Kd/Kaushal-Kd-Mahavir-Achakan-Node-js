import { useMutation } from '@tanstack/react-query';
import { formatCurrency, round2, todayIndiaISODate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { paymentsApi } from '../../lib/api/payments.js';
import { securityChargesApi } from '../../lib/api/securityCharges.js';
import {
  activeIncomePaymentAccounts,
  activeSecurityAccountsList,
  paymentAccountsByGroup,
} from '../../lib/paymentAccountFilters.js';
import { toast } from '../../stores/uiStore.js';

export const NO_ACTIVE_INCOME_ACCOUNT_MSG =
  'No active Income account configured. Add one under Accounts.';

export const SETTLE_SOURCE_SECURITY = 'security';
export const SETTLE_SOURCE_BANK_CASH = 'bank_cash';

const REFUND_VIA_SECURITY = 'security';
const REFUND_VIA_BANK_CASH = 'bank_cash';

const today = () => todayIndiaISODate();

const toGiveAmount = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

/**
 * @param {'add'|'settle'} mode — add: remarks for return settlement charge; settle: give to customer or income
 */
const SecurityChargeIncomeModal = ({
  isOpen,
  onClose,
  mode,
  amount,
  heldAmount,
  returnAmount,
  loading,
  paymentAccounts,
  securityAccounts,
  heldPaymentAccountId,
  heldSecurityAccountId,
  initialRemarks,
  pendingChargeNotes,
  billLabel,
  orderId,
  customerId,
  securityHeldMax,
  chargeId,
  suggestedPaymentAccountId,
  onSubmit,
  onRefundSuccess,
}) => {
  const [remarks, setRemarks] = useState('');
  const [paymentAccountId, setPaymentAccountId] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [sourceVia, setSourceVia] = useState(SETTLE_SOURCE_SECURITY);
  /** @type {'choose'|'give'|'income'} */
  const [settleStep, setSettleStep] = useState('choose');
  const [giveRefundVia, setGiveRefundVia] = useState(REFUND_VIA_SECURITY);
  const [giveSecurityAccountId, setGiveSecurityAccountId] = useState('');
  const [givePaymentAccountId, setGivePaymentAccountId] = useState('');
  const [giveAmountDraft, setGiveAmountDraft] = useState('');

  const hasIncomeAccount = activeIncomePaymentAccounts(paymentAccounts || []).length > 0;
  const bankAccounts = useMemo(
    () => paymentAccountsByGroup(paymentAccounts, ['bank accounts']),
    [paymentAccounts]
  );
  const cashAccounts = useMemo(
    () => paymentAccountsByGroup(paymentAccounts, ['cash accounts']),
    [paymentAccounts]
  );
  const bankCashAccounts = useMemo(
    () => [...bankAccounts, ...cashAccounts],
    [bankAccounts, cashAccounts]
  );
  const activeSecurityAccounts = useMemo(
    () => activeSecurityAccountsList(securityAccounts || []),
    [securityAccounts]
  );
  const hasLedgerBankCash = bankCashAccounts.length > 0;
  const hasActiveSecurityAccounts = activeSecurityAccounts.length > 0;
  const hasSettleSource = hasLedgerBankCash || hasActiveSecurityAccounts;

  const chargeAmount = round2(Number(amount) || 0);
  const held = round2(Number(heldAmount) || 0);
  const returnAmt = round2(Number(returnAmount) || 0);
  const maxGive = round2(
    Math.max(0, Math.min(chargeAmount, Number(securityHeldMax) > 0 ? Number(securityHeldMax) : chargeAmount))
  );
  const giveNum = toGiveAmount(giveAmountDraft);
  const suggestedChargeAccountSummary = useMemo(() => {
    if (chargeAmount <= 0) return '';
    const heldPay = String(heldPaymentAccountId || '').trim();
    const heldSec = String(heldSecurityAccountId || '').trim();
    if (heldSec) {
      const sel = activeSecurityAccounts.find((a) => String(a.id) === heldSec);
      if (!sel) return '';
      return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(sel.name || 'Security account')}`;
    }
    const suggestedPay = heldPay || String(suggestedPaymentAccountId || '').trim();
    if (!suggestedPay) return '';
    const bank = bankAccounts.find((a) => String(a.id) === suggestedPay);
    if (bank)
      return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(bank.name || 'Account')} (Bank)`;
    const cash = cashAccounts.find((a) => String(a.id) === suggestedPay);
    if (cash)
      return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(cash.name || 'Account')} (Cash)`;
    const any = bankCashAccounts.find((a) => String(a.id) === suggestedPay);
    if (!any) return '';
    return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(any.name || 'Account')}`;
  }, [
    activeSecurityAccounts,
    bankAccounts,
    bankCashAccounts,
    cashAccounts,
    chargeAmount,
    heldPaymentAccountId,
    heldSecurityAccountId,
    suggestedPaymentAccountId,
  ]);
  const settleSourceSummary = useMemo(() => {
    if (chargeAmount <= 0) return '';
    if (sourceVia === SETTLE_SOURCE_SECURITY) {
      const sel = activeSecurityAccounts.find((a) => String(a.id) === String(securityAccountId));
      if (!sel) return '';
      return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(sel.name || 'Security account')}`;
    }
    const payId = String(paymentAccountId || '').trim();
    if (!payId) return '';
    const bank = bankAccounts.find((a) => String(a.id) === payId);
    if (bank) return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(bank.name || 'Account')} (Bank)`;
    const cash = cashAccounts.find((a) => String(a.id) === payId);
    if (cash) return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(cash.name || 'Account')} (Cash)`;
    const any = bankCashAccounts.find((a) => String(a.id) === payId);
    if (!any) return '';
    return `${formatCurrency(chargeAmount, { decimals: 0 })} taken in ${String(any.name || 'Account')}`;
  }, [
    activeSecurityAccounts,
    bankAccounts,
    bankCashAccounts,
    cashAccounts,
    chargeAmount,
    paymentAccountId,
    securityAccountId,
    sourceVia,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    setRemarks(String(initialRemarks || ''));
    setPaymentAccountId('');
    setSecurityAccountId('');
    setGiveSecurityAccountId('');
    setGivePaymentAccountId('');
    setSettleStep('choose');
    setGiveAmountDraft(chargeAmount > 0 ? String(chargeAmount) : '');
    if (hasActiveSecurityAccounts) {
      setSourceVia(SETTLE_SOURCE_SECURITY);
      setGiveRefundVia(REFUND_VIA_SECURITY);
    } else if (hasLedgerBankCash) {
      setSourceVia(SETTLE_SOURCE_BANK_CASH);
      setGiveRefundVia(REFUND_VIA_BANK_CASH);
    }
    const heldPay = String(heldPaymentAccountId || '').trim();
    const heldSec = String(heldSecurityAccountId || '').trim();
    if (mode === 'settle' && heldSec && activeSecurityAccounts.some((a) => String(a.id) === heldSec)) {
      setSourceVia(SETTLE_SOURCE_SECURITY);
      setSecurityAccountId(heldSec);
    }
    const suggestedPay = heldPay || String(suggestedPaymentAccountId || '').trim();
    if (mode === 'settle' && suggestedPay && bankCashAccounts.some((a) => String(a.id) === suggestedPay)) {
      setSourceVia(SETTLE_SOURCE_BANK_CASH);
      setPaymentAccountId(suggestedPay);
    }
  }, [
    isOpen,
    mode,
    initialRemarks,
    chargeAmount,
    hasActiveSecurityAccounts,
    hasLedgerBankCash,
    suggestedPaymentAccountId,
    heldPaymentAccountId,
    heldSecurityAccountId,
    bankCashAccounts,
    activeSecurityAccounts,
  ]);

  useEffect(() => {
    if (settleStep === 'give' && chargeAmount > 0 && !giveAmountDraft) {
      setGiveAmountDraft(String(Math.min(chargeAmount, maxGive || chargeAmount)));
    }
    if (settleStep !== 'give') return;
    const heldPay = String(heldPaymentAccountId || '').trim();
    const heldSec = String(heldSecurityAccountId || '').trim();
    const suggestedPay = heldPay || String(suggestedPaymentAccountId || '').trim();
    const hasSuggestedBankCash =
      suggestedPay && bankCashAccounts.some((a) => String(a.id) === suggestedPay);

    // Prefer the held/charge account for auto-selection.
    if (heldSec && activeSecurityAccounts.some((a) => String(a.id) === heldSec)) {
      setGiveRefundVia(REFUND_VIA_SECURITY);
      setGiveSecurityAccountId((prev) => (prev ? prev : heldSec));
      setGivePaymentAccountId('');
      return;
    }
    if (hasSuggestedBankCash) {
      setGiveRefundVia(REFUND_VIA_BANK_CASH);
      setGivePaymentAccountId((prev) => (prev ? prev : suggestedPay));
      setGiveSecurityAccountId('');
    }
  }, [
    settleStep,
    chargeAmount,
    maxGive,
    giveAmountDraft,
    suggestedPaymentAccountId,
    heldPaymentAccountId,
    heldSecurityAccountId,
    bankCashAccounts,
    activeSecurityAccounts,
  ]);

  const giveMut = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error('no_order');
      const refundNum = toGiveAmount(giveAmountDraft);
      if (refundNum <= 0) {
        toast.error('Enter amount to give customer');
        throw new Error('validation');
      }
      if (refundNum > maxGive + 0.009) {
        toast.error(`Cannot exceed ${formatCurrency(maxGive)} held for this bill`);
        throw new Error('validation');
      }
      const secId = String(giveSecurityAccountId || '').trim();
      const payId = String(givePaymentAccountId || '').trim();
      if (giveRefundVia === REFUND_VIA_SECURITY) {
        if (!hasActiveSecurityAccounts) {
          toast.error('No active security account');
          throw new Error('validation');
        }
        if (!secId) {
          toast.error('Select your security account to pay from');
          throw new Error('validation');
        }
      } else if (!hasLedgerBankCash || !payId) {
        toast.error('Select bank/cash account to pay from');
        throw new Error('validation');
      }

      await securityChargesApi.syncReturnSettlement({
        order_id: orderId,
        return_amount: refundNum,
        remarks: String(remarks || pendingChargeNotes || '').trim() || null,
      });

      await paymentsApi.create({
        order_id: orderId,
        customer_id: customerId || null,
        category: 'deposit_refund',
        amount: refundNum,
        payment_type: 'cash',
        payment_date: today(),
        transaction_id: null,
        notes: String(remarks || pendingChargeNotes || '').trim() || null,
        payment_account_id: giveRefundVia === REFUND_VIA_BANK_CASH ? payId : null,
        security_account_id: giveRefundVia === REFUND_VIA_SECURITY ? secId : null,
      });
    },
    onSuccess: async () => {
      toast.success('Refund given to customer');
      if (typeof onRefundSuccess === 'function') {
        await onRefundSuccess({ chargeId, amount: giveNum });
      }
      onClose();
    },
    onError: (e) => {
      if (e?.message === 'validation') return;
      toast.error(e?.response?.data?.error?.message || e?.message || 'Could not refund customer');
    },
  });

  const isSettleChoose = mode === 'settle' && settleStep === 'choose';
  const isSettleGive = mode === 'settle' && settleStep === 'give';
  const isSettleIncome = mode === 'settle' && settleStep === 'income';
  const busy = loading || giveMut.isPending;

  const title = (() => {
    if (mode === 'add') return 'Add security charge';
    if (isSettleGive) return billLabel ? `Give to customer · ${billLabel}` : 'Give to customer';
    if (isSettleChoose) {
      return billLabel
        ? `Security charge · ${billLabel}`
        : `Security charge · ${formatCurrency(chargeAmount, { decimals: 0 })}`;
    }
    return 'Post charge as income';
  })();

  const settleSubmitDisabled = isSettleIncome && (!hasIncomeAccount || !hasSettleSource);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === 'settle' && settleStep === 'give') {
      giveMut.mutate();
      return;
    }
    if (mode === 'settle' && settleStep !== 'income') return;
    if (mode === 'add') {
      onSubmit({
        remarks: String(remarks || '').trim() || null,
      });
      return;
    }
    if (!hasIncomeAccount) {
      toast.error(NO_ACTIVE_INCOME_ACCOUNT_MSG);
      return;
    }
    if (sourceVia === SETTLE_SOURCE_SECURITY) {
      if (!hasActiveSecurityAccounts) {
        toast.error('No active security account. Use Bank/Cash or add under Accounts.');
        return;
      }
      if (!securityAccountId) {
        toast.error('Select your security account (where the amount was held)');
        return;
      }
      onSubmit({
        security_account_id: securityAccountId,
        remarks: String(remarks || '').trim() || null,
      });
      return;
    }
    if (!hasLedgerBankCash) {
      toast.error('No active bank or cash account. Use Security account or add under Accounts.');
      return;
    }
    if (!paymentAccountId) {
      toast.error('Select your bank/cash account (where the amount was held)');
      return;
    }
    onSubmit({
      payment_account_id: paymentAccountId,
      remarks: String(remarks || '').trim() || null,
    });
  };

  const renderIncomeSourceSelect = () => {
    if (sourceVia === SETTLE_SOURCE_BANK_CASH) {
      if (!hasLedgerBankCash) {
        return (
          <span className="flex h-9 items-center text-[10px] text-gray-500">
            No active bank or cash accounts. Add under Master → Accounts.
          </span>
        );
      }
      return (
        <AccountSelectWithQr
          accountId={paymentAccountId}
          accounts={paymentAccounts}
          accountKind="payment"
          size="md"
        >
          <select
            id="sec-charge-account"
            className="input w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
            value={paymentAccountId}
            onChange={(e) => setPaymentAccountId(e.target.value)}
          >
            <option value="">Select account</option>
            {bankAccounts.length ? (
              <optgroup label="Bank">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {cashAccounts.length ? (
              <optgroup label="Cash">
                {cashAccounts.map((a) => (
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
        <span className="flex h-9 items-center text-[10px] text-gray-500">
          No active security accounts. Add under Master → Accounts.
        </span>
      );
    }
    return (
      <AccountSelectWithQr
        accountId={securityAccountId}
        accounts={securityAccounts}
        accountKind="security"
        size="md"
      >
        <select
          id="sec-charge-security-account"
          className="input w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
          value={securityAccountId}
          onChange={(e) => setSecurityAccountId(e.target.value)}
        >
          <option value="">Select security account</option>
          {activeSecurityAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </AccountSelectWithQr>
    );
  };

  const renderGiveAccountSelect = () => {
    if (giveRefundVia === REFUND_VIA_BANK_CASH) {
      if (!hasLedgerBankCash) {
        return (
          <span className="flex h-9 items-center text-[10px] text-gray-500 flex-1">
            No active bank/cash accounts
          </span>
        );
      }
      return (
        <AccountSelectWithQr
          accountId={givePaymentAccountId}
          accounts={paymentAccounts}
          accountKind="payment"
          size="md"
          className="min-w-0 flex-1"
        >
          <select
            className="input min-w-0 w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
            value={givePaymentAccountId}
            onChange={(e) => setGivePaymentAccountId(e.target.value)}
            aria-label="Your account to pay customer from"
          >
            <option value="">Select account</option>
            {bankAccounts.length ? (
              <optgroup label="Bank">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {cashAccounts.length ? (
              <optgroup label="Cash">
                {cashAccounts.map((a) => (
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
        <span className="flex h-9 items-center text-[10px] text-gray-500 flex-1">
          No active security accounts
        </span>
      );
    }
    return (
      <AccountSelectWithQr
        accountId={giveSecurityAccountId}
        accounts={securityAccounts}
        accountKind="security"
        size="md"
        className="min-w-0 flex-1"
      >
        <select
          className="input min-w-0 w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
          value={giveSecurityAccountId}
          onChange={(e) => setGiveSecurityAccountId(e.target.value)}
          aria-label="Your security account to pay customer from"
        >
          <option value="">Select security account</option>
          {activeSecurityAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </AccountSelectWithQr>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {mode === 'add' ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              loading={loading}
              disabled={busy || chargeAmount <= 0}
              title={chargeAmount <= 0 ? 'No charge amount to save' : undefined}
            >
              Save charge note
            </Button>
          ) : null}
          {isSettleGive ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              loading={giveMut.isPending}
              disabled={busy || !orderId || giveNum <= 0}
            >
              Give {giveNum > 0 ? formatCurrency(giveNum, { decimals: 0 }) : ''} to customer
            </Button>
          ) : null}
          {isSettleIncome ? (
            <Button
              size="sm"
              onClick={handleSubmit}
              loading={loading}
              disabled={busy || settleSubmitDisabled}
            >
              Submit income
            </Button>
          ) : null}
        </>
      }
    >
      <form className="space-y-3 text-[11px]" onSubmit={handleSubmit}>
        {isSettleChoose && chargeAmount > 0 ? (
          <div className="space-y-3">
            <p className="text-[10px] text-gray-700">
              Pending charge{' '}
              <span className="font-semibold tabular-nums text-gray-900">
                {formatCurrency(chargeAmount, { decimals: 0 })}
              </span>
              . Choose what happens to this amount:
            </p>
            {suggestedChargeAccountSummary ? (
              <p className="text-[15px] text-gray-700 tabular-nums">
                <span className="font-semibold text-gray-900">{suggestedChargeAccountSummary}</span>
              </p>
            ) : null}
            <div className="rounded border border-sky-300 bg-sky-50 px-3 py-3 space-y-2">
              <p className="text-[11px] font-semibold text-sky-900">Give to customer</p>
              <p className="text-[10px] text-gray-700">
                Customer returned the missing item. Money <strong>leaves your account</strong> and goes{' '}
                <strong>to the customer</strong> — settle here, no need to open Return.
              </p>
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="w-full sm:w-auto"
                disabled={!orderId}
                onClick={() => {
                  setGiveAmountDraft(String(Math.min(chargeAmount, maxGive || chargeAmount)));
                  setSettleStep('give');
                }}
              >
                Give {formatCurrency(chargeAmount, { decimals: 0 })} to customer
              </Button>
            </div>
            <div className="rounded border border-green-300 bg-green-50 px-3 py-3 space-y-2">
              <p className="text-[11px] font-semibold text-green-900">Income to your account</p>
              <p className="text-[10px] text-gray-700">
                Customer will <strong>not</strong> return the item. Keep{' '}
                <span className="font-semibold tabular-nums">{formatCurrency(chargeAmount, { decimals: 0 })}</span>{' '}
                as <strong>your shop income</strong>.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="w-full sm:w-auto border-green-400 text-green-900"
                onClick={() => setSettleStep('income')}
              >
                Post as income to your account
              </Button>
            </div>
            {String(pendingChargeNotes || '').trim() ? (
              <div>
                <p className="text-[10px] font-medium text-gray-600 mb-1">Charge details</p>
                <p className="text-[10px] text-gray-700 whitespace-pre-wrap">
                  {String(pendingChargeNotes).trim()}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {isSettleGive ? (
          <div className="space-y-3 rounded border border-sky-200 bg-sky-50/60 px-2 py-2">
            <button
              type="button"
              className="text-[10px] text-brand hover:underline"
              onClick={() => setSettleStep('choose')}
            >
              ← Back — choose Give to customer or Income
            </button>
            <p className="text-[10px] text-gray-700">
              Money goes <strong>to the customer</strong> from your account below.
            </p>
            <div>
              <label htmlFor="sec-give-amount" className="block text-[10px] font-medium text-gray-600 mb-1">
                Amount to give customer
              </label>
              <input
                id="sec-give-amount"
                type="number"
                step="0.01"
                min="0"
                max={maxGive}
                value={giveAmountDraft}
                onChange={(e) =>
                  setGiveAmountDraft(e.target.value === '' ? '' : String(toGiveAmount(e.target.value)))
                }
                className="input w-full h-9 py-1 px-2 text-[11px] tabular-nums"
              />
              {maxGive > 0 && maxGive < chargeAmount ? (
                <p className="text-[10px] text-gray-500 mt-0.5">Max held now: {formatCurrency(maxGive)}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium text-gray-600 shrink-0">Pay customer from</span>
              {hasActiveSecurityAccounts ? (
                <label className="inline-flex items-center gap-1 text-[10px] text-gray-700">
                  <input
                    type="radio"
                    name="give-refund-via"
                    checked={giveRefundVia === REFUND_VIA_SECURITY}
                    onChange={() => setGiveRefundVia(REFUND_VIA_SECURITY)}
                  />
                  Security account
                </label>
              ) : null}
              {hasLedgerBankCash ? (
                <label className="inline-flex items-center gap-1 text-[10px] text-gray-700">
                  <input
                    type="radio"
                    name="give-refund-via"
                    checked={giveRefundVia === REFUND_VIA_BANK_CASH}
                    onChange={() => setGiveRefundVia(REFUND_VIA_BANK_CASH)}
                  />
                  Bank / Cash
                </label>
              ) : null}
            </div>
            <div className="flex gap-1 items-center">
              <span className="text-[10px] font-medium text-gray-600 shrink-0 w-[5.5rem]">Your account</span>
              {renderGiveAccountSelect()}
            </div>
            <div>
              <label htmlFor="sec-give-remarks" className="block text-[10px] font-medium text-gray-600 mb-1">
                Remarks (optional)
              </label>
              <textarea
                id="sec-give-remarks"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="input w-full text-[11px] py-2 px-2 min-h-[3rem]"
                placeholder="e.g. Missing item returned"
              />
            </div>
          </div>
        ) : null}

        {isSettleIncome && chargeAmount > 0 ? (
          <>
            <button
              type="button"
              className="text-[10px] text-brand hover:underline"
              onClick={() => setSettleStep('choose')}
            >
              ← Back — choose Give to customer or Income
            </button>
            <div className="space-y-1 rounded border border-green-200 bg-green-50/80 px-2 py-2">
              <p className="text-[10px] font-semibold text-green-900">Income to your account</p>
              <p className="text-gray-800">
                <span className="font-semibold text-green-700 tabular-nums">
                  {formatCurrency(chargeAmount, { decimals: 0 })}
                </span>{' '}
                — not paid to the customer. Complete the fields below to post as income.
              </p>
            </div>
          </>
        ) : null}

        {mode === 'add' && chargeAmount > 0 ? (
          <div className="space-y-1">
            <p className="text-gray-800">
              Security charge:{' '}
              <span className="font-semibold text-red-600 tabular-nums">
                {formatCurrency(chargeAmount, { decimals: 0 })}
              </span>
            </p>
            <p className="text-[10px] text-gray-600 tabular-nums">
              Paid {formatCurrency(held, { decimals: 0 })} − Give{' '}
              {formatCurrency(returnAmt, { decimals: 0 })}
            </p>
            <p className="text-[10px] text-gray-500">
              Give to customer = amount paid back. Use Settle on this charge to give here or post as income.
            </p>
          </div>
        ) : null}

        {mode === 'add' && String(pendingChargeNotes || '').trim() ? (
          <div>
            <p className="text-[10px] font-medium text-gray-600 mb-1">Pending checklist charges</p>
            <pre className="input w-full text-[10px] py-2 px-2 min-h-[3rem] max-h-32 overflow-y-auto whitespace-pre-wrap font-sans text-gray-800 bg-gray-50">
              {String(pendingChargeNotes).trim()}
            </pre>
          </div>
        ) : null}

        {isSettleIncome && String(pendingChargeNotes || '').trim() ? (
          <div>
            <p className="text-[10px] font-medium text-gray-600 mb-1">Charge details</p>
            <p className="text-[10px] text-gray-700 whitespace-pre-wrap">{String(pendingChargeNotes).trim()}</p>
          </div>
        ) : null}

        {mode === 'add' || isSettleIncome ? (
          <div>
            <label htmlFor="sec-charge-remarks" className="block text-[10px] font-medium text-gray-600 mb-1">
              {isSettleIncome ? 'Write Income Remarks' : 'Remarks'}
            </label>
            <textarea
              id="sec-charge-remarks"
              rows={4}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="input w-full text-[11px] py-2 px-2 min-h-[5rem]"
              placeholder={isSettleIncome ? 'Write Income Remarks' : 'Reason for charge…'}
            />
          </div>
        ) : null}

        {isSettleIncome && !hasIncomeAccount ? (
          <p className="text-[10px] text-red-600 rounded border border-red-200 bg-red-50 px-2 py-2">
            {NO_ACTIVE_INCOME_ACCOUNT_MSG} Use Master → Accounts, set group to Income and mark Active.
          </p>
        ) : null}
        {isSettleIncome && hasIncomeAccount ? (
          <>
            <div>
              <p className="text-[10px] font-semibold text-gray-700 mb-0.5">Held in your account (source)</p>
              <p className="text-[10px] text-gray-500 mb-1.5">
                Confirm which account this charge is taken in, then post to income. The checklist only records
                the account — income is created when you Settle here.
              </p>
              <div className="flex flex-wrap items-center gap-3 mb-1.5">
                {hasActiveSecurityAccounts ? (
                  <label className="inline-flex items-center gap-1 text-[10px] text-gray-700">
                    <input
                      type="radio"
                      name="settle-source-via"
                      checked={sourceVia === SETTLE_SOURCE_SECURITY}
                      onChange={() => setSourceVia(SETTLE_SOURCE_SECURITY)}
                    />
                    Security account
                  </label>
                ) : null}
                {hasLedgerBankCash ? (
                  <label className="inline-flex items-center gap-1 text-[10px] text-gray-700">
                    <input
                      type="radio"
                      name="settle-source-via"
                      checked={sourceVia === SETTLE_SOURCE_BANK_CASH}
                      onChange={() => setSourceVia(SETTLE_SOURCE_BANK_CASH)}
                    />
                    Bank / Cash
                  </label>
                ) : null}
              </div>
              {renderIncomeSourceSelect()}
              {settleSourceSummary ? (
                <p className="mt-1 text-[10px] text-gray-700 tabular-nums">{settleSourceSummary}</p>
              ) : null}
            </div>
          </>
        ) : null}
      </form>
    </Modal>
  );
};

SecurityChargeIncomeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  mode: PropTypes.oneOf(['add', 'settle']).isRequired,
  amount: PropTypes.number,
  heldAmount: PropTypes.number,
  returnAmount: PropTypes.number,
  loading: PropTypes.bool,
  paymentAccounts: PropTypes.arrayOf(PropTypes.object),
  securityAccounts: PropTypes.arrayOf(PropTypes.object),
  heldPaymentAccountId: PropTypes.string,
  heldSecurityAccountId: PropTypes.string,
  initialRemarks: PropTypes.string,
  pendingChargeNotes: PropTypes.string,
  billLabel: PropTypes.string,
  orderId: PropTypes.string,
  customerId: PropTypes.string,
  securityHeldMax: PropTypes.number,
  chargeId: PropTypes.string,
  suggestedPaymentAccountId: PropTypes.string,
  onSubmit: PropTypes.func.isRequired,
  onRefundSuccess: PropTypes.func,
};

SecurityChargeIncomeModal.defaultProps = {
  amount: 0,
  heldAmount: 0,
  returnAmount: 0,
  loading: false,
  paymentAccounts: [],
  securityAccounts: [],
  heldPaymentAccountId: null,
  heldSecurityAccountId: null,
  initialRemarks: '',
  pendingChargeNotes: '',
  billLabel: '',
  orderId: null,
  customerId: null,
  securityHeldMax: 0,
  chargeId: null,
  suggestedPaymentAccountId: null,
  onRefundSuccess: undefined,
};

export default SecurityChargeIncomeModal;
