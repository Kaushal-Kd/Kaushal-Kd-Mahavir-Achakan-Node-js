import { todayIndiaISODate } from '@wrs/shared';
import clsx from 'clsx';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  applyDateRangeClick,
  formatDateRangeDisplay,
  isIsoDate,
  isIsoInInclusiveRange,
  normalizeDateRange,
} from '../../lib/dateRangePicker.js';

function DateRangePicker({
  id = undefined,
  label = undefined,
  className = '',
  inputClassName = '',
  required = false,
  disabled = false,
  from = '',
  to = '',
  onChange = undefined,
  placeholder = 'DD-MM-YYYY',
  panelAlign = 'end',
}) {
  const controlId = id || `date-range-${Math.random().toString(36).slice(2, 8)}`;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const [hoverIso, setHoverIso] = useState('');
  const [draft, setDraft] = useState(() => ({
    ...normalizeDateRange(from, to),
    picking: false,
  }));
  const [viewMonth, setViewMonth] = useState(() => getBaseDate(from || to) || new Date());

  const committed = normalizeDateRange(from, to);
  const displayValue = formatDateRangeDisplay(committed.from, committed.to);

  const syncPanelPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 320;
    let left = panelAlign === 'end' ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPanelPos({
      top: rect.bottom + 4,
      left,
      width,
    });
  }, [panelAlign]);

  useEffect(() => {
    if (!open) return;
    setDraft({ ...normalizeDateRange(from, to), picking: false });
    setHoverIso('');
    setViewMonth(getBaseDate(from || to) || new Date());
  }, [from, to, open]);

  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return undefined;
    }
    syncPanelPos();
    const onReposition = () => syncPanelPos();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, syncPanelPos]);

  const commitRange = useCallback(
    (nextFrom, nextTo) => {
      const range = normalizeDateRange(nextFrom, nextTo);
      if (!range.from) return;
      onChange?.(range);
    },
    [onChange]
  );

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      if (draft.picking && isIsoDate(draft.from)) {
        commitRange(draft.from, draft.from);
      }
      setOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('click', handleClickOutside, true);
    }, 0);
    document.addEventListener('keydown', handleEscape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [commitRange, draft.from, draft.picking, open]);

  const monthLabel = useMemo(
    () => viewMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [viewMonth]
  );
  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const previewTo = draft.picking && hoverIso ? hoverIso : draft.to;
  const preview = normalizeDateRange(draft.from, previewTo || draft.from);

  const selectDay = (day) => {
    if (!day || disabled) return;
    const next = applyDateRangeClick(draft, toISO(day));
    setDraft(next);
    setHoverIso('');
    if (!next.picking) {
      commitRange(next.from, next.to);
      setOpen(false);
    }
  };

  const jumpToday = () => {
    const today = todayIndiaISODate();
    setDraft({ from: today, to: today, picking: false });
    setViewMonth(getBaseDate(today) || new Date());
    commitRange(today, today);
    setOpen(false);
  };

  const panel =
    open && panelPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={`${controlId}-calendar`}
            role="dialog"
            aria-label="Select date range"
            className="fixed z-[9999] rounded-md border border-gray-200 bg-white p-3 shadow-lg"
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          >
            <p className="mb-2 text-[11px] text-gray-500">
              {draft.picking ? 'Select the end date' : 'Select the start date, then the end date'}
            </p>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-900">{monthLabel}</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-gray-600 hover:bg-gray-100"
                  onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                  aria-label="Previous month"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-gray-600 hover:bg-gray-100"
                  onClick={() => setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                  aria-label="Next month"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-1 text-[11px] font-semibold text-gray-500">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <div key={day} className="flex h-6 items-center justify-center">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day, idx) => {
                const iso = day ? toISO(day) : '';
                const inRange = iso && isIsoInInclusiveRange(iso, preview.from, preview.to);
                const isStart = iso && iso === preview.from;
                const isEnd = iso && iso === preview.to;
                const isEdge = isStart || isEnd;
                return (
                  <button
                    key={`${iso || 'empty'}-${idx}`}
                    type="button"
                    disabled={!day}
                    onMouseEnter={() => {
                      if (day && draft.picking) setHoverIso(iso);
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (day) selectDay(day);
                    }}
                    className={clsx(
                      'h-9 text-sm transition-colors',
                      !day && 'pointer-events-none',
                      preview.from !== preview.to && isStart && 'rounded-l-md',
                      preview.from !== preview.to && isEnd && 'rounded-r-md',
                      (preview.from === preview.to || !inRange) && 'rounded-md',
                      isEdge && 'bg-brand text-white font-semibold',
                      inRange && !isEdge && 'bg-brand-light text-gray-900',
                      !inRange && day && 'text-gray-800 hover:bg-gray-100'
                    )}
                  >
                    {day ? day.getDate() : ''}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-end border-t border-gray-100 pt-2">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={jumpToday}
                className="text-sm text-brand hover:underline"
              >
                Today
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={clsx('w-full min-w-0', className)}>
      {label ? (
        <label htmlFor={controlId} className="label">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      ) : null}
      <div ref={triggerRef} className="relative">
        <input
          id={controlId}
          type="text"
          role="combobox"
          inputMode="none"
          readOnly
          disabled={disabled}
          value={displayValue}
          onClick={() => !disabled && setOpen(true)}
          onFocus={() => !disabled && setOpen(true)}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === ' ') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          placeholder={placeholder}
          className={clsx('input cursor-pointer pr-9', inputClassName)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${controlId}-calendar` : undefined}
          aria-label={label || 'Date range'}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-brand disabled:opacity-40"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => !disabled && setOpen((prev) => !prev)}
          disabled={disabled}
          aria-label="Open calendar"
        >
          <Calendar size={16} />
        </button>
      </div>
      {panel}
    </div>
  );
}

DateRangePicker.propTypes = {
  id: PropTypes.string,
  label: PropTypes.string,
  className: PropTypes.string,
  inputClassName: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  from: PropTypes.string,
  to: PropTypes.string,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  panelAlign: PropTypes.oneOf(['start', 'end']),
};

DateRangePicker.defaultProps = {
  id: undefined,
  label: undefined,
  className: '',
  inputClassName: '',
  required: false,
  disabled: false,
  from: '',
  to: '',
  onChange: undefined,
  placeholder: 'DD-MM-YYYY',
  panelAlign: 'end',
};

export default DateRangePicker;

function parseISODate(iso) {
  const str = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return startOfDay(new Date(y, m - 1, d));
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getBaseDate(iso) {
  return parseISODate(iso);
}

function buildMonthGrid(base) {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  const cells = [];
  for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
  for (let day = 1; day <= last.getDate(); day += 1) {
    cells.push(startOfDay(new Date(base.getFullYear(), base.getMonth(), day)));
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}
