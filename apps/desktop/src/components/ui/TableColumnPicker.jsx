import clsx from 'clsx';
import PropTypes from 'prop-types';
import { Columns3, GripVertical } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Button from './Button.jsx';

const MENU_WIDTH_PX = 260;

/**
 * Dropdown to show/hide and reorder table columns (middle columns only).
 * Menu renders in a portal so it stays above sticky table headers.
 */
const TableColumnPicker = ({
  options,
  hiddenKeys,
  columnOrder,
  onToggle,
  onReorder,
  onReset,
  menuAlign = 'end',
  iconOnly = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [dragKey, setDragKey] = useState('');
  const [dropKey, setDropKey] = useState('');
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  const orderedOptions = useMemo(() => {
    const list = options || [];
    const order = columnOrder || [];
    if (!order.length) return list;
    const byKey = new Map(list.map((o) => [o.key, o]));
    const seen = new Set();
    const out = [];
    for (const key of order) {
      if (byKey.has(key) && !seen.has(key)) {
        seen.add(key);
        out.push(byKey.get(key));
      }
    }
    for (const o of list) {
      if (!seen.has(o.key)) out.push(o);
    }
    return out;
  }, [options, columnOrder]);

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

  const handleDragStart = (key) => (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    setDragKey(key);
  };

  const handleDragEnd = () => {
    setDragKey('');
    setDropKey('');
  };

  const handleDrop = (key) => (e) => {
    e.preventDefault();
    const from = e.dataTransfer.getData('text/plain') || dragKey;
    if (from && from !== key && onReorder) onReorder(from, key);
    setDragKey('');
    setDropKey('');
  };

  const menu =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] w-[260px] max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-pop py-2"
            style={{ top: pos.top, left: pos.left }}
            role="listbox"
            aria-label="Choose visible columns"
          >
            <div className="px-3 pb-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Columns
              </div>
              {onReorder ? (
                <p className="text-[10px] text-gray-500 mt-0.5">Drag to reorder · check to show</p>
              ) : null}
            </div>
            {orderedOptions.map(({ key, label }) => {
              const visible = !hiddenKeys.includes(key);
              const isDragging = dragKey === key;
              const isDropTarget = dropKey === key && dragKey && dragKey !== key;
              return (
                <div
                  key={key}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 text-sm text-gray-800',
                    isDropTarget && 'bg-brand-light ring-1 ring-brand/40',
                    isDragging && 'opacity-50'
                  )}
                  onDragOver={(e) => {
                    if (!onReorder) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropKey(key);
                  }}
                  onDragLeave={() => {
                    if (dropKey === key) setDropKey('');
                  }}
                  onDrop={onReorder ? handleDrop(key) : undefined}
                >
                  {onReorder ? (
                    <button
                      type="button"
                      draggable
                      onDragStart={handleDragStart(key)}
                      onDragEnd={handleDragEnd}
                      className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:bg-gray-50 cursor-grab active:cursor-grabbing"
                      aria-label={`Drag to reorder ${label}`}
                      onClick={(e) => e.preventDefault()}
                    >
                      <GripVertical size={14} aria-hidden />
                    </button>
                  ) : null}
                  <label className="flex flex-1 min-w-0 items-center gap-2 py-0.5 hover:bg-gray-50 cursor-pointer rounded px-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-brand focus:ring-brand shrink-0"
                      checked={visible}
                      onChange={() => onToggle(key)}
                    />
                    <span className="truncate">{label}</span>
                  </label>
                </div>
              );
            })}
            <div className="border-t border-gray-100 mt-1 pt-1 px-2">
              <button
                type="button"
                className="text-xs text-brand hover:underline px-1 py-1"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
              >
                Reset to default columns
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
        icon={Columns3}
        iconOnly={iconOnly}
        title="Columns"
        aria-label="Choose visible columns"
        onClick={() => {
          setOpen((o) => {
            const next = !o;
            if (next) reposition();
            return next;
          });
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {iconOnly ? null : 'Columns'}
      </Button>
      {menu}
    </div>
  );
};

TableColumnPicker.propTypes = {
  options: PropTypes.arrayOf(
    PropTypes.shape({ key: PropTypes.string.isRequired, label: PropTypes.string.isRequired })
  ).isRequired,
  hiddenKeys: PropTypes.arrayOf(PropTypes.string).isRequired,
  columnOrder: PropTypes.arrayOf(PropTypes.string),
  onToggle: PropTypes.func.isRequired,
  onReorder: PropTypes.func,
  onReset: PropTypes.func.isRequired,
  menuAlign: PropTypes.oneOf(['start', 'end']),
  iconOnly: PropTypes.bool,
  className: PropTypes.string,
};

export default TableColumnPicker;
