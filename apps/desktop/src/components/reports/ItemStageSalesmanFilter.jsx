import PropTypes from 'prop-types';
import { Users } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Button from '../ui/Button.jsx';

const MENU_WIDTH_PX = 260;

/**
 * Multi-select salesman filter (checkbox dropdown).
 */
const ItemStageSalesmanFilter = ({
  options,
  selectedIds,
  onChange,
  disabled = false,
  loading = false,
  menuAlign = 'start',
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const reposition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = menuAlign === 'start' ? rect.left : rect.right - MENU_WIDTH_PX;
    const maxLeft = Math.max(8, window.innerWidth - MENU_WIDTH_PX - 8);
    left = Math.max(8, Math.min(left, maxLeft));
    setPos({ top: rect.bottom + 4, left });
  }, [menuAlign]);

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
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggleId = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const label =
    selectedIds.length === 0
      ? 'Salesman'
      : selectedIds.length === 1
        ? options.find((o) => o.value === selectedIds[0])?.label || 'Salesman'
        : `Salesman (${selectedIds.length})`;

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] w-64 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-pop py-2"
            style={{ top: pos.top, left: pos.left }}
            role="listbox"
            aria-label="Filter by salesman"
          >
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Salesman
            </div>
            {loading ? (
              <p className="px-3 py-2 text-xs text-gray-500">Loading…</p>
            ) : options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-500">No salesmen found</p>
            ) : (
              options.map(({ value, label: optLabel }) => (
                <label
                  key={value}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 accent-brand"
                    checked={selectedSet.has(value)}
                    onChange={() => toggleId(value)}
                  />
                  <span className="truncate">{optLabel}</span>
                </label>
              ))
            )}
            <div className="border-t border-gray-100 mt-1 pt-1 px-2">
              <button
                type="button"
                className="text-xs text-brand hover:underline px-1 py-1 disabled:opacity-50"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                Clear salesman filter
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`relative shrink-0 ${className}`.trim()} ref={wrapRef}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={Users}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => {
            const next = !o;
            if (next) reposition();
            return next;
          });
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={selectedIds.length > 0 ? 'border-brand text-brand' : ''}
      >
        {label}
      </Button>
      {menu}
    </div>
  );
};

ItemStageSalesmanFilter.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })
  ).isRequired,
  selectedIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  loading: PropTypes.bool,
  menuAlign: PropTypes.oneOf(['start', 'end']),
  className: PropTypes.string,
};

export default ItemStageSalesmanFilter;
