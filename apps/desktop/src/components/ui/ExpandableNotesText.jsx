import PropTypes from 'prop-types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const POPOVER_WIDTH_PX = 320;

/**
 * Truncated notes with "Read more" that opens a scrollable popover (full text).
 */
const ExpandableNotesText = ({
  text,
  maxLength = 50,
  emptyLabel = '—',
  readMoreLabel = 'Read more',
  popoverTitle = 'Notes',
  className = '',
}) => {
  const raw = String(text ?? '').trim();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - POPOVER_WIDTH_PX - 8);
    let left = rect.left;
    left = Math.max(8, Math.min(left, maxLeft));
    let top = rect.bottom + 4;
    const maxTop = window.innerHeight - 16;
    if (top > maxTop - 120) {
      top = Math.max(8, rect.top - 4);
    }
    setPos({ top, left });
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
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!raw) {
    return <span className="text-gray-400">{emptyLabel}</span>;
  }

  const needsMore = raw.length > maxLength;
  const preview = needsMore ? `${raw.slice(0, maxLength)}…` : raw;

  const handleReadMore = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  };

  const popover =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[200] rounded-lg border border-gray-200 bg-white shadow-pop"
            style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH_PX }}
            role="dialog"
            aria-label={popoverTitle}
          >
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                {popoverTitle}
              </span>
              <button
                type="button"
                className="text-[11px] font-medium text-brand hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
              >
                Close
              </button>
            </div>
            <p className="max-h-48 overflow-y-auto px-3 py-2 text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
              {raw}
            </p>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`min-w-0 max-w-[14rem] ${className}`.trim()} ref={triggerRef}>
      <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">{preview}</p>
      {needsMore ? (
        <button
          type="button"
          className="mt-0.5 text-[10px] font-semibold text-brand hover:underline"
          onClick={handleReadMore}
          aria-expanded={open}
        >
          {readMoreLabel}
        </button>
      ) : null}
      {popover}
    </div>
  );
};

ExpandableNotesText.propTypes = {
  text: PropTypes.string,
  maxLength: PropTypes.number,
  emptyLabel: PropTypes.string,
  readMoreLabel: PropTypes.string,
  popoverTitle: PropTypes.string,
  className: PropTypes.string,
};

export default ExpandableNotesText;
