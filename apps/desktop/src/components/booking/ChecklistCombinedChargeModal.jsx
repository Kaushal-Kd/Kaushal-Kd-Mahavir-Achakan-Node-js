import { formatCurrency } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo } from 'react';

import { paymentAccountsByGroup } from '../../lib/paymentAccountFilters.js';
import AccountSelectWithQr from '../accounts/AccountSelectWithQr.jsx';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

const ChecklistCombinedChargeModal = ({
  isOpen,
  onClose,
  onConfirm,
  lines,
  total,
  remarks,
  onRemarksChange,
  accountId,
  onAccountIdChange,
  paymentAccountOptions,
  loading,
}) => {
  const bankAccounts = useMemo(
    () => paymentAccountsByGroup(paymentAccountOptions, ['bank accounts']),
    [paymentAccountOptions]
  );
  const cashAccounts = useMemo(
    () => paymentAccountsByGroup(paymentAccountOptions, ['cash accounts']),
    [paymentAccountOptions]
  );
  const chargeAccounts = useMemo(
    () => [...bankAccounts, ...cashAccounts],
    [bankAccounts, cashAccounts]
  );
  const hasCharge = total > 0;

  const handleConfirm = () => {
    onConfirm?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="md"
      title={hasCharge ? 'Combined missing / damage charge' : 'Missing / damage lines'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            loading={loading}
            disabled={hasCharge && !chargeAccounts.length}
          >
            {hasCharge ? 'Add charge & save' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700">
        <p className="text-xs text-gray-500">
          {hasCharge
            ? 'A combined security charge will be created from the amounts entered on each line. Per-line amounts are saved on the order; remarks are the combined note.'
            : 'No charge amounts entered. Line names will be saved in remarks only. You can add amounts on each line before saving if needed.'}
        </p>

        <div className="rounded-md border border-gray-200 bg-gray-50 max-h-40 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-2 py-1.5 font-medium">Line</th>
                <th className="px-2 py-1.5 font-medium text-right w-24">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={`${line.label}-${idx}`} className="border-b border-gray-100 last:border-0">
                  <td className="px-2 py-1.5 text-gray-900">{line.label}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-gray-900">
                    {line.amount > 0 ? formatCurrency(line.amount) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasCharge ? (
          <div className="flex items-center justify-between rounded-md border border-brand/30 bg-brand-light/30 px-3 py-2">
            <span className="text-xs font-medium text-gray-700">Total charge</span>
            <span className="text-base font-semibold tabular-nums text-gray-900">
              {formatCurrency(total)}
            </span>
          </div>
        ) : null}

        {hasCharge ? (
          <div>
            <label htmlFor="checklist-charge-account" className="block text-[10px] text-gray-500 mb-0.5">Account</label>
            <AccountSelectWithQr
              accountId={accountId}
              accounts={paymentAccountOptions}
              accountKind="payment"
              size="md"
            >
              <select
                id="checklist-charge-account"
                className="input w-full h-9 text-sm bg-surface"
                value={accountId}
                disabled={loading || !chargeAccounts.length}
                onChange={(e) => onAccountIdChange(e.target.value)}
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
            {!chargeAccounts.length ? (
              <p className="text-[10px] text-red-600 mt-1">No bank or cash account configured.</p>
            ) : null}
          </div>
        ) : null}

        <div>
          <label htmlFor="checklist-charge-remarks" className="block text-[10px] text-gray-500 mb-0.5">Remarks</label>
          <textarea
            id="checklist-charge-remarks"
            className="input w-full min-h-[4rem] text-xs py-1.5 resize-y"
            value={remarks}
            disabled={loading}
            onChange={(e) => onRemarksChange(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};

ChecklistCombinedChargeModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  lines: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      amount: PropTypes.number.isRequired,
    })
  ),
  total: PropTypes.number.isRequired,
  remarks: PropTypes.string,
  onRemarksChange: PropTypes.func.isRequired,
  accountId: PropTypes.string,
  onAccountIdChange: PropTypes.func.isRequired,
  paymentAccountOptions: PropTypes.array,
  loading: PropTypes.bool,
};

ChecklistCombinedChargeModal.defaultProps = {
  lines: [],
  remarks: '',
  accountId: '',
  paymentAccountOptions: [],
  loading: false,
};

export default ChecklistCombinedChargeModal;
