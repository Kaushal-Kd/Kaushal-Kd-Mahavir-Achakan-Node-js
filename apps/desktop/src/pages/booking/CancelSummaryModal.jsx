import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2 } from '@wrs/shared';
import { Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useWhatsAppOutbound } from '../../contexts/WhatsAppOutboundContext.jsx';
import { useModalSize } from '../../hooks/useModalSize.js';
import { ordersApi } from '../../lib/api/orders.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';
import ModalSecurityOnOrderHint from './ModalSecurityOnOrderHint.jsx';
import SecurityTransactionsModal from './SecurityTransactionsModal.jsx';
import { formatSingleSecurityTxInline } from './securityTxInlineSummary.js';

const CREDIT_NOTE_REMARKS = 'Bill cancelled';

function sumByCategory(payments, category) {
  return (Array.isArray(payments) ? payments : [])
    .filter((p) => p?.category === category && !p?.is_deleted)
    .reduce((s, p) => s + Number(p?.amount || 0), 0);
}

const toNonNegativeNumber = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

const normPaymentAccountGroup = (g) =>
  String(g ?? '')
    .trim()
    .toLowerCase();

const CancelSummaryModal = ({ isOpen, orderId, onClose }) => {
  const modalSize = useModalSize('xl');
  const qc = useQueryClient();
  const wa = useWhatsAppOutbound();
  const [refundAmount, setRefundAmount] = useState('');
  const [refundPaymentAccountId, setRefundPaymentAccountId] = useState('');
  const [securityRefundAmount, setSecurityRefundAmount] = useState('');
  const [securityAccountId, setSecurityAccountId] = useState('');
  const [securityTxOpen, setSecurityTxOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const orderQuery = useQuery({
    queryKey: ['order', orderId, 'cancel-summary'],
    queryFn: () => ordersApi.get(orderId).then((r) => r.data),
    enabled: Boolean(isOpen && orderId),
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'cancel-summary-modal'],
    queryFn: () => securityAccountsApi.list(),
    enabled: Boolean(isOpen && orderId),
  });

  const order = orderQuery.data;
  const payments = Array.isArray(order?.payments) ? order.payments : [];

  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = securityAccountsQuery.data?.data || [];

  const settlementBankAccounts = useMemo(
    () => paymentAccounts.filter((a) => normPaymentAccountGroup(a.account_group) === 'bank accounts'),
    [paymentAccounts]
  );
  const settlementCashAccounts = useMemo(
    () => paymentAccounts.filter((a) => normPaymentAccountGroup(a.account_group) === 'cash accounts'),
    [paymentAccounts]
  );
  const hasLedgerBankCash = settlementBankAccounts.length + settlementCashAccounts.length > 0;

  const depositCollected = useMemo(() => sumByCategory(payments, 'deposit'), [payments]);
  const depositRefunded = useMemo(() => sumByCategory(payments, 'deposit_refund'), [payments]);
  const securityHeldNow = useMemo(
    () => round2(Math.max(0, Number(depositCollected || 0) - Number(depositRefunded || 0))),
    [depositCollected, depositRefunded]
  );

  const advanceCollected = useMemo(() => sumByCategory(payments, 'advance'), [payments]);
  const advanceRefunded = useMemo(() => sumByCategory(payments, 'refund'), [payments]);
  const creditNoteIssued = useMemo(() => sumByCategory(payments, 'credit_note_issue'), [payments]);
  const advanceNetPaid = useMemo(
    () =>
      round2(
        Math.max(
          0,
          Number(advanceCollected || 0) - Number(advanceRefunded || 0) - Number(creditNoteIssued || 0)
        )
      ),
    [advanceCollected, advanceRefunded, creditNoteIssued]
  );

  const refundNum = round2(Number(refundAmount) || 0);
  const autoCreditNoteNum = useMemo(
    () => round2(Math.max(0, advanceNetPaid - refundNum)),
    [advanceNetPaid, refundNum]
  );
  const securityRefundNum = round2(Number(securityRefundAmount) || 0);
  const maxRefundNow = useMemo(() => round2(Math.max(0, advanceNetPaid)), [advanceNetPaid]);
  const maxSecurityRefundNow = useMemo(() => round2(Math.max(0, securityHeldNow)), [securityHeldNow]);
  const securityRemainingAfterEntry = useMemo(
    () => round2(Math.max(0, securityHeldNow - securityRefundNum)),
    [securityHeldNow, securityRefundNum]
  );
  const pendingAfterRefundPreview = useMemo(
    () => round2(Math.max(0, round2(Number(order?.balance || 0)) - refundNum)),
    [order?.balance, refundNum]
  );

  const needsSettlementSummary = advanceNetPaid > 0 || securityHeldNow > 0;

  const singleSecurityTxInline = useMemo(
    () =>
      formatSingleSecurityTxInline(order?.payments, {
        paymentAccounts,
        securityAccounts,
      }),
    [order?.payments, paymentAccounts, securityAccounts]
  );

  const securityOptions = useMemo(
    () => [{ value: '', label: 'Select account' }, ...securityAccounts.map((a) => ({ value: a.id, label: a.name }))],
    [securityAccounts]
  );

  useEffect(() => {
    if (!isOpen) return;
    setRefundAmount('');
    setRefundPaymentAccountId('');
    setSecurityRefundAmount('');
    setSecurityAccountId('');
    setConfirmOpen(false);
  }, [isOpen, orderId]);

  const buildCancelPayload = () => ({
    refund_amount: refundNum,
    refund_payment_account_id: refundNum > 0 ? refundPaymentAccountId : null,
    security_refund_amount: securityRefundNum,
    security_account_id: securityRefundNum > 0 ? securityAccountId : null,
    credit_note_amount: autoCreditNoteNum,
    credit_note_remarks: autoCreditNoteNum > 0 ? CREDIT_NOTE_REMARKS : null,
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('no_order');
      await ordersApi.cancel(order.id, buildCancelPayload());
    },
    onSuccess: async () => {
      setConfirmOpen(false);
      toast.success('Order cancelled');
      await invalidateOrderDomain(qc, { orderId });
      if (order && orderId) {
        await wa.runOutbound({
          templateKey: 'CANCEL_BOOKING',
          orderId,
          order,
          customer: order.customer,
          actionLabel: 'Order cancelled',
          silentSkip: false,
        });
      }
      onClose();
    },
    onError: (e) => {
      if (e?.message === 'validation') return;
      toast.error(e?.response?.data?.error?.message || e?.message || 'Failed to cancel');
    },
  });

  const validateBeforeCancel = () => {
    if (!order) return false;
    if (refundNum < 0 || securityRefundNum < 0) {
      toast.error('Amounts cannot be negative');
      return false;
    }
    if (refundNum > maxRefundNow) {
      toast.error(`Refund amount cannot be more than ${formatCurrency(maxRefundNow)}`);
      return false;
    }
    if (securityRefundNum > maxSecurityRefundNow) {
      toast.error(`Security refund cannot be more than ${formatCurrency(maxSecurityRefundNow)}`);
      return false;
    }
    if (refundNum > 0 && !refundPaymentAccountId) {
      toast.error('Select refund account');
      return false;
    }
    if (securityRefundNum > 0 && !securityAccountId) {
      toast.error('Select security account');
      return false;
    }
    return true;
  };

  const confirmSummaryMessage = (
    <div className="space-y-2 text-sm text-gray-700">
      <p>Please confirm cancellation and settlement:</p>
      <ul className="list-none space-y-1.5 tabular-nums">
        {advanceNetPaid > 0 ? (
          <li>
            <span className="text-gray-600">Advance on bill:</span>{' '}
            <span className="font-medium">{formatCurrency(advanceNetPaid)}</span>
          </li>
        ) : null}
        {refundNum > 0 ? (
          <li>
            <span className="text-gray-600">Cash refund:</span>{' '}
            <span className="font-medium">{formatCurrency(refundNum)}</span>
          </li>
        ) : null}
        {autoCreditNoteNum > 0 ? (
          <li>
            <span className="text-gray-600">Credit note (auto):</span>{' '}
            <span className="font-medium">{formatCurrency(autoCreditNoteNum)}</span>
            <span className="text-gray-500 text-xs block mt-0.5">{CREDIT_NOTE_REMARKS}</span>
          </li>
        ) : null}
        {securityRefundNum > 0 ? (
          <li>
            <span className="text-gray-600">Security refund:</span>{' '}
            <span className="font-medium">{formatCurrency(securityRefundNum)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );

  const submit = (e) => {
    e.preventDefault();
    if (!validateBeforeCancel()) return;
    if (!needsSettlementSummary) {
      cancelMut.mutate();
      return;
    }
    setConfirmOpen(true);
  };

  const loading =
    cancelMut.isPending ||
    orderQuery.isLoading ||
    paymentAccountsQuery.isLoading ||
    securityAccountsQuery.isLoading;

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={order ? `Bill No: ${order.order_number}` : 'Cancel booking'}
      size={modalSize}
      footer={
        <>
          <div className="mr-auto self-center min-w-0">
            <ModalSecurityOnOrderHint amount={order?.deposit_amount} />
          </div>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={submit}
            loading={cancelMut.isPending}
            disabled={orderQuery.isLoading || !order}
            danger
          >
            Submit
          </Button>
        </>
      }
    >
      {orderQuery.isLoading ? (
        <p className="text-[11px] text-gray-500">Loading…</p>
      ) : orderQuery.isError || !order ? (
        <p className="text-[11px] text-red-600">Could not load order.</p>
      ) : (
        <form className="space-y-3 text-[11px] leading-snug" onSubmit={submit}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="min-w-0">
              <label htmlFor="cancel-bill-amount" className="block text-[10px] font-medium text-gray-600 mb-1">Bill Amount</label>
              <input
                id="cancel-bill-amount"
                readOnly
                value={formatCurrency(order.total_amount)}
                className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0 mb-0.5">
                <span className="text-[10px] font-medium text-gray-600">Total Discount:</span>
                <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                  {formatCurrency(order.discount_total)}
                </span>
              </div>
              <input
                readOnly
                value={String(Number(order.discount_total || 0))}
                className="input w-full h-9 py-1 px-2 text-[11px] bg-white tabular-nums"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 mb-0.5">
                <span className="text-[10px] font-medium text-gray-600">Security Amt.:</span>
                {securityRefundNum > 0 ? (
                  <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                    {formatCurrency(securityRemainingAfterEntry)}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-green-700 tabular-nums">
                    {formatCurrency(securityHeldNow)}
                  </span>
                )}
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
              <div className="flex gap-1 items-center">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={maxSecurityRefundNow}
                  value={securityRefundAmount}
                  onChange={(e) =>
                    setSecurityRefundAmount(e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value)))
                  }
                  className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] tabular-nums"
                  title={`Max ${formatCurrency(maxSecurityRefundNow)}`}
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
                      className="input min-w-0 w-full h-9 py-1 px-2 text-[11px] bg-surface pr-5"
                      value={securityAccountId}
                      onChange={(e) => setSecurityAccountId(e.target.value)}
                    >
                      {securityOptions.map((o) => (
                        <option key={o.value === '' ? '_empty' : o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </AccountSelectWithQr>
                ) : (
                  <span className="text-[10px] text-gray-500">No accounts</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="min-w-0">
              <label htmlFor="cancel-advance" className="block text-[10px] font-medium text-gray-600 mb-1">Advance</label>
              <input
                id="cancel-advance"
                readOnly
                value={formatCurrency(advanceNetPaid)}
                className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
              />
            </div>

            <div className="min-w-0">
              <label htmlFor="cancel-refund" className="block text-[10px] font-medium text-gray-600 mb-1">Refund</label>
              <div className="flex gap-1 items-center">
                <input
                  id="cancel-refund"
                  type="number"
                  step="0.01"
                  min="0"
                  max={maxRefundNow}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value)))}
                  className="input min-w-0 flex-1 h-9 py-1 px-2 text-[11px] tabular-nums"
                  title={`Max ${formatCurrency(maxRefundNow)}`}
                />
                {hasLedgerBankCash ? (
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
                  <span className="text-[10px] text-gray-500">No accounts</span>
                )}
              </div>
              {advanceNetPaid > 0 ? (
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Credit note (auto): {formatCurrency(autoCreditNoteNum)}
                  {autoCreditNoteNum > 0 ? ` · ${CREDIT_NOTE_REMARKS}` : ''}
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <div className="flex flex-row gap-1 items-baseline justify-between">
                <label htmlFor="cancel-payable-amount" className="block text-[10px] font-medium text-gray-600 mb-1">Total Payble Amount</label>
                <span
                  className={`text-[10px] font-semibold tabular-nums ${
                    pendingAfterRefundPreview > 0 ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  Pending Amount: {formatCurrency(pendingAfterRefundPreview)}
                </span>
              </div>
              <input
                id="cancel-payable-amount"
                readOnly
                value={formatCurrency(order.balance || 0)}
                className="input w-full h-9 py-1 px-2 text-[11px] bg-gray-100 text-gray-900 tabular-nums"
              />
            </div>
          </div>
        </form>
      )}
    </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          if (!validateBeforeCancel()) return;
          cancelMut.mutate();
        }}
        title="Confirm cancel"
        message={confirmSummaryMessage}
        confirmLabel="Yes, cancel"
        cancelLabel="No"
        danger
        loading={cancelMut.isPending}
      />

    <SecurityTransactionsModal
      isOpen={securityTxOpen}
      orderId={orderId}
      onClose={() => setSecurityTxOpen(false)}
    />
    </>
  );
};

CancelSummaryModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

CancelSummaryModal.defaultProps = {
  orderId: null,
};

export default CancelSummaryModal;

