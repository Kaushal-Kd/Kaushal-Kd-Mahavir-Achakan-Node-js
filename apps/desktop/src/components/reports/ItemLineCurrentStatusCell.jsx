import { ITEM_LINE_STATUS, ITEM_LINE_STATUS_LABELS } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Badge from '../ui/Badge.jsx';

const STATUS_TONE = {
  [ITEM_LINE_STATUS.AVAILABLE]: 'green',
  [ITEM_LINE_STATUS.NOT_AVAILABLE]: 'red',
  [ITEM_LINE_STATUS.WASHING]: 'yellow',
  [ITEM_LINE_STATUS.WASHING_QUEUE]: 'yellow',
  [ITEM_LINE_STATUS.IN_WASHING]: 'brand',
  [ITEM_LINE_STATUS.WITH_CUSTOMER]: 'brand',
  [ITEM_LINE_STATUS.COLLECTED_ELSEWHERE]: 'red',
  [ITEM_LINE_STATUS.PREPARED_ELSEWHERE]: 'yellow',
  [ITEM_LINE_STATUS.BOOKED_ELSEWHERE]: 'yellow',
};

const ItemLineCurrentStatusCell = ({ row }) => {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const rawStatus = String(row?.item_status ?? '').trim();
  const isLoading = !rawStatus;
  const status = rawStatus || ITEM_LINE_STATUS.AVAILABLE;
  const label = isLoading
    ? 'Checking…'
    : row?.item_status_label || ITEM_LINE_STATUS_LABELS[status] || status;
  const reasons = Array.isArray(row?.item_status_reasons)
    ? row.item_status_reasons.filter(Boolean)
    : [];
  const tone = isLoading ? 'gray' : STATUS_TONE[status] || 'gray';
  const hasDetail = !isLoading && reasons.length > 0;

  const reposition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  const panel =
    open && hasDetail && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed z-[200] w-72 max-w-[min(18rem,calc(100vw-1rem))] rounded border border-gray-200 bg-white p-2 shadow-sm"
            style={{ top: pos.top, left: pos.left }}
            role="tooltip"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          >
            <p className="mb-1 text-[10px] font-medium text-gray-800">Item status</p>
            <ul className="space-y-1">
              {reasons.map((line) => (
                <li key={line} className="text-[10px] leading-snug text-gray-700">
                  {line}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <span
      ref={anchorRef}
      className="inline-flex min-w-0"
      onMouseEnter={() => {
        if (!hasDetail) return;
        reposition();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => {
        if (!hasDetail) return;
        reposition();
        setOpen(true);
      }}
      onBlur={() => setOpen(false)}
    >
      <Badge tone={tone} className="whitespace-nowrap shrink-0 cursor-default">
        {label}
      </Badge>
      {panel}
    </span>
  );
};

ItemLineCurrentStatusCell.propTypes = {
  row: PropTypes.object,
};

export default ItemLineCurrentStatusCell;
