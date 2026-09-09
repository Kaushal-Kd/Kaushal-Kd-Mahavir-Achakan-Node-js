import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';

import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import { ITEM_STAGE_EXPORT_LAYOUT } from '../../lib/itemStageListExport.js';

const ItemStageExportLayoutDialog = ({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
  action = 'download',
}) => {
  const [layout, setLayout] = useState(ITEM_STAGE_EXPORT_LAYOUT.COMBINED);
  const isPrint = action === 'print';

  useEffect(() => {
    if (isOpen) setLayout(ITEM_STAGE_EXPORT_LAYOUT.COMBINED);
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isPrint ? 'Print' : 'Export PDF'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(layout)} loading={loading}>
            {isPrint ? 'Print' : 'Download'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-700 mb-3">
        Choose how to arrange rows in the {isPrint ? 'printout' : 'export file'}.
      </p>
      <div className="space-y-2">
        <label aria-label="All in one file" className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50">
          <input
            type="radio"
            name="item-stage-export-layout"
            className="mt-0.5 accent-brand"
            checked={layout === ITEM_STAGE_EXPORT_LAYOUT.COMBINED}
            onChange={() => setLayout(ITEM_STAGE_EXPORT_LAYOUT.COMBINED)}
          />
          <span className="text-sm text-gray-800">
            <span className="font-medium block">All in one file</span>
            <span className="text-gray-500 text-xs">Single table with every product line</span>
          </span>
        </label>
        <label aria-label="Salesman-wise" className="flex items-start gap-2 rounded-md border border-gray-200 px-3 py-2 cursor-pointer hover:bg-gray-50">
          <input
            type="radio"
            name="item-stage-export-layout"
            className="mt-0.5 accent-brand"
            checked={layout === ITEM_STAGE_EXPORT_LAYOUT.SALESMAN_WISE}
            onChange={() => setLayout(ITEM_STAGE_EXPORT_LAYOUT.SALESMAN_WISE)}
          />
          <span className="text-sm text-gray-800">
            <span className="font-medium block">Salesman-wise</span>
            <span className="text-gray-500 text-xs">
              Separate section per salesman in the same {isPrint ? 'document' : 'PDF'}
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
};

ItemStageExportLayoutDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  action: PropTypes.oneOf(['download', 'print']),
};

export default ItemStageExportLayoutDialog;
