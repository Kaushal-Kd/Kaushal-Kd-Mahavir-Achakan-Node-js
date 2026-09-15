import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import { getBookingProductTokenOptions } from '../../lib/bookingTokenPrint.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

const ProductTokenSelectionModal = ({ isOpen, order, onClose, onConfirm, loading = false }) => {
  const options = useMemo(
    () => (order ? getBookingProductTokenOptions(order) : []),
    [order]
  );
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    if (isOpen) setSelected([]);
  }, [isOpen, order?.id]);

  const toggle = (id) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Select product tokens"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(selected)}
            disabled={selected.length === 0}
            loading={loading}
          >
            Print selected ({selected.length})
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-600">Choose the products that need individual slips.</p>
      <div className="max-h-[55vh] overflow-y-auto rounded-md border border-gray-200 divide-y divide-gray-100">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-gray-50"
          >
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => toggle(option.id)}
              className="h-4 w-4 rounded border-gray-300 accent-brand"
            />
            <span className="min-w-0 break-words">{option.label}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
};

ProductTokenSelectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  order: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

export default ProductTokenSelectionModal;
