import { formatCurrency, round2 } from '@wrs/shared';
import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';

const toNonNegativeNumber = (v) => {
  if (v === '' || v == null) return 0;
  return round2(Math.max(0, Number(v) || 0));
};

/**
 * Inline label + amount for order.deposit_amount with pencil to edit.
 * Parent owns `value` / `onChange` (draft updates on blur or icon confirm).
 */
const EditableOrderSecurityCap = ({
  value,
  onChange,
  label = 'Security on order',
  size = 'md',
  disabled,
  className = '',
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft(value === '' || value == null ? '' : String(round2(Number(value) || 0)));
    setEditing(false);
  }, [value]);

  const labelCls = size === 'sm' ? 'text-[9px]' : 'text-[10px]';
  const amountCls = size === 'sm' ? 'text-[10px]' : 'text-[11px]';
  const inputCls = size === 'sm' ? 'h-7 text-[10px]' : 'h-8 text-[11px]';
  const iconSize = size === 'sm' ? 11 : 12;

  const commit = () => {
    const n = toNonNegativeNumber(draft);
    onChange(n);
    setDraft(String(n));
    setEditing(false);
  };

  const displayAmount = round2(Number(value) || 0);

  return (
    <span
      className={`inline-flex flex-nowrap items-center gap-x-1 shrink-0 whitespace-nowrap ${className}`.trim()}
    >
      <span className={`${labelCls} font-medium text-gray-600`}>{label}:</span>
      {editing && !disabled ? (
        <input
          type="number"
          step="0.01"
          min="0"
          value={draft}
          onChange={(e) =>
            setDraft(e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value)))
          }
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setDraft(String(displayAmount));
              setEditing(false);
            }
          }}
          className={`input w-24 py-0.5 px-1.5 tabular-nums ${inputCls}`}
          aria-label={`${label} amount`}
        />
      ) : (
        <span className="inline-flex flex-nowrap items-center gap-x-0.5">
          <span className={`${amountCls} font-semibold text-green-700 tabular-nums`}>
            {formatCurrency(displayAmount)}
          </span>
          {!disabled ? (
            <button
              type="button"
              className="inline-flex text-gray-500 shrink-0 cursor-pointer rounded p-0.5 hover:bg-gray-100 hover:text-brand"
              title={`Edit ${label.toLowerCase()}`}
              aria-label={`Edit ${label.toLowerCase()}`}
              onClick={() => setEditing(true)}
            >
              <Pencil size={iconSize} aria-hidden />
            </button>
          ) : null}
        </span>
      )}
    </span>
  );
};

EditableOrderSecurityCap.propTypes = {
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onChange: PropTypes.func.isRequired,
  label: PropTypes.string,
  size: PropTypes.oneOf(['sm', 'md']),
  disabled: PropTypes.bool,
  className: PropTypes.string,
};

EditableOrderSecurityCap.defaultProps = {
  value: 0,
  label: 'Security on order',
  size: 'md',
  disabled: false,
};

export default EditableOrderSecurityCap;
export { toNonNegativeNumber as toNonNegativeSecurityAmount };
