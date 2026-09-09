import PropTypes from 'prop-types';

import {
  isBankSecurityAccountType,
  SECURITY_ACCOUNT_TYPE_OPTIONS,
} from '../../lib/paymentAccountFilters.js';
import Button from '../ui/Button.jsx';
import ImageUploader from '../ui/ImageUploader.jsx';
import Input from '../ui/Input.jsx';
import Modal from '../ui/Modal.jsx';
import Select from '../ui/Select.jsx';

export function emptySecurityAccountDraft(overrides = {}) {
  return {
    name: '',
    account_type: 'cash',
    qr_code_url: '',
    ...overrides,
  };
}

const SecurityAccountFormModal = ({
  isOpen,
  onClose,
  title,
  draft,
  setDraft,
  editingId,
  onSave,
  saveLoading,
}) => {
  const resolvedTitle = title || (editingId ? 'Edit Security Account' : 'Create Security Account');
  const showQrUpload = isBankSecurityAccountType(draft.account_type);

  const onAccountTypeChange = (nextType) => {
    setDraft((s) => ({
      ...s,
      account_type: nextType,
      qr_code_url: isBankSecurityAccountType(nextType) ? s.qr_code_url : '',
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
      <div className="grid grid-cols-1 gap-2">
        <Input
          label="Name"
          required
          value={draft.name}
          onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
        />
        <Select
          label="Account type"
          required
          value={draft.account_type || 'cash'}
          onChange={(e) => onAccountTypeChange(e.target.value)}
          options={SECURITY_ACCOUNT_TYPE_OPTIONS}
        />
        {showQrUpload ? (
          <ImageUploader
            label="Bank QR code"
            hint="Upload UPI / bank payment QR (PNG or JPG, max 700 KB after optimization)."
            folder="security-account-qr"
            value={draft.qr_code_url || ''}
            onChange={(url) => setDraft((s) => ({ ...s, qr_code_url: url }))}
            size="md"
            skipCrop
          />
        ) : null}
      </div>
    </Modal>
  );
};

SecurityAccountFormModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  draft: PropTypes.shape({
    name: PropTypes.string,
    account_type: PropTypes.string,
    qr_code_url: PropTypes.string,
  }).isRequired,
  setDraft: PropTypes.func.isRequired,
  editingId: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  saveLoading: PropTypes.bool,
};

SecurityAccountFormModal.defaultProps = {
  title: null,
  editingId: null,
  saveLoading: false,
};

export default SecurityAccountFormModal;
