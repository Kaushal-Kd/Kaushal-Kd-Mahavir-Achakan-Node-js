import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

import AuditChangeRowsTable from '../audit/AuditChangeRowsTable.jsx';
import { flattenLogToChangeRows } from '../../lib/bookingAuditSummary.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

const SystemLogChangesModal = ({
  isOpen,
  onClose,
  title,
  log,
  loading,
  emptyMessage = 'No changes recorded for this snapshot.',
}) => {
  const [showRaw, setShowRaw] = useState(false);
  const flatRows = useMemo(() => flattenLogToChangeRows(log), [log]);
  const rawBill = log?.bill_data;
  const rawProduct = log?.product_data;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="3xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Hide raw JSON' : 'View raw JSON'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading changes…</p>
      ) : showRaw ? (
        <pre className="text-xs overflow-auto max-h-[70vh] whitespace-pre-wrap break-words font-mono text-gray-800 bg-gray-50 rounded-md p-3 border border-gray-200">
          {JSON.stringify({ bill_data: rawBill, product_data: rawProduct }, null, 2)}
        </pre>
      ) : (
        <AuditChangeRowsTable
          rows={flatRows}
          columnPickerId="system-log-changes-modal"
          emptyTitle="No changes"
          emptyMessage={emptyMessage}
          scrollClassName="max-h-[min(72vh,680px)]"
          totalCount={flatRows.length}
        />
      )}
    </Modal>
  );
};

SystemLogChangesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  log: PropTypes.object,
  loading: PropTypes.bool,
  emptyMessage: PropTypes.string,
};

export default SystemLogChangesModal;
