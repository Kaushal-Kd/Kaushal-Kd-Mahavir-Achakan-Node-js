import { phoneInputDigits } from '@wrs/shared';
import PropTypes from 'prop-types';

import { isBankPaymentAccountGroup } from '../../lib/paymentAccountFilters.js';
import Button from '../ui/Button.jsx';
import ImageUploader from '../ui/ImageUploader.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';
import Select from '../ui/Select.jsx';

export const ACCOUNT_GROUP_OPTIONS = [
  { value: 'Parties', label: 'Parties' },
  { value: 'Vendors', label: 'Vendors' },
  { value: 'Purchase', label: 'Purchase' },
  { value: 'Income', label: 'Income' },
  { value: 'Expenses', label: 'Expenses' },
  { value: 'Bank Accounts', label: 'Bank Accounts' },
  { value: 'Cash Accounts', label: 'Cash Accounts' },
];

export function emptyPaymentAccountDraft(overrides = {}) {
  return {
    name: '',
    contact_no: '',
    account_group: '',
    account_type: 'other',
    opening_balance: 0,
    date: '',
    email: '',
    address: '',
    remarks: '',
    qr_code_url: '',
    ...overrides,
  };
}

export function createPaymentAccountLocalId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function resolveAccountGroup(draft, fixedAccountGroup) {
  return fixedAccountGroup || draft.account_group || '';
}

/**
 * Same fields as Master → Accounts → Payment Accounts “Create / Edit Account” modal.
 * When `fixedAccountGroup` is set (e.g. Income from Add Income), the group is read-only.
 */
const PaymentAccountFormModal = ({
  isOpen,
  onClose,
  title,
  draft,
  setDraft,
  editingId,
  fixedAccountGroup,
  onSave,
  saveLoading,
}) => {
  const resolvedTitle = title || (editingId ? 'Edit Account' : 'Create Account');
  const groupLocked = Boolean(fixedAccountGroup);
  const effectiveGroup = resolveAccountGroup(draft, fixedAccountGroup);
  const showQrUpload = isBankPaymentAccountGroup(effectiveGroup);

  const onAccountGroupChange = (nextGroup) => {
    const normalized = String(nextGroup).toLowerCase();
    const inferredType =
      normalized === 'cash accounts'
        ? 'cash'
        : normalized === 'bank accounts'
          ? 'bank'
          : draft.account_type;
    setDraft((s) => ({
      ...s,
      account_group: nextGroup,
      account_type: inferredType,
      qr_code_url: isBankPaymentAccountGroup(nextGroup) ? s.qr_code_url : '',
    }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={resolvedTitle}
      size="md"
      closeOnBackdrop={false}
      closeOnEscape={false}
      showCloseButton={false}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" loading={saveLoading} onClick={onSave}>
            {editingId ? 'Update' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          label="Name"
          required
          value={draft.name}
          onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
        />
        <Input
          label="Contact No"
          required
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit mobile (digits only)"
          value={draft.contact_no}
          onChange={(e) =>
            setDraft((s) => ({ ...s, contact_no: phoneInputDigits(e.target.value) }))
          }
        />
        {groupLocked ? (
          <div>
            <div className="label">Account Group</div>
            <p className="text-sm text-gray-800 py-2 rounded border border-gray-100 bg-gray-50 px-2">
              {fixedAccountGroup}
            </p>
          </div>
        ) : (
          <Select
            label="Account Group"
            required
            value={draft.account_group}
            onChange={(e) => onAccountGroupChange(e.target.value)}
            options={ACCOUNT_GROUP_OPTIONS}
            placeholder="Select"
          />
        )}
        <Select
          label="Account Type"
          required
          value={draft.account_type || 'other'}
          onChange={(e) => setDraft((s) => ({ ...s, account_type: e.target.value }))}
          options={[
            { value: 'cash', label: 'Cash counter' },
            { value: 'bank', label: 'Bank' },
            { value: 'upi', label: 'UPI / Online' },
            { value: 'other', label: 'Other ledger' },
          ]}
        />
        <Input
          label="Opening Balance"
          type="number"
          value={draft.opening_balance}
          onChange={(e) =>
            setDraft((s) => ({
              ...s,
              opening_balance: e.target.value === '' ? '' : Number(e.target.value) || 0,
            }))
          }
        />
        <Input
          label="Date"
          type="date"
          value={draft.date}
          onChange={(e) => setDraft((s) => ({ ...s, date: e.target.value }))}
        />
        <Input
          label="Email"
          value={draft.email}
          onChange={(e) => setDraft((s) => ({ ...s, email: e.target.value }))}
        />
        <Input
          label="Address"
          value={draft.address}
          onChange={(e) => setDraft((s) => ({ ...s, address: e.target.value }))}
        />
        <div className="md:col-span-2">
          <Input
            label="Remarks"
            value={draft.remarks}
            onChange={(e) => setDraft((s) => ({ ...s, remarks: e.target.value }))}
          />
        </div>
        {showQrUpload ? (
          <div className="md:col-span-2">
            <ImageUploader
              label="Bank QR code"
              hint="Upload UPI / bank payment QR (PNG or JPG, max 700 KB after optimization)."
              folder="payment-account-qr"
              value={draft.qr_code_url || ''}
              onChange={(url) => setDraft((s) => ({ ...s, qr_code_url: url }))}
              size="md"
              skipCrop
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

PaymentAccountFormModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  draft: PropTypes.shape({
    name: PropTypes.string,
    contact_no: PropTypes.string,
    account_group: PropTypes.string,
    account_type: PropTypes.oneOf(['cash', 'bank', 'upi', 'other']),
    opening_balance: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    date: PropTypes.string,
    email: PropTypes.string,
    address: PropTypes.string,
    remarks: PropTypes.string,
    qr_code_url: PropTypes.string,
  }).isRequired,
  setDraft: PropTypes.func.isRequired,
  editingId: PropTypes.string,
  fixedAccountGroup: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  saveLoading: PropTypes.bool,
};

PaymentAccountFormModal.defaultProps = {
  title: null,
  editingId: null,
  fixedAccountGroup: null,
  saveLoading: false,
};

export default PaymentAccountFormModal;
