import { formatDate, normalizeCustomOrderRetrials } from '@wrs/shared';
import { Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const PANEL_WIDTH_PX = 288;

/**
 * Re-trials column: count + info icon; click opens date/notes for each entry.
 */
export default function CustomOrderRetrialsCell({ retrials, orderNumber = '' }) {
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const rows = useMemo(() => {
    const normalized = normalizeCustomOrderRetrials(retrials);
    return [...normalized].sort((a, b) => b.date.localeCompare(a.date));
  }, [retrials]);

  const reposition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = PANEL_WIDTH_PX;
    let left = rect.left;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    left = Math.max(8, Math.min(left, maxLeft));
    setPos({ top: rect.bottom + 4, left });
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

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!rows.length) {
    return <span className="text-gray-400">—</span>;
  }

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[200] rounded-lg border border-gray-200 bg-white p-2 shadow-pop"
            style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH_PX }}
            role="dialog"
            aria-label={
              orderNumber ? `Re-trials for order ${orderNumber}` : 'Re-trial details'
            }
          >
            <p className="mb-1.5 text-[11px] font-semibold text-gray-800">
              Re-trials ({rows.length})
            </p>
            <ul className="max-h-56 overflow-y-auto space-y-2">
              {rows.map((row, index) => {
                const seq = rows.length - index;
                return (
                  <li
                    key={`${row.date}-${index}`}
                    className="rounded border border-gray-100 bg-gray-50/80 px-2 py-1.5 text-[11px]"
                  >
                    <div className="font-medium text-gray-900 tabular-nums">
                      #{seq} · {formatDate(row.date)}
                    </div>
                    {row.notes ? (
                      <p className="mt-1 text-gray-600 leading-snug whitespace-pre-wrap break-words">
                        {row.notes}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-gray-400 italic">No notes</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <span
      className="inline-flex items-center justify-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <span className="tabular-nums font-medium text-gray-800">{rows.length}</span>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-brand hover:bg-brand-light"
        title="View re-trial details"
        aria-label={`View ${rows.length} re-trial${rows.length === 1 ? '' : 's'} details`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          reposition();
          setOpen((v) => !v);
        }}
      >
        <Info size={14} aria-hidden />
      </button>
      {panel}
    </span>
  );
}

CustomOrderRetrialsCell.propTypes = {
  retrials: PropTypes.arrayOf(
    PropTypes.shape({
      date: PropTypes.string,
      notes: PropTypes.string,
    })
  ),
  orderNumber: PropTypes.string,
};
