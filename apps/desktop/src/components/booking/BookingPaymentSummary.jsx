import { computeCustomOrderTotals, formatCurrency, round2 } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

import AccountSelectWithQr from '../accounts/AccountSelectWithQr.jsx';
import Input from '../ui/Input.jsx';
import Select from '../ui/Select.jsx';
import {
  AMOUNT_INPUT_CLASS,
  computePaidAtBooking,
  computePayableBalance,
  finalizeAmountOnBlur,
  mapSecurityAccountOptions,
  parseAmountInput,
  selectAmountOnFocus,
  splitPaymentAccounts,
  toNonNegativeAmount,
} from '../../lib/bookingFinancials.js';

const ACCOUNT_SELECT_CLASS = 'input min-w-0 max-w-full flex-1 text-xs py-1 px-2 pr-8';
const FORM_GRID = 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-12 gap-x-2 gap-y-2 items-end';

function SummaryRow({ label, value, muted, className, title }) {
  return (
    <div className={`flex items-center justify-between gap-2 text-xs ${className || ''}`}>
      <span className={muted ? 'text-gray-500' : 'text-gray-700'} title={title}>
        {label}
      </span>
      <span className={`tabular-nums font-medium ${muted ? 'text-gray-600' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  );
}

SummaryRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  muted: PropTypes.bool,
  className: PropTypes.string,
  title: PropTypes.string,
};

function PricingInputsRow({
  price,
  orderType,
  bookingDiscountType,
  bookingDiscountValue,
  gstEnabled,
  igstBill,
  readOnly,
  inputClass,
  onPriceChange,
  onOrderTypeChange,
  onBookingDiscountTypeChange,
  onBookingDiscountValueChange,
  onGstEnabledChange,
  onIgstBillChange,
  compact,
}) {
  const discountCol = compact ? 'lg:col-span-3' : 'lg:col-span-3';
  const gstCol = compact ? 'lg:col-span-2' : 'lg:col-span-3';

  return (
    <div className={FORM_GRID}>
      <div className="lg:col-span-3">
        <Input
          label="Price"
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => onPriceChange(parseAmountInput(e.target.value))}
          onFocus={selectAmountOnFocus}
          disabled={readOnly}
          inputClassName={`${inputClass} ${AMOUNT_INPUT_CLASS}`}
        />
      </div>
      <div className="lg:col-span-1">
        <Select
          label="Type"
          value={orderType}
          onChange={(e) => onOrderTypeChange(e.target.value)}
          disabled={readOnly}
          selectClassName={inputClass}
          options={[
            { value: 'rent', label: 'Rent' },
            { value: 'sell', label: 'Sell' },
          ]}
        />
      </div>
      <div className={`${discountCol} flex flex-wrap items-end gap-1.5`}>
        <div className="flex items-center gap-1.5 text-[11px] pb-1 shrink-0">
          <label className="inline-flex items-center gap-0.5">
            <input
              type="radio"
              name="co-booking-discount-type"
              checked={bookingDiscountType === 'flat'}
              onChange={() => onBookingDiscountTypeChange('flat')}
              disabled={readOnly}
            />
            Flat
          </label>
          <label className="inline-flex items-center gap-0.5">
            <input
              type="radio"
              name="co-booking-discount-type"
              checked={bookingDiscountType === 'percent'}
              onChange={() => onBookingDiscountTypeChange('percent')}
              disabled={readOnly}
            />
            %
          </label>
        </div>
        <Input
          label={compact ? 'Disc.' : 'Booking discount'}
          type="number"
          min={0}
          step="0.01"
          value={bookingDiscountValue}
          onChange={(e) => onBookingDiscountValueChange(parseAmountInput(e.target.value))}
          onFocus={selectAmountOnFocus}
          disabled={readOnly}
          inputClassName={`${inputClass} ${AMOUNT_INPUT_CLASS}`}
          className="min-w-[4.5rem] flex-1"
        />
      </div>
      <div className={`${gstCol} flex flex-wrap items-center gap-2 pb-1`}>
        <label className="inline-flex items-center gap-1 text-[11px] text-gray-700 whitespace-nowrap">
          <input
            type="checkbox"
            checked={gstEnabled}
            onChange={(e) => onGstEnabledChange(e.target.checked)}
            disabled={readOnly}
          />
          GST
        </label>
        {gstEnabled ? (
          <label className="inline-flex items-center gap-1 text-[11px] text-gray-700 whitespace-nowrap">
            <input
              type="checkbox"
              checked={igstBill}
              onChange={(e) => onIgstBillChange(e.target.checked)}
              disabled={readOnly}
            />
            IGST
          </label>
        ) : null}
      </div>
    </div>
  );
}

PricingInputsRow.propTypes = {
  price: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  orderType: PropTypes.string.isRequired,
  bookingDiscountType: PropTypes.string.isRequired,
  bookingDiscountValue: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  gstEnabled: PropTypes.bool.isRequired,
  igstBill: PropTypes.bool.isRequired,
  readOnly: PropTypes.bool,
  inputClass: PropTypes.string,
  compact: PropTypes.bool,
  onPriceChange: PropTypes.func.isRequired,
  onOrderTypeChange: PropTypes.func.isRequired,
  onBookingDiscountTypeChange: PropTypes.func.isRequired,
  onBookingDiscountValueChange: PropTypes.func.isRequired,
  onGstEnabledChange: PropTypes.func.isRequired,
  onIgstBillChange: PropTypes.func.isRequired,
};

function AdvanceAccountRow({
  advanceAmount,
  advanceAccountId,
  advanceBankAccounts,
  advanceCashAccounts,
  paymentAccounts,
  readOnly,
  inputClass,
  labelWidth,
  advanceAccountError,
  onAdvanceAmountChange,
  onAdvanceAccountIdChange,
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-gray-700 shrink-0 ${labelWidth}`}>Advance</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={advanceAmount}
          onChange={(e) => onAdvanceAmountChange(parseAmountInput(e.target.value))}
          onFocus={selectAmountOnFocus}
          onBlur={(e) => finalizeAmountOnBlur(e, onAdvanceAmountChange)}
          disabled={readOnly}
          className={`w-[5.5rem] ${AMOUNT_INPUT_CLASS} ${inputClass}`}
        />
        <AccountSelectWithQr
          accountId={advanceAccountId}
          accounts={paymentAccounts}
          accountKind="payment"
          size="sm"
          className="min-w-0 flex-1 max-w-[14rem]"
        >
          <select
            aria-label="Advance payment account"
            value={advanceAccountId}
            onChange={(e) => onAdvanceAccountIdChange(e.target.value)}
            disabled={readOnly}
            className={`${ACCOUNT_SELECT_CLASS} border rounded ${
              advanceAccountError ? 'border-red-400' : 'border-gray-200'
            }`}
          >
            <option value="">Account</option>
            {advanceBankAccounts.length ? (
              <optgroup label="Bank">
                {advanceBankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {advanceCashAccounts.length ? (
              <optgroup label="Cash">
                {advanceCashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </AccountSelectWithQr>
      </div>
      {advanceAccountError ? (
        <p className="text-[10px] text-red-600 pl-[4.75rem]">{advanceAccountError}</p>
      ) : null}
    </div>
  );
}

AdvanceAccountRow.propTypes = {
  advanceAmount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  advanceAccountId: PropTypes.string.isRequired,
  advanceBankAccounts: PropTypes.arrayOf(PropTypes.object).isRequired,
  advanceCashAccounts: PropTypes.arrayOf(PropTypes.object).isRequired,
  paymentAccounts: PropTypes.arrayOf(PropTypes.object).isRequired,
  readOnly: PropTypes.bool,
  inputClass: PropTypes.string,
  labelWidth: PropTypes.string,
  advanceAccountError: PropTypes.string,
  onAdvanceAmountChange: PropTypes.func.isRequired,
  onAdvanceAccountIdChange: PropTypes.func.isRequired,
};

function SecurityAccountRow({
  deposit,
  securityAccountId,
  paidSecurityAmt,
  securityAccountOptions,
  securityAccounts,
  readOnly,
  inputClass,
  labelWidth,
  securityAccountError,
  onDepositChange,
  onSecurityAccountIdChange,
  onPaidSecurityAmtChange,
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-gray-700 shrink-0 ${labelWidth}`}>Security</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={deposit}
          onChange={(e) => onDepositChange(parseAmountInput(e.target.value))}
          onFocus={selectAmountOnFocus}
          onBlur={(e) => finalizeAmountOnBlur(e, onDepositChange)}
          disabled={readOnly}
          className={`w-[5.5rem] ${AMOUNT_INPUT_CLASS} ${inputClass}`}
        />
        <AccountSelectWithQr
          accountId={securityAccountId}
          accounts={securityAccounts}
          accountKind="security"
          size="sm"
          className="min-w-0 flex-1 max-w-[14rem]"
        >
          <select
            aria-label="Security deposit account"
            value={securityAccountId}
            onChange={(e) => onSecurityAccountIdChange(e.target.value)}
            disabled={readOnly}
            className={`${ACCOUNT_SELECT_CLASS} border rounded ${
              securityAccountError ? 'border-red-400' : 'border-gray-200'
            }`}
          >
            <option value="">Account</option>
            {securityAccountOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </AccountSelectWithQr>
        <label className="inline-flex items-center gap-1 text-[11px] text-gray-700 whitespace-nowrap">
          <input
            type="checkbox"
            checked={paidSecurityAmt}
            onChange={(e) => onPaidSecurityAmtChange(e.target.checked)}
            disabled={readOnly}
          />
          Paid
        </label>
      </div>
      {securityAccountError ? (
        <p className="text-[10px] text-red-600 pl-[4.75rem]">{securityAccountError}</p>
      ) : null}
    </div>
  );
}

SecurityAccountRow.propTypes = {
  deposit: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  securityAccountId: PropTypes.string.isRequired,
  paidSecurityAmt: PropTypes.bool.isRequired,
  securityAccountOptions: PropTypes.arrayOf(PropTypes.object).isRequired,
  securityAccounts: PropTypes.arrayOf(PropTypes.object).isRequired,
  readOnly: PropTypes.bool,
  inputClass: PropTypes.string,
  labelWidth: PropTypes.string,
  securityAccountError: PropTypes.string,
  onDepositChange: PropTypes.func.isRequired,
  onSecurityAccountIdChange: PropTypes.func.isRequired,
  onPaidSecurityAmtChange: PropTypes.func.isRequired,
};

function CreditApplyBlock({
  readOnly,
  customerOpenCredit,
  customerCreditNotes,
  matchedCustomersWithCredit,
  applyCustomerCredit,
  applyCreditAmount,
  advanceAmount,
  grandTotal,
  compact,
  onApplyCustomerCreditChange,
  onApplyCreditAmountChange,
}) {
  const [showCreditNotes, setShowCreditNotes] = useState(false);

  if (readOnly || customerOpenCredit <= 0) return null;

  return (
    <div
      className={
        compact
          ? 'flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 border-t border-red-100 text-[11px] text-red-700'
          : 'space-y-2 pt-2 mt-1 border-t border-red-200 bg-red-50 rounded-md p-2.5'
      }
    >
      <span className={compact ? 'font-semibold tabular-nums' : 'text-sm font-bold text-red-700'}>
        Credit {formatCurrency(customerOpenCredit)}
      </span>
      <label
        className={`inline-flex items-center gap-1 cursor-pointer ${compact ? 'font-medium' : 'text-sm font-bold text-red-700'}`}
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 shrink-0 accent-red-600"
          checked={applyCustomerCredit}
          onChange={(e) => {
            const checked = e.target.checked;
            onApplyCustomerCreditChange(checked);
            if (checked) {
              const maxApply = round2(
                Math.min(
                  customerOpenCredit,
                  Math.max(0, grandTotal - toNonNegativeAmount(advanceAmount))
                )
              );
              onApplyCreditAmountChange(maxApply > 0 ? maxApply : 0);
            } else {
              onApplyCreditAmountChange(0);
            }
          }}
        />
        Apply
      </label>
      {applyCustomerCredit ? (
        <input
          type="number"
          step="0.01"
          min={0}
          max={Math.min(customerOpenCredit, grandTotal)}
          value={applyCreditAmount}
          onChange={(e) => onApplyCreditAmountChange(parseAmountInput(e.target.value))}
          onFocus={selectAmountOnFocus}
          onBlur={(e) => finalizeAmountOnBlur(e, onApplyCreditAmountChange)}
          className={
            compact
              ? `w-20 ${AMOUNT_INPUT_CLASS} px-1 py-0.5 bg-white`
              : `w-32 ${AMOUNT_INPUT_CLASS} border-2 border-red-300 bg-white px-2 py-1.5 text-sm font-bold text-red-700`
          }
          title="Amount of store credit to apply"
        />
      ) : null}
      {compact && (matchedCustomersWithCredit.length > 0 || customerCreditNotes.length > 0) ? (
        <button
          type="button"
          className="text-brand hover:underline"
          onClick={() => setShowCreditNotes((v) => !v)}
        >
          {showCreditNotes ? 'Hide notes' : 'Notes'}
        </button>
      ) : null}
      {!compact && matchedCustomersWithCredit.length > 0 ? (
        <ul className="text-xs font-semibold text-red-700 list-disc pl-5 space-y-0.5">
          {matchedCustomersWithCredit.map((c) => (
            <li key={c.id}>
              {c.name || 'Customer'}: {formatCurrency(c.open_balance)} available
            </li>
          ))}
        </ul>
      ) : null}
      {!compact && customerCreditNotes.length > 0 ? (
        <ul className="text-xs font-bold text-red-700 list-disc pl-5 space-y-1">
          {customerCreditNotes.map((n) => (
            <li key={n.id}>
              Credit note {n.note_number}: {formatCurrency(n.remaining)} available
              {n.linked_phone ? ` · ${n.linked_phone}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {compact && showCreditNotes ? (
        <ul className="w-full text-[10px] list-disc pl-4 space-y-0.5 text-red-800">
          {matchedCustomersWithCredit.map((c) => (
            <li key={c.id}>
              {c.name || 'Customer'}: {formatCurrency(c.open_balance)}
            </li>
          ))}
          {customerCreditNotes.map((n) => (
            <li key={n.id}>
              {n.note_number}: {formatCurrency(n.remaining)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

CreditApplyBlock.propTypes = {
  readOnly: PropTypes.bool,
  customerOpenCredit: PropTypes.number.isRequired,
  customerCreditNotes: PropTypes.arrayOf(PropTypes.object),
  matchedCustomersWithCredit: PropTypes.arrayOf(PropTypes.object),
  applyCustomerCredit: PropTypes.bool.isRequired,
  applyCreditAmount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  advanceAmount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  grandTotal: PropTypes.number.isRequired,
  compact: PropTypes.bool,
  onApplyCustomerCreditChange: PropTypes.func.isRequired,
  onApplyCreditAmountChange: PropTypes.func.isRequired,
};

function TaxBreakdownDetails({ totals, gstEnabled, hideZero }) {
  const rows = [
    { label: 'Subtotal', value: totals.subtotal },
    { label: 'Taxable', value: totals.taxable },
    { label: 'Booking disc.', value: totals.booking_discount, hide: hideZero && totals.booking_discount <= 0 },
    { label: 'Discount', value: totals.discount_total, hide: hideZero && totals.discount_total <= 0 },
    gstEnabled && totals.cgst > 0 ? { label: 'CGST', value: totals.cgst, muted: true } : null,
    gstEnabled && totals.sgst > 0 ? { label: 'SGST', value: totals.sgst, muted: true } : null,
    gstEnabled && totals.igst > 0 ? { label: 'IGST', value: totals.igst, muted: true } : null,
    { label: 'Round off', value: totals.round_off, muted: true, hide: hideZero && Math.abs(totals.round_off) < 0.005 },
  ].filter(Boolean).filter((r) => !r.hide);

  return (
    <div className="space-y-0.5 pt-1">
      {rows.map((r) => (
        <SummaryRow
          key={r.label}
          label={r.label}
          value={formatCurrency(r.value)}
          muted={r.muted}
        />
      ))}
    </div>
  );
}

TaxBreakdownDetails.propTypes = {
  totals: PropTypes.object.isRequired,
  gstEnabled: PropTypes.bool.isRequired,
  hideZero: PropTypes.bool,
};

function StandardLayout(props) {
  const {
    totals,
    gstEnabled,
    paidAtBooking,
    payableBalance,
    advanceBankAccounts,
    advanceCashAccounts,
    securityAccountOptions,
    inputClass,
    labelWidth = 'w-28',
  } = props;

  return (
    <div className="space-y-2">
      <PricingInputsRow {...props} compact={false} inputClass={inputClass} />
      <div className="rounded border border-gray-200 bg-gray-50 p-2.5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
          <SummaryRow label="Subtotal" value={formatCurrency(totals.subtotal)} />
          <SummaryRow label="Taxable Amt." value={formatCurrency(totals.taxable)} />
          {gstEnabled ? (
            <SummaryRow label="CGST Amt." value={formatCurrency(totals.cgst)} muted />
          ) : null}
          <SummaryRow label="Booking Discount(-)" value={formatCurrency(totals.booking_discount)} />
          {gstEnabled ? (
            <SummaryRow label="SGST Amt." value={formatCurrency(totals.sgst)} muted />
          ) : null}
          <SummaryRow label="Discount(-)" value={formatCurrency(totals.discount_total)} />
          {gstEnabled ? (
            <SummaryRow label="IGST Amt." value={formatCurrency(totals.igst)} muted />
          ) : null}
          <SummaryRow label="Round Off" value={formatCurrency(totals.round_off)} muted />
          <SummaryRow
            label="Grand Total"
            value={formatCurrency(totals.grand_total)}
            className="md:col-span-2 font-semibold"
          />
        </div>
      </div>
      <div className="rounded border border-gray-200 p-2.5 space-y-2">
        <AdvanceAccountRow
          {...props}
          advanceBankAccounts={advanceBankAccounts}
          advanceCashAccounts={advanceCashAccounts}
          inputClass={inputClass}
          labelWidth={labelWidth}
        />
        <SecurityAccountRow
          {...props}
          securityAccountOptions={securityAccountOptions}
          inputClass={inputClass}
          labelWidth={labelWidth}
        />
        <SummaryRow
          label="Paid"
          value={formatCurrency(paidAtBooking)}
          className="font-medium"
          title="Advance and applied credit toward the bill, plus security when Paid Security Amt. is checked."
        />
        <SummaryRow
          label="Payable Amt."
          value={formatCurrency(payableBalance)}
          title="Grand total minus advance and applied credit. Security does not reduce bill balance."
        />
        <CreditApplyBlock {...props} grandTotal={totals.grand_total} compact={false} />
      </div>
    </div>
  );
}

function CompactLayout(props) {
  const {
    totals,
    gstEnabled,
    paidAtBooking,
    payableBalance,
    advanceBankAccounts,
    advanceCashAccounts,
    securityAccountOptions,
    inputClass,
  } = props;

  return (
    <div className="space-y-2">
      <PricingInputsRow {...props} compact inputClass={inputClass} />
      <div className="rounded border border-gray-200 p-2 lg:grid lg:grid-cols-2 lg:gap-x-4 lg:gap-y-1">
        <div className="space-y-1.5 lg:pr-2 lg:border-r lg:border-gray-100">
          <AdvanceAccountRow
            {...props}
            advanceBankAccounts={advanceBankAccounts}
            advanceCashAccounts={advanceCashAccounts}
            inputClass={inputClass}
            labelWidth="w-[4.25rem]"
          />
          <SecurityAccountRow
            {...props}
            securityAccountOptions={securityAccountOptions}
            inputClass={inputClass}
            labelWidth="w-[4.25rem]"
          />
          <CreditApplyBlock {...props} grandTotal={totals.grand_total} compact />
        </div>
        <div className="mt-2 lg:mt-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100 space-y-1">
          <SummaryRow
            label="Grand total"
            value={formatCurrency(totals.grand_total)}
            className="text-sm font-semibold"
          />
          <SummaryRow label="Paid" value={formatCurrency(paidAtBooking)} />
          <SummaryRow
            label="Payable"
            value={formatCurrency(payableBalance)}
            className="text-brand font-medium"
          />
          <details className="group pt-1">
            <summary className="cursor-pointer text-[11px] text-brand hover:underline list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform inline-block">›</span>
              Tax breakdown
            </summary>
            <TaxBreakdownDetails totals={totals} gstEnabled={gstEnabled} hideZero />
          </details>
        </div>
      </div>
    </div>
  );
}

const BookingPaymentSummary = ({
  layout = 'standard',
  price,
  orderType,
  bookingDiscountType,
  bookingDiscountValue,
  gstEnabled,
  igstBill,
  taxMode,
  gstDefaultRate,
  advanceAmount,
  advanceAccountId,
  deposit,
  paidSecurityAmt,
  securityAccountId,
  applyCustomerCredit,
  applyCreditAmount,
  customerOpenCredit,
  customerCreditNotes,
  matchedCustomersWithCredit,
  onPriceChange,
  onOrderTypeChange,
  onBookingDiscountTypeChange,
  onBookingDiscountValueChange,
  onGstEnabledChange,
  onIgstBillChange,
  onAdvanceAmountChange,
  onAdvanceAccountIdChange,
  onDepositChange,
  onPaidSecurityAmtChange,
  onSecurityAccountIdChange,
  onApplyCustomerCreditChange,
  onApplyCreditAmountChange,
  paymentAccounts,
  securityAccounts,
  readOnly,
  compactInputClass,
  advanceAccountError,
  securityAccountError,
}) => {
  const totals = useMemo(
    () =>
      computeCustomOrderTotals(
        {
          price,
          line_discount: 0,
          booking_discount_type: bookingDiscountType,
          booking_discount_value: bookingDiscountValue,
          gst_enabled: gstEnabled,
          igst_bill: igstBill,
          tax_mode: taxMode,
          advance_amount: advanceAmount,
          apply_credit_amount: applyCustomerCredit ? applyCreditAmount : 0,
        },
        { gstPercent: gstDefaultRate }
      ),
    [
      price,
      bookingDiscountType,
      bookingDiscountValue,
      gstEnabled,
      igstBill,
      taxMode,
      advanceAmount,
      applyCustomerCredit,
      applyCreditAmount,
      gstDefaultRate,
    ]
  );

  const { bank: advanceBankAccounts, cash: advanceCashAccounts } = useMemo(
    () => splitPaymentAccounts(paymentAccounts),
    [paymentAccounts]
  );
  const securityAccountOptions = useMemo(
    () => mapSecurityAccountOptions(securityAccounts),
    [securityAccounts]
  );

  const paidAtBooking = computePaidAtBooking({
    advanceAmount,
    applyCreditAmount: applyCustomerCredit ? applyCreditAmount : 0,
    deposit,
    paidSecurityAmt,
  });
  const payableBalance = computePayableBalance({
    grandTotal: totals.grand_total,
    advanceAmount,
    applyCreditAmount: applyCustomerCredit ? applyCreditAmount : 0,
  });

  const inputClass = compactInputClass || 'h-8 text-xs py-1 px-2';

  const sharedProps = {
    price,
    orderType,
    bookingDiscountType,
    bookingDiscountValue,
    gstEnabled,
    igstBill,
    readOnly,
    advanceAmount,
    advanceAccountId,
    deposit,
    paidSecurityAmt,
    securityAccountId,
    applyCustomerCredit,
    applyCreditAmount,
    customerOpenCredit,
    customerCreditNotes,
    matchedCustomersWithCredit,
    paymentAccounts,
    securityAccounts,
    onPriceChange,
    onOrderTypeChange,
    onBookingDiscountTypeChange,
    onBookingDiscountValueChange,
    onGstEnabledChange,
    onIgstBillChange,
    onAdvanceAmountChange,
    onAdvanceAccountIdChange,
    onDepositChange,
    onPaidSecurityAmtChange,
    onSecurityAccountIdChange,
    onApplyCustomerCreditChange,
    onApplyCreditAmountChange,
    totals,
    paidAtBooking,
    payableBalance,
    advanceBankAccounts,
    advanceCashAccounts,
    securityAccountOptions,
    inputClass,
    advanceAccountError,
    securityAccountError,
  };

  if (layout === 'compact') {
    return <CompactLayout {...sharedProps} />;
  }

  return <StandardLayout {...sharedProps} />;
};

BookingPaymentSummary.propTypes = {
  layout: PropTypes.oneOf(['standard', 'compact']),
  price: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  orderType: PropTypes.string.isRequired,
  bookingDiscountType: PropTypes.string.isRequired,
  bookingDiscountValue: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  gstEnabled: PropTypes.bool.isRequired,
  igstBill: PropTypes.bool.isRequired,
  taxMode: PropTypes.string.isRequired,
  gstDefaultRate: PropTypes.number.isRequired,
  advanceAmount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  advanceAccountId: PropTypes.string.isRequired,
  deposit: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  paidSecurityAmt: PropTypes.bool.isRequired,
  securityAccountId: PropTypes.string.isRequired,
  applyCustomerCredit: PropTypes.bool.isRequired,
  applyCreditAmount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  customerOpenCredit: PropTypes.number,
  customerCreditNotes: PropTypes.arrayOf(PropTypes.object),
  matchedCustomersWithCredit: PropTypes.arrayOf(PropTypes.object),
  onPriceChange: PropTypes.func.isRequired,
  onOrderTypeChange: PropTypes.func.isRequired,
  onBookingDiscountTypeChange: PropTypes.func.isRequired,
  onBookingDiscountValueChange: PropTypes.func.isRequired,
  onGstEnabledChange: PropTypes.func.isRequired,
  onIgstBillChange: PropTypes.func.isRequired,
  onAdvanceAmountChange: PropTypes.func.isRequired,
  onAdvanceAccountIdChange: PropTypes.func.isRequired,
  onDepositChange: PropTypes.func.isRequired,
  onPaidSecurityAmtChange: PropTypes.func.isRequired,
  onSecurityAccountIdChange: PropTypes.func.isRequired,
  onApplyCustomerCreditChange: PropTypes.func.isRequired,
  onApplyCreditAmountChange: PropTypes.func.isRequired,
  paymentAccounts: PropTypes.arrayOf(PropTypes.object),
  securityAccounts: PropTypes.arrayOf(PropTypes.object),
  readOnly: PropTypes.bool,
  compactInputClass: PropTypes.string,
  advanceAccountError: PropTypes.string,
  securityAccountError: PropTypes.string,
};

BookingPaymentSummary.defaultProps = {
  layout: 'standard',
  customerOpenCredit: 0,
  customerCreditNotes: [],
  matchedCustomersWithCredit: [],
  paymentAccounts: [],
  securityAccounts: [],
  readOnly: false,
  compactInputClass: '',
  advanceAccountError: '',
  securityAccountError: '',
};

export default BookingPaymentSummary;
