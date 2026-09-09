import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';

import { useBookingAuditLogs } from '../../hooks/useBookingAuditLogs.js';
import { splitBillAndProductChanges } from '../../lib/bookingAuditSummary.js';
import { systemLogsApi } from '../../lib/api/systemLogs.js';
import { formatChangesWhenLabel } from '../../lib/systemLogExport.js';
import BookingAuditChangesPanel from './BookingAuditChangesPanel.jsx';

function editCountLabel(count) {
  if (count === 1) return 'Edited 1 time';
  return `Edited ${count} times`;
}

const BookingAuditBadge = ({
  orderId,
  enabled = false,
  compact = false,
  disablePopover = false,
  onOpenFullLogs,
}) => {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [detailBill, setDetailBill] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchEnabled = enabled || (!disablePopover && hoverOpen);
  const { summary, isLoading } = useBookingAuditLogs(orderId, { enabled: fetchEnabled && !!orderId });

  const { editCount, lastEditLog, lastBillChanges, lastProductChanges, lastEditWhen } = summary;

  const billChanges = detailBill ?? lastBillChanges;
  const productChanges = detailProduct ?? lastProductChanges;

  const loadDetailIfNeeded = useCallback(async () => {
    if (!lastEditLog?.id) return;
    const fromList = splitBillAndProductChanges(lastEditLog);
    if (fromList.billChanges.length > 0 || fromList.productChanges.length > 0) {
      setDetailBill(fromList.billChanges);
      setDetailProduct(fromList.productChanges);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await systemLogsApi.get(lastEditLog.id);
      const data = res?.data;
      const split = splitBillAndProductChanges(data);
      setDetailBill(split.billChanges);
      setDetailProduct(split.productChanges);
    } catch {
      setDetailBill([]);
      setDetailProduct([]);
    } finally {
      setDetailLoading(false);
    }
  }, [lastEditLog]);

  useEffect(() => {
    if (!hoverOpen || !lastEditLog) return;
    loadDetailIfNeeded();
  }, [hoverOpen, lastEditLog, loadDetailIfNeeded]);

  useEffect(() => {
    if (!hoverOpen) {
      setDetailBill(null);
      setDetailProduct(null);
      setDetailLoading(false);
    }
  }, [hoverOpen]);

  if (!orderId) return null;
  if (!fetchEnabled && editCount === 0) return null;
  if (fetchEnabled && !isLoading && editCount === 0) return null;

  const label = isLoading && fetchEnabled ? 'Edited …' : editCountLabel(editCount);

  return (
    <span
      className="relative inline-flex align-middle shrink-0"
      onMouseEnter={() => {
        if (!disablePopover) setHoverOpen(true);
      }}
      onMouseLeave={() => {
        if (!disablePopover) setHoverOpen(false);
      }}
      onFocus={() => {
        if (!disablePopover) setHoverOpen(true);
      }}
      onBlur={() => {
        if (!disablePopover) setHoverOpen(false);
      }}
    >
      <button
        type="button"
        className={
          compact
            ? 'inline-flex items-center gap-0.5 rounded p-0.5 text-gray-500 hover:text-brand hover:bg-brand-light/40 leading-none'
            : 'inline-flex items-center rounded border border-gray-200 bg-gray-50 text-gray-700 hover:border-brand hover:bg-brand-light/30 cursor-default text-xs px-1.5 py-0.5'
        }
        tabIndex={0}
        aria-label={label}
        title={label}
        onClick={(e) => {
          if (!compact || !disablePopover) return;
          e.stopPropagation();
          if (typeof onOpenFullLogs === 'function') onOpenFullLogs();
        }}
      >
        {compact ? (
          <>
            <Pencil size={11} aria-hidden className="shrink-0" />
            <span className="text-[10px] font-semibold tabular-nums min-w-[0.65rem] text-center">
              {isLoading && fetchEnabled ? '…' : editCount > 0 ? editCount : ''}
            </span>
          </>
        ) : (
          label
        )}
      </button>

      {!disablePopover && hoverOpen && editCount > 0 ? (
        <div
          className={
            compact
              ? 'absolute z-50 left-0 top-full mt-0.5 w-[min(96vw,40rem)] rounded border border-gray-200 bg-white shadow-lg text-left'
              : 'absolute z-50 left-0 mt-1 w-[min(92vw,28rem)] rounded-md border border-gray-200 bg-white shadow-lg text-left'
          }
          role="tooltip"
        >
          <div
            className={
              compact
                ? 'border-b border-gray-100 px-2 py-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-[10px] leading-tight'
                : 'border-b border-gray-100 px-2.5 py-2'
            }
          >
            {compact ? (
              <>
                <span className="font-semibold text-gray-900 shrink-0">Last edit</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-600 min-w-0 truncate">
                  {[summary.lastEditBy, formatChangesWhenLabel(lastEditWhen), summary.lastActionType]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold text-gray-900">Last edit</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  {summary.lastEditBy ? `${summary.lastEditBy} · ` : ''}
                  {formatChangesWhenLabel(lastEditWhen)}
                  {summary.lastActionType ? ` · ${summary.lastActionType}` : ''}
                </p>
              </>
            )}
          </div>

          {detailLoading ? (
            <p className={compact ? 'text-[10px] text-gray-500 px-2 py-1.5' : 'text-xs text-gray-500 px-2.5 py-3'}>
              Loading…
            </p>
          ) : (
            <div className={compact ? 'max-h-56 overflow-auto' : 'max-h-52 overflow-auto'}>
              <BookingAuditChangesPanel
                billChanges={billChanges}
                productChanges={productChanges}
                dense={compact}
                limitPerSection={compact ? 6 : 8}
              />
            </div>
          )}

          {typeof onOpenFullLogs === 'function' ? (
            <div
              className={
                compact
                  ? 'border-t border-gray-100 px-2 py-0.5 flex justify-end'
                  : 'border-t border-gray-100 px-2.5 py-1.5'
              }
            >
              <button
                type="button"
                className={compact ? 'text-[10px] text-brand hover:underline py-0.5' : 'text-[11px] text-brand hover:underline'}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenFullLogs();
                }}
              >
                All logs
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
};

BookingAuditBadge.propTypes = {
  orderId: PropTypes.string,
  enabled: PropTypes.bool,
  compact: PropTypes.bool,
  disablePopover: PropTypes.bool,
  onOpenFullLogs: PropTypes.func,
};

BookingAuditBadge.defaultProps = {
  orderId: null,
  enabled: false,
  compact: false,
  disablePopover: false,
  onOpenFullLogs: undefined,
};

export default BookingAuditBadge;
