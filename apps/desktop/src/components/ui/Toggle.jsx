import clsx from 'clsx';
import PropTypes from 'prop-types';

/**
 * Accessible on/off toggle switch. Drop-in replacement for an
 * `<input type="checkbox">` for boolean settings.
 *
 *   <Toggle
 *     checked={form.is_active}
 *     onChange={(v) => setForm({ ...form, is_active: v })}
 *     label="Active"
 *     description="Appears in listings and can take new orders"
 *   />
 */
const SIZES = {
  sm: { track: 'h-4 w-7', knob: 'h-3 w-3', translate: 'translate-x-3' },
  md: { track: 'h-5 w-9', knob: 'h-4 w-4', translate: 'translate-x-4' },
  lg: { track: 'h-6 w-11', knob: 'h-5 w-5', translate: 'translate-x-5' },
};

const Toggle = ({
  checked = false,
  onChange = undefined,
  label = null,
  description = null,
  disabled = false,
  size = 'md',
  name = undefined,
  id = undefined,
  className = '',
}) => {
  const s = SIZES[size] || SIZES.md;
  const inputId = id || `tgl-${name || Math.random().toString(36).slice(2, 8)}`;
  const handleChange = (e) => {
    if (disabled) return;
    onChange?.(e.target.checked);
  };

  return (
    <label
      htmlFor={inputId}
      className={clsx(
        'inline-flex items-center gap-3 select-none',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        className
      )}
    >
      <span className="relative inline-flex items-center">
        <input
          id={inputId}
          name={name}
          type="checkbox"
          role="switch"
          className="sr-only peer"
          checked={!!checked}
          onChange={handleChange}
          disabled={disabled}
        />
        <span
          className={clsx(
            s.track,
            'rounded-full bg-gray-300 transition-colors duration-200',
            'peer-checked:bg-brand',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 peer-focus-visible:ring-offset-2'
          )}
          aria-hidden="true"
        />
        <span
          className={clsx(
            s.knob,
            'absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? s.translate : 'translate-x-0'
          )}
          aria-hidden="true"
        />
      </span>
      {(label || description) && (
        <span className="flex flex-col leading-tight">
          {label ? (
            <span className="text-sm text-gray-800 font-medium">{label}</span>
          ) : null}
          {description ? (
            <span className="text-xs text-gray-500">{description}</span>
          ) : null}
        </span>
      )}
    </label>
  );
};

Toggle.propTypes = {
  checked: PropTypes.bool,
  onChange: PropTypes.func,
  label: PropTypes.node,
  description: PropTypes.node,
  disabled: PropTypes.bool,
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  name: PropTypes.string,
  id: PropTypes.string,
  className: PropTypes.string,
};

export default Toggle;
