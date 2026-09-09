import PropTypes from 'prop-types';

import AdminPasswordModal from './AdminPasswordModal.jsx';

const AdminDeleteModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  itemLabel,
  shopName,
  errorMessage,
  onClearError,
  loading = false,
  confirmLabel = 'Delete',
}) => (
  <AdminPasswordModal
    isOpen={isOpen}
    onClose={onClose}
    onConfirm={onConfirm}
    title={title}
    description={description}
    itemLabel={itemLabel}
    shopName={shopName}
    errorMessage={errorMessage}
    onClearError={onClearError}
    loading={loading}
    confirmLabel={confirmLabel}
    confirmVariant="danger"
  />
);

AdminDeleteModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
  itemLabel: PropTypes.string,
  shopName: PropTypes.string,
  errorMessage: PropTypes.string,
  onClearError: PropTypes.func,
  loading: PropTypes.bool,
  confirmLabel: PropTypes.string,
};

export default AdminDeleteModal;
