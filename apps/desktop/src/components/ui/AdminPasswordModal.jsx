import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';

import Button from './Button.jsx';
import Input from './Input.jsx';
import Modal from './Modal.jsx';

const AdminPasswordModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  itemLabel,
  orderLabel,
  shopName,
  errorMessage,
  onClearError,
  loading = false,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
}) => {
  const [password, setPassword] = useState('');
  const label = itemLabel || orderLabel;

  useEffect(() => {
    if (!isOpen) setPassword('');
  }, [isOpen]);

  const handleConfirm = () => {
    const trimmed = password.trim();
    if (!trimmed || loading) return;
    onConfirm(trimmed);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={handleConfirm}
            loading={loading}
            disabled={!password.trim()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-gray-700">
        {description ? <p>{description}</p> : null}
        {shopName ? (
          <p>
            Shop: <span className="font-medium text-gray-900">{shopName}</span>
          </p>
        ) : null}
        {label ? (
          <p>
            Item: <span className="font-medium text-gray-900">{label}</span>
          </p>
        ) : null}
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            handleConfirm();
          }}
        >
          <Input
            type="password"
            label="Shop Admin password"
            name="wrs_shop_admin_password"
            value={password}
            error={errorMessage || undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              onClearError?.();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirm();
            }}
            autoComplete="off"
            disabled={loading}
          />
        </form>
        <p className="text-xs text-gray-500">
          Enter the password of any Shop Admin linked to this shop.
        </p>
      </div>
    </Modal>
  );
};

AdminPasswordModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
  itemLabel: PropTypes.string,
  orderLabel: PropTypes.string,
  shopName: PropTypes.string,
  errorMessage: PropTypes.string,
  onClearError: PropTypes.func,
  loading: PropTypes.bool,
  confirmLabel: PropTypes.string,
  confirmVariant: PropTypes.oneOf(['primary', 'danger', 'secondary', 'ghost']),
};

export default AdminPasswordModal;
