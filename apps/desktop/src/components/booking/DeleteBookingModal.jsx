import PropTypes from 'prop-types';

import AdminDeleteModal from '../ui/AdminDeleteModal.jsx';

const DeleteBookingModal = ({
  isOpen,
  orderLabel,
  shopName,
  errorMessage,
  onClose,
  onConfirm,
  onClearError,
  loading = false,
}) => (
  <AdminDeleteModal
    isOpen={isOpen}
    onClose={onClose}
    onConfirm={onConfirm}
    title="Delete booking"
    description="This booking will be removed from the list."
    itemLabel={orderLabel}
    shopName={shopName}
    errorMessage={errorMessage}
    onClearError={onClearError}
    loading={loading}
    confirmLabel="Delete"
  />
);

DeleteBookingModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  orderLabel: PropTypes.string,
  shopName: PropTypes.string,
  errorMessage: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onClearError: PropTypes.func,
  loading: PropTypes.bool,
};

export default DeleteBookingModal;
