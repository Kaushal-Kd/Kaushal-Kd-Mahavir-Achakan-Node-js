import { buildCustomOrderTrialLogEntries, formatDate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useMemo } from 'react';

import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';

const KIND_LABEL = {
  trial: 'Trial',
  retrial: 'Re-trial',
};

const CustomOrderTrialLogsModal = ({ order, isOpen, onClose }) => {
  const entries = useMemo(() => buildCustomOrderTrialLogEntries(order), [order]);

  if (!order) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Trial & re-trial log"
      size="md"
      footer={
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <p className="text-xs text-gray-500 mb-3">
        Order <span className="font-mono font-medium text-gray-800">{order.order_number}</span>
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No trial or re-trial dates recorded.</p>
      ) : (
        <ul className="space-y-2 max-h-[min(24rem,60vh)] overflow-y-auto">
          {entries.map((entry, index) => (
            <li
              key={`${entry.kind}-${entry.date}-${index}`}
              className="rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-semibold text-gray-900 tabular-nums">#{index + 1}</span>
                <span className="font-medium text-brand">{KIND_LABEL[entry.kind] || entry.kind}</span>
                <span className="text-gray-700 tabular-nums">{formatDate(entry.date)}</span>
              </div>
              {entry.kind === 'retrial' ? (
                entry.notes ? (
                  <p className="mt-1.5 text-gray-600 leading-snug whitespace-pre-wrap break-words">
                    {entry.notes}
                  </p>
                ) : (
                  <p className="mt-1 text-gray-400 italic">No notes</p>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

CustomOrderTrialLogsModal.propTypes = {
  order: PropTypes.shape({
    order_number: PropTypes.string,
    trial_date: PropTypes.string,
    retrials: PropTypes.arrayOf(
      PropTypes.shape({
        date: PropTypes.string,
        notes: PropTypes.string,
      })
    ),
  }),
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
};

export default CustomOrderTrialLogsModal;
