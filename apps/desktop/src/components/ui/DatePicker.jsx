import { formatIsoDateDisplay } from '@wrs/shared';
import clsx from 'clsx';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function DatePicker({
  id = undefined,
  label = undefined,
  hint = undefined,
  error = undefined,
  className = '',
  inputClassName = '',
  required = false,
  disabled = false,
  value = '',
  onChange = undefined,
  onBlur = undefined,
  placeholder = '',
  min = undefined,
  max = undefined,
  inputRef = undefined,
  panelAlign = 'start',
}) {
  const controlId = id || `date-${Math.random().toString(36).slice(2, 8)}`;
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => getBaseDate(value) || new Date());

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
    setViewMonth(getBaseDate(value) || new Date());
  }, [value, open]);

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

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
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
  }, [open]);

  const minDate = useMemo(() => parseISODate(min), [min]);
  const maxDate = useMemo(() => parseISODate(max), [max]);
  const panelId = `${controlId}-calendar`;
  const monthLabel = useMemo(
    () => viewMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [viewMonth]
  );
  const days = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const isDisabledDay = (day) => {
    if (!day) return true;
    if (minDate && day < minDate) return true;
    if (maxDate && day > maxDate) return true;
    return false;
  };

  const selectDate = (day) => {
    if (!day || isDisabledDay(day) || disabled) return;
    const next = toISO(day);
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
    setOpen(false);
  };

  const clearDate = () => {
    if (required || disabled) return;
    onChange?.({ target: { value: '' }, currentTarget: { value: '' } });
    setOpen(false);
  };

  const jumpToday = () => {
    const today = startOfDay(new Date());
    setViewMonth(today);
    if (!isDisabledDay(today)) {
      selectDate(today);
    }
  };

  const panel =
    open && panelPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Calendar"
            className="fixed z-[9999] rounded-md border border-gray-200 bg-white p-3 shadow-lg"
            style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
          >
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
                const selected = !!day && iso === value;
                const disabledDay = isDisabledDay(day);
                return (
                  <button
                    key={`${iso || 'empty'}-${idx}`}
                    type="button"
                    disabled={!day || disabledDay}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (day && !disabledDay) selectDate(day);
                    }}
                    className={clsx(
                      'h-9 rounded text-sm transition-colors',
                      !day && 'pointer-events-none',
                      selected
                        ? 'bg-brand text-white font-semibold'
                        : disabledDay
                          ? 'text-gray-300'
                          : 'text-gray-800 hover:bg-brand-light'
                    )}
                  >
                    {day ? day.getDate() : ''}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={clearDate}
                disabled={required || disabled}
                className="text-sm text-brand hover:underline disabled:no-underline disabled:opacity-40"
              >
                Clear
              </button>
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
          ref={inputRef}
          id={controlId}
          type="text"
          role="combobox"
          inputMode="none"
          readOnly
          disabled={disabled}
          value={formatIsoDateDisplay(value)}
          onClick={() => !disabled && setOpen(true)}
          onFocus={() => !disabled && setOpen(true)}
          onBlur={onBlur}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === ' ') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          placeholder={placeholder || 'DD-MM-YYYY'}
          className={clsx(
            'input cursor-pointer pr-9',
            error && 'border-red-400 focus:border-red-500 focus:ring-red-400',
            inputClassName
          )}
          aria-invalid={Boolean(error)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
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
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

DatePicker.propTypes = {
  id: PropTypes.string,
  label: PropTypes.string,
  hint: PropTypes.string,
  error: PropTypes.string,
  className: PropTypes.string,
  inputClassName: PropTypes.string,
  required: PropTypes.bool,
  disabled: PropTypes.bool,
  value: PropTypes.string,
  onChange: PropTypes.func,
  onBlur: PropTypes.func,
  placeholder: PropTypes.string,
  min: PropTypes.string,
  max: PropTypes.string,
  inputRef: PropTypes.oneOfType([PropTypes.func, PropTypes.shape({ current: PropTypes.any })]),
  panelAlign: PropTypes.oneOf(['start', 'end']),
};

export default DatePicker;

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
