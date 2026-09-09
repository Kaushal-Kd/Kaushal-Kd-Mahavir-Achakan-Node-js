import { useQuery } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import { laundryApi } from '../../lib/api/laundry.js';
import Modal from '../ui/Modal.jsx';
import VendorOutstandingSummary from './VendorOutstandingSummary.jsx';

const VendorOutstandingModal = ({ jobId, jobNo, vendorName, onClose }) => {
  const {
    data: jobResp,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['laundry-job', jobId, 'vendor-outstanding'],
    queryFn: () => laundryApi.get(jobId),
    enabled: Boolean(jobId),
  });

  const job = jobResp?.data;

  return (
    <Modal
      isOpen={Boolean(jobId)}
      onClose={onClose}
      title="Vendor outstanding"
      size="lg"
      closeOnBackdrop={false}
    >
      <p className="mb-3 text-[11px] text-gray-500">
        {jobNo ? `${jobNo} · ` : ''}
        {vendorName || job?.vendorName || 'Vendor'}
      </p>
      {isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}
      {isError ? (
        <p className="text-xs text-red-600">Failed to load vendor outstanding.</p>
      ) : null}
      {!isLoading && job?.vendorOutstanding ? (
        <VendorOutstandingSummary
          vendorOutstanding={job.vendorOutstanding}
          currentBillAmount={job.payable}
          currentBillId={job.id}
          compact
        />
      ) : null}
      {!isLoading && job && !job.vendorOutstanding ? (
        <p className="text-xs text-gray-600">
          No vendor outstanding summary for this bill. It is shown only on the latest bill for a
          vendor with unpaid balance.
        </p>
      ) : null}
    </Modal>
  );
};

VendorOutstandingModal.propTypes = {
  jobId: PropTypes.string.isRequired,
  jobNo: PropTypes.string,
  vendorName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

export default VendorOutstandingModal;
