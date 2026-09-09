import { Eye } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useState } from 'react';

import { useBookingAuditLogs } from '../../hooks/useBookingAuditLogs.js';
import { splitBillAndProductChanges } from '../../lib/bookingAuditSummary.js';
import { systemLogsApi } from '../../lib/api/systemLogs.js';
import { formatChangesWhenLabel } from '../../lib/systemLogExport.js';
import BookingAuditChangesPanel from './BookingAuditChangesPanel.jsx';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';

const BookingLastEditCell = ({ orderId, onOpenFullLogs }) => {
  const { summary, isLoading } = useBookingAuditLogs(orderId, { enabled: Boolean(orderId) });
  const [changesModal, setChangesModal] = useState({
    open: false,
    title: '',
    billChanges: [],
    productChanges: [],
    loading: false,
  });

  const { editCount, lastEditLog, lastBillChanges, lastProductChanges, lastEditWhen } = summary;
  const hasBill = lastBillChanges.length > 0;
  const hasProduct = lastProductChanges.length > 0;

  const closeChangesModal = () =>
    setChangesModal({
      open: false,
      title: '',
      billChanges: [],
      productChanges: [],
      loading: false,
    });

  const openChanges = useCallback(
    async (kind) => {
      if (!lastEditLog?.id) return;
      const isBill = kind === 'bill';
      const when = formatChangesWhenLabel(lastEditWhen);
      const title = isBill ? `Bill changes — ${when}` : `Product changes — ${when}`;
      const fromList = splitBillAndProductChanges(lastEditLog);
      const billChanges = isBill ? fromList.billChanges : [];
      const productChanges = isBill ? [] : fromList.productChanges;
      const hasChanges = isBill ? billChanges.length > 0 : productChanges.length > 0;

      setChangesModal({
        open: true,
        title,
        billChanges,
        productChanges,
        loading: !hasChanges,
      });

      if (hasChanges) return;

      setChangesModal((prev) => ({ ...prev, loading: true }));
      try {
        const res = await systemLogsApi.get(lastEditLog.id);
        const split = splitBillAndProductChanges(res?.data);
        setChangesModal({
          open: true,
          title,
          billChanges: isBill ? split.billChanges : [],
          productChanges: isBill ? [] : split.productChanges,
          loading: false,
        });
      } catch {
        setChangesModal((prev) => ({ ...prev, loading: false }));
      }
    },
    [lastEditLog, lastEditWhen]
  );

  if (!orderId) return <span className="text-gray-400">—</span>;

  if (isLoading) {
    return <span className="text-[10px] text-gray-500">Loading…</span>;
  }

  if (editCount === 0) {
    return <span className="text-gray-400">—</span>;
  }

  const metaParts = [
    summary.lastEditBy,
    formatChangesWhenLabel(lastEditWhen),
    summary.lastActionType,
  ].filter(Boolean);
  const metaLine = metaParts.join(' · ');

  return (
    <>
      <div
        className="text-[10px] leading-snug max-w-[18rem] space-y-0.5"
        data-stop-row-click
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <p className="text-gray-800 truncate" title={metaLine}>
          {metaLine}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {hasBill ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Eye}
              className="h-6 px-1.5 text-[10px] text-brand"
              onClick={(e) => {
                e.stopPropagation();
                void openChanges('bill');
              }}
            >
              Bill
            </Button>
          ) : null}
          {hasProduct ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Eye}
              className="h-6 px-1.5 text-[10px] text-brand"
              onClick={(e) => {
                e.stopPropagation();
                void openChanges('product');
              }}
            >
              Product
            </Button>
          ) : null}
          {typeof onOpenFullLogs === 'function' ? (
            <button
              type="button"
              className="text-[10px] text-brand hover:underline px-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFullLogs();
              }}
            >
              All logs ({editCount})
            </button>
          ) : null}
        </div>
      </div>

      <Modal
        isOpen={changesModal.open}
        onClose={closeChangesModal}
        size="2xl"
        title={changesModal.title || 'Changes'}
      >
        {changesModal.loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <BookingAuditChangesPanel
            billChanges={changesModal.billChanges}
            productChanges={changesModal.productChanges}
            dense
          />
        )}
      </Modal>
    </>
  );
};

BookingLastEditCell.propTypes = {
  orderId: PropTypes.string,
  onOpenFullLogs: PropTypes.func,
};

BookingLastEditCell.defaultProps = {
  orderId: null,
  onOpenFullLogs: undefined,
};

export default BookingLastEditCell;
