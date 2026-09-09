import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatPaymentDateTime, isDamageChargePayment, PAYMENT_TYPE, round2, todayIndiaISODate } from '@wrs/shared';
import { Plus, Printer, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import AccountBankQrButton from '../../components/accounts/AccountBankQrButton.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Select from '../../components/ui/Select.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { paymentsApi } from '../../lib/api/payments.js';
import { securityAccountsApi } from '../../lib/api/securityAccounts.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { toast } from '../../stores/uiStore.js';
import { printReceipt } from '../../utils/printBill.js';

const CATEGORY_OPTIONS = [
  { value: 'advance', label: 'Advance' },
  { value: 'partial', label: 'Partial' },
  { value: 'final', label: 'Final' },
  { value: 'deposit', label: 'Security deposit' },
  { value: 'deposit_refund', label: 'Deposit refund' },
  { value: 'refund', label: 'Refund' },
];

const PAYMENT_TYPE_OPTIONS = Object.values(PAYMENT_TYPE).map((t) => ({
  value: t,
  label: t.charAt(0).toUpperCase() + t.slice(1),
}));

const PAYMENT_LEDGER_CATEGORIES = ['advance', 'partial', 'final'];
const SECURITY_LEDGER_CATEGORIES = ['deposit', 'deposit_refund'];
const DEBIT_CATEGORIES = ['refund', 'deposit_refund'];

const isSecurityPayment = (p) =>
  SECURITY_LEDGER_CATEGORIES.includes(p.category) && !p.is_deleted;

const isBillPayment = (p) => !p.is_deleted && !isSecurityPayment(p);

const PaymentsPanel = ({ order, disabled, onAddPayment }) => {
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const [addOpen, setAddOpen] = useState(false);
  const {
    target: deleteTarget,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDelete,
  } = useAdminDelete({
    deleteFn: (payment, admin_password) => paymentsApi.remove(payment.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Payment removed');
      await invalidateOrderDomain(queryClient, { orderId: order.id });
    },
  });

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });
  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'payments-panel'],
    queryFn: () => securityAccountsApi.list(),
  });

  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = securityAccountsQuery.data?.data || [];

  const paymentAccountMap = useMemo(
    () => new Map(paymentAccounts.map((a) => [a.id, a.name])),
    [paymentAccounts]
  );
  const securityAccountMap = useMemo(
    () => new Map(securityAccounts.map((a) => [a.id, a.name])),
    [securityAccounts]
  );

  const paymentCategoryLabel = (c, notes) => {
    if (isDamageChargePayment(notes)) {
      const note = String(notes || '').toLowerCase();
      if (note.includes('reversed')) return 'Damage refund';
      return 'Damage charge';
    }
    return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ||
      (c ? String(c).replace(/_/g, ' ') : '—');
  };

  const ledgerName = (id, map) => {
    if (!id) return '—';
    return map.get(id) || id;
  };
  const entryLabel = (category) => (DEBIT_CATEGORIES.includes(category) ? 'Debit' : 'Credit');

  const outstanding = useMemo(() => round2(Number(order.total_amount) - Number(order.paid_amount || 0)), [order]);

  const allPayments = useMemo(
    () => (Array.isArray(order.payments) ? order.payments : []).filter((p) => !p.is_deleted),
    [order.payments]
  );

  const billPayments = useMemo(() => allPayments.filter(isBillPayment), [allPayments]);

  const securityPayments = useMemo(() => allPayments.filter(isSecurityPayment), [allPayments]);

  const depositCollected = useMemo(
    () =>
      round2(
        securityPayments
          .filter((p) => p.category === 'deposit')
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
      ),
    [securityPayments]
  );

  const depositRefunded = useMemo(
    () =>
      round2(
        securityPayments
          .filter((p) => p.category === 'deposit_refund')
          .reduce((sum, p) => sum + Number(p.amount || 0), 0)
      ),
    [securityPayments]
  );

  const securityHeld = useMemo(
    () => round2(Math.max(0, depositCollected - depositRefunded)),
    [depositCollected, depositRefunded]
  );

  const createMut = useMutation({
    mutationFn: (payload) => paymentsApi.create(payload),
    onSuccess: async (res) => {
      toast.success('Payment recorded');
      setAddOpen(false);
      await invalidateOrderDomain(queryClient, { orderId: order.id });
      try {
        printReceipt(order, res?.data);
      } catch {
        // ignore print errors silently; user can print again manually
      }
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Failed to record payment'),
  });

  const renderRowActions = (p) => (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        icon={Printer}
        iconOnly
        onClick={() => printReceipt(order, p)}
        aria-label="Print receipt"
      />
      <Button
        variant="ghost"
        size="sm"
        icon={Trash2}
        iconOnly
        onClick={() => requestDelete(p)}
        aria-label="Delete payment"
        disabled={disabled}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="card p-4 border-l-4 border-l-brand">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Payment transactions</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Bill · Total {formatCurrency(order.total_amount)} · Paid {formatCurrency(order.paid_amount)} ·{' '}
              <span className={outstanding > 0 ? 'text-red-600 font-medium' : 'text-green-700 font-medium'}>
                Balance {formatCurrency(outstanding)}
              </span>
            </p>
          </div>
          <Button
            icon={Plus}
            size="sm"
            onClick={() => {
              if (onAddPayment) {
                onAddPayment();
                return;
              }
              setAddOpen(true);
            }}
            disabled={disabled}
          >
            Add payment
          </Button>
        </div>

        {billPayments.length > 0 ? (
          <div className="table-wrap">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>
                    <TableHeaderLabel>Date & Time</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Category</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Entry</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Amount</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Bill account</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Mode</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Txn id</TableHeaderLabel>
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {billPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {formatPaymentDateTime(p) || '—'}
                    </td>
                    <td>{paymentCategoryLabel(p.category, p.notes)}</td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          entryLabel(p.category) === 'Debit'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {entryLabel(p.category)}
                      </span>
                    </td>
                    <td className="text-right font-medium tabular-nums">
                      {p.category === 'refund' ? '-' : ''}
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="text-gray-700">
                      {ledgerName(p.payment_account_id, paymentAccountMap)}
                    </td>
                    <td className="capitalize text-gray-700">{p.payment_type || '—'}</td>
                    <td className="font-mono text-gray-600">{p.transaction_id || '—'}</td>
                    <td>{renderRowActions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-5 text-center text-sm text-gray-500 rounded-md border border-dashed border-gray-200 bg-gray-50/80">
            No bill payments yet. Collect advance on booking and the balance on delivery.
          </div>
        )}
      </div>

      <div className="card p-4 border-l-4 border-l-yellow-500">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Security transactions</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Deposit · Expected {formatCurrency(order.deposit_amount || 0)} · Collected{' '}
            {formatCurrency(depositCollected)} · Refunded {formatCurrency(depositRefunded)} ·{' '}
            <span className="font-medium text-gray-800">Held {formatCurrency(securityHeld)}</span>
          </p>
        </div>

        {securityPayments.length > 0 ? (
          <div className="table-wrap">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>
                    <TableHeaderLabel>Date & Time</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Type</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Entry</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Amount</TableHeaderLabel>
                  </th>
                  <th>
                    <TableHeaderLabel>Security account</TableHeaderLabel>
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {securityPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {formatPaymentDateTime(p) || '—'}
                    </td>
                    <td>
                      {p.category === 'deposit_refund' ? 'Deposit refund' : 'Security deposit'}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          entryLabel(p.category) === 'Debit'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {entryLabel(p.category)}
                      </span>
                    </td>
                    <td className="text-right font-medium tabular-nums">
                      {p.category === 'deposit_refund' ? '-' : ''}
                      {formatCurrency(p.amount)}
                    </td>
                    <td className="text-gray-700">
                      {ledgerName(p.security_account_id, securityAccountMap)}
                    </td>
                    <td>{renderRowActions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-5 text-center text-sm text-gray-500 rounded-md border border-dashed border-gray-200 bg-gray-50/80">
            No security deposits or refunds recorded yet.
          </div>
        )}
      </div>

      {!onAddPayment ? (
        <AddPaymentModal
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          order={order}
          outstanding={outstanding}
          paymentAccounts={paymentAccounts}
          securityAccounts={securityAccounts}
          onSubmit={(payload) => createMut.mutate(payload)}
          loading={createMut.isPending}
        />
      ) : null}

      <AdminDeleteModal
        isOpen={Boolean(deleteTarget)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Delete this payment?"
        description={
          deleteTarget
            ? `This will remove the ${paymentCategoryLabel(deleteTarget.category, deleteTarget.notes).toLowerCase()} payment of ${formatCurrency(
                deleteTarget.amount
              )} from ${formatPaymentDateTime(deleteTarget) || 'this date'} and recompute the order balance.`
            : undefined
        }
        itemLabel={
          deleteTarget
            ? `${paymentCategoryLabel(deleteTarget.category, deleteTarget.notes)} · ${formatCurrency(deleteTarget.amount)}`
            : undefined
        }
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
      />
    </div>
  );
};

PaymentsPanel.propTypes = {
  order: PropTypes.object.isRequired,
  disabled: PropTypes.bool,
  onAddPayment: PropTypes.func,
};

PaymentsPanel.defaultProps = { disabled: false, onAddPayment: null };

/* -------------------------------------------------------------------------- */

const today = () => todayIndiaISODate();

const AddPaymentModal = ({
  isOpen,
  onClose,
  order,
  outstanding,
  paymentAccounts,
  securityAccounts,
  onSubmit,
  loading,
}) => {
  const [form, setForm] = useState({
    amount: 0,
    payment_type: 'cash',
    category: 'partial',
    payment_date: today(),
    transaction_id: '',
    notes: '',
    payment_account_id: '',
    security_account_id: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    setForm({
      amount: outstanding > 0 ? outstanding : 0,
      payment_type: 'cash',
      category: outstanding > 0 ? (Number(order.paid_amount) > 0 ? 'final' : 'advance') : 'partial',
      payment_date: today(),
      transaction_id: '',
      notes: '',
      payment_account_id: '',
      security_account_id: order.security_account_id || '',
    });
  }, [isOpen, order, outstanding]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!amt || amt <= 0) {
      toast.error('Amount must be greater than 0');
      return;
    }
    const payCats = PAYMENT_LEDGER_CATEGORIES;
    const secCats = SECURITY_LEDGER_CATEGORIES;
    const payId = String(form.payment_account_id || '').trim() || null;
    const secId = String(form.security_account_id || '').trim() || null;
    if (payCats.includes(form.category) && paymentAccounts.length > 0 && !payId) {
      toast.error('Select the payment ledger account');
      return;
    }
    onSubmit({
      order_id: order.id,
      customer_id: order.customer_id || null,
      amount: amt,
      payment_type: form.payment_type,
      category: form.category,
      payment_date: form.payment_date,
      transaction_id: form.transaction_id || null,
      notes: form.notes || null,
      payment_account_id: payCats.includes(form.category) ? payId : null,
      security_account_id: secCats.includes(form.category) ? secId : null,
    });
  };

  const showPaymentLedger =
    PAYMENT_LEDGER_CATEGORIES.includes(form.category) && paymentAccounts.length > 0;
  const showSecurityLedger =
    SECURITY_LEDGER_CATEGORIES.includes(form.category) && securityAccounts.length > 0;
  const paymentLedgerOptions = [
    { value: '', label: 'Select account' },
    ...paymentAccounts.map((a) => ({ value: a.id, label: a.name })),
  ];
  const securityLedgerOptions = [
    { value: '', label: 'None' },
    ...securityAccounts.map((a) => ({ value: a.id, label: a.name })),
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Record payment for ${order.order_number}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading}>
            Save & print receipt
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Amount"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={form.amount}
          onChange={(e) => set('amount', e.target.value)}
        />
        <Select
          label="Category"
          value={form.category}
          onChange={(e) => set('category', e.target.value)}
          options={CATEGORY_OPTIONS}
        />
        {showPaymentLedger ? (
          <Select
            label="Payment ledger account"
            required
            value={form.payment_account_id}
            onChange={(e) => set('payment_account_id', e.target.value)}
            options={paymentLedgerOptions}
            trailing={
              <AccountBankQrButton
                accountId={form.payment_account_id}
                accounts={paymentAccounts}
                accountKind="payment"
                size="md"
              />
            }
          />
        ) : null}
        {showSecurityLedger ? (
          <Select
            label="Security ledger account"
            value={form.security_account_id}
            onChange={(e) => set('security_account_id', e.target.value)}
            options={securityLedgerOptions}
            trailing={
              <AccountBankQrButton
                accountId={form.security_account_id}
                accounts={securityAccounts}
                accountKind="security"
                size="md"
              />
            }
          />
        ) : null}
        <Select
          label="Payment mode"
          value={form.payment_type}
          onChange={(e) => set('payment_type', e.target.value)}
          options={PAYMENT_TYPE_OPTIONS}
        />
        <Input
          label="Date"
          type="date"
          value={form.payment_date}
          onChange={(e) => set('payment_date', e.target.value)}
          required
        />
        <Input
          label="Transaction id (UPI / ref)"
          className="col-span-2"
          value={form.transaction_id}
          onChange={(e) => set('transaction_id', e.target.value)}
          placeholder="Optional"
        />
        <Input
          label="Notes"
          className="col-span-2"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Optional"
        />
        <div className="col-span-2 text-xs text-gray-500">
          Outstanding balance: <b>{formatCurrency(outstanding)}</b>. Amounts can exceed this only for deposits.
        </div>
      </form>
    </Modal>
  );
};

AddPaymentModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  order: PropTypes.object.isRequired,
  outstanding: PropTypes.number.isRequired,
  paymentAccounts: PropTypes.array,
  securityAccounts: PropTypes.array,
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

AddPaymentModal.defaultProps = {
  loading: false,
  paymentAccounts: [],
  securityAccounts: [],
};

export default PaymentsPanel;
