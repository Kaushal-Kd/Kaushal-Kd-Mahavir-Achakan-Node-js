import { formatCurrency, securityChargeOperationBodySchema, todayIndiaISODate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Select from '../../components/ui/Select.jsx';
import { useSecurityChargeOperations } from '../../hooks/api/useSecurityChargeOperations.js';
import { toast } from '../../stores/uiStore.js';

const KINDS = [
  { value: 'collect', label: 'Collect now (held deposit)' },
  { value: 'retain', label: 'Retain existing booking security' },
  { value: 'refund', label: 'Refund held money' },
  { value: 'release', label: 'Release hold back to booking security' },
  { value: 'settle', label: 'Settle held money as income' },
];

function operationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

export default function SecurityChargeFundsModal({
  charge,
  paymentAccounts,
  securityAccounts,
  onClose,
}) {
  const { detail, mutation, online } = useSecurityChargeOperations(charge.id, charge.order_id);
  const data = detail.data?.data;
  const [kind, setKind] = useState('collect');
  const [amount, setAmount] = useState('0');
  const [fundingId, setFundingId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [incomeId, setIncomeId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [operationKey, setOperationKey] = useState(operationId);
  const cashBank = paymentAccounts.filter((row) =>
    ['cash accounts', 'bank accounts'].includes(String(row.account_group || '').toLowerCase())
  );
  const income = paymentAccounts.filter(
    (row) => String(row.account_group || '').toLowerCase() === 'income'
  );
  const lots = (data?.funding_lots || []).filter(
    (lot) => Number(lot.available) > 0 && (kind !== 'release' || lot.kind === 'retain')
  );
  const needsLot = ['refund', 'release', 'settle'].includes(kind);
  const accountLabel = (lot) =>
    paymentAccounts.find((row) => row.id === lot.payment_account_id)?.name ||
    securityAccounts.find((row) => row.id === lot.security_account_id)?.name ||
    'Original account';
  const payoutOptions = useMemo(
    () => [
      ...cashBank.map((row) => ({ value: `payment:${row.id}`, label: row.name })),
      ...(kind === 'refund'
        ? securityAccounts.map((row) => ({
            value: `security:${row.id}`,
            label: `Security: ${row.name}`,
          }))
        : []),
    ],
    [cashBank, securityAccounts, kind]
  );
  const submit = async () => {
    const [family, selectedId] = accountId.split(':');
    const payload = {
      idempotency_key: operationKey,
      kind,
      amount: Number(amount),
      payment_date: todayIndiaISODate(),
      ...(needsLot ? { funding_operation_id: fundingId } : {}),
      ...(['collect', 'refund'].includes(kind) && selectedId
        ? { [family === 'security' ? 'security_account_id' : 'payment_account_id']: selectedId }
        : {}),
      ...(kind === 'settle' ? { income_account_id: incomeId } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    const parsed = securityChargeOperationBodySchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    try {
      const result = await mutation.mutateAsync(parsed.data);
      toast.success(
        result.queued
          ? 'Operation queued; balances change after server confirmation'
          : 'Condition funds updated'
      );
      onClose();
    } catch (error) {
      toast.error(
        error?.response?.data?.error?.message || error.message || 'Could not update funds'
      );
    }
  };
  const resetOperation = (value) => {
    setKind(value);
    setAmount('0');
    setFundingId('');
    setAccountId('');
    setIncomeId('');
    setOperationKey(operationId());
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Manage condition funds"
      size="lg"
      closeOnBackdrop={false}
      closeOnEscape={false}
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={mutation.isPending}
            disabled={!data?.ledger_verified || detail.isLoading}
          >
            Confirm operation
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{charge.remarks || 'Missing/damage charge'}</p>
        {!online && (
          <p className="text-sm text-yellow-700">
            Offline: your explicit operation will be queued and validated before changing balances.
          </p>
        )}
        {detail.isError && (
          <p className="text-sm text-red-700">
            Could not load the verified balance. Retry when connected.
          </p>
        )}
        {data && !data.ledger_verified && (
          <p className="text-sm text-yellow-700">
            Legacy charge: collection is unverified. Reconcile it before recording money operations.
          </p>
        )}
        {data?.ledger_verified && data?.balances && (
          <div className="flex flex-wrap gap-4 text-sm">
            <span>Assessed: {formatCurrency(data.balances.assessed)}</span>
            <span>Held: {formatCurrency(data.balances.held)}</span>
            <span>Uncollected: {formatCurrency(data.balances.uncollected)}</span>
            <span>Recognized: {formatCurrency(data.balances.settled)}</span>
          </div>
        )}
        <Select
          label="Operation"
          value={kind}
          onChange={(event) => resetOperation(event.target.value)}
          options={KINDS}
        />
        <Input
          label="Amount"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        {needsLot && (
          <Select
            label="Original held funds"
            value={fundingId}
            onChange={(event) => setFundingId(event.target.value)}
            options={[
              { value: '', label: 'Select held funds' },
              ...lots.map((lot) => ({
                value: lot.id,
                label: `${lot.kind === 'retain' ? 'Retained' : 'Collected'} · ${accountLabel(lot)} · ${formatCurrency(lot.available)}`,
              })),
            ]}
          />
        )}
        {['collect', 'refund'].includes(kind) && (
          <Select
            label={kind === 'collect' ? 'Collection account' : 'Actual payout account'}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            options={[{ value: '', label: 'Select account' }, ...payoutOptions]}
          />
        )}
        {kind === 'settle' && (
          <>
            <Select
              label="Income account"
              value={incomeId}
              onChange={(event) => setIncomeId(event.target.value)}
              options={[
                { value: '', label: 'Select income account' },
                ...income.map((row) => ({ value: row.id, label: row.name })),
              ]}
            />
            <p className="text-sm text-yellow-700">
              This recognizes existing held money as income. Already recognized income cannot be
              refunded here.
            </p>
          </>
        )}
        {kind === 'refund' && (
          <p className="text-xs text-gray-600">
            Refunding returns held money only. Resolve the item condition separately if its
            assessed charge should be cleared.
          </p>
        )}
        <Input
          label="Remarks"
          value={remarks}
          maxLength={2000}
          onChange={(event) => setRemarks(event.target.value)}
        />
        <div className="max-h-48 overflow-auto rounded border border-gray-200 p-3 text-xs">
          <p className="mb-2 font-medium">Recorded operations</p>
          {(data?.operations || []).map((operation) => (
            <p key={operation.id}>
              {String(operation.payment_date).slice(0, 10)} · {operation.kind} ·{' '}
              {formatCurrency(operation.amount)}
            </p>
          ))}
          {!data?.operations?.length && (
            <p>
              {data?.ledger_verified
                ? 'No verified money operations recorded.'
                : 'Legacy collection history is unverified.'}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

SecurityChargeFundsModal.propTypes = {
  charge: PropTypes.object.isRequired,
  paymentAccounts: PropTypes.array.isRequired,
  securityAccounts: PropTypes.array.isRequired,
  onClose: PropTypes.func.isRequired,
};
