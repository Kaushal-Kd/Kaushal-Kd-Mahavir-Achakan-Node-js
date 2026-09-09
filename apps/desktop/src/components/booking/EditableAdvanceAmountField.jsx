import clsx from 'clsx';
import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';
import { useRef, useState } from 'react';

/**
 * Advance amount input. In edit mode (`locked`), read-only with pencil — opens settlement via `onEditClick`
 * or inline edit when `onEditClick` is omitted.
 */
const EditableAdvanceAmountField = ({
  value,
  onChange,
  onFocus,
  onBlur,
  locked,
  onEditClick,
  hasError,
  className,
}) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  const useSettlement = locked && typeof onEditClick === 'function';
  const readOnly = locked && (useSettlement || !editing);

  const startEditing = () => {
    if (useSettlement) {
      onEditClick();
      return;
    }
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const finishEditing = (e) => {
    onBlur?.(e);
    if (locked && !useSettlement) setEditing(false);
  };

  const editActionLabel = useSettlement ? 'Open settlement' : 'Edit advance amount';

  const inputClass = clsx(
    'w-20 shrink-0 text-right border px-1.5 py-1.5 text-xs tabular-nums outline-none',
    locked ? 'rounded-l border-r-0' : 'rounded',
    readOnly ? 'bg-gray-50 text-gray-900 cursor-default' : 'bg-white',
    hasError ? 'border-red-400 ring-1 ring-red-400' : 'border-gray-200',
    className
  );

  if (!locked) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className={inputClass}
        aria-label="Advance amount"
      />
    );
  }

  return (
    <span className="inline-flex items-stretch shrink-0">
      <input
        ref={inputRef}
        type="number"
        min={0}
        step="0.01"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          if (readOnly) {
            e.target.blur();
            return;
          }
          onFocus?.(e);
        }}
        onBlur={finishEditing}
        onKeyDown={(e) => {
          if (useSettlement) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
        className={inputClass}
        aria-label="Advance amount"
      />
      <button
        type="button"
        className={clsx(
          'inline-flex items-center justify-center px-1.5 border rounded-r bg-white',
          hasError ? 'border-red-400' : 'border-gray-200',
          'text-green-600 hover:bg-green-50 hover:text-green-700'
        )}
        title={editActionLabel}
        aria-label={editActionLabel}
        onClick={startEditing}
      >
        <Pencil size={14} aria-hidden />
      </button>
    </span>
  );
};

EditableAdvanceAmountField.propTypes = {
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  onChange: PropTypes.func.isRequired,
  onFocus: PropTypes.func,
  onBlur: PropTypes.func,
  locked: PropTypes.bool,
  onEditClick: PropTypes.func,
  hasError: PropTypes.bool,
  className: PropTypes.string,
};

EditableAdvanceAmountField.defaultProps = {
  onFocus: null,
  onBlur: null,
  locked: false,
  onEditClick: null,
  hasError: false,
  className: '',
};

export default EditableAdvanceAmountField;
