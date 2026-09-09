import PropTypes from 'prop-types';

import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

const LaundryWhatsAppSlipModal = ({
  isOpen,
  onClose,
  onSend,
  vendorName = '',
  jobNo = '',
  phone = '',
  loading = false,
}) => (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Send laundry slip on WhatsApp?"
    size="sm"
    layerClass="z-[60]"
    footer={
      <>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSend} loading={loading}>
          Send
        </Button>
      </>
    }
  >
    <p className="text-sm text-gray-700">
      Send the laundry slip PDF to{' '}
      <span className="font-medium">{vendorName || 'vendor'}</span>
      {phone ? (
        <>
          {' '}
          on WhatsApp (<span className="font-mono">{phone}</span>)?
        </>
      ) : (
        '?'
      )}
    </p>
    {jobNo ? (
      <p className="text-xs text-gray-500 mt-2">
        Job: <span className="font-mono font-medium text-gray-700">{jobNo}</span>
      </p>
    ) : null}
    <p className="text-xs text-gray-500 mt-2">
      Uses your shop WhatsApp connection and the &quot;Laundry slip to vendor&quot; message template.
    </p>
  </Modal>
);

LaundryWhatsAppSlipModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired,
  vendorName: PropTypes.string,
  jobNo: PropTypes.string,
  phone: PropTypes.string,
  loading: PropTypes.bool,
};

export default LaundryWhatsAppSlipModal;
