import clsx from 'clsx';
import PropTypes from 'prop-types';
import { forwardRef } from 'react';

const Select = forwardRef(function Select(
  {
    label,
    hint,
    error,
    className,
    selectClassName,
    required,
    id,
    options,
    placeholder,
    children,
    trailing,
    ...rest
  },
  ref
) {
  const inputId = id || `sel-${rest.name || Math.random().toString(36).slice(2, 8)}`;
  const selectEl = (
    <select
      ref={ref}
      id={inputId}
      className={clsx(
        'input pr-8 bg-surface',
        trailing && 'min-w-0 flex-1',
        selectClassName,
        error && 'border-red-400'
      )}
      {...rest}
    >
      {placeholder ? (
        <option value="" disabled>
          {placeholder}
        </option>
      ) : null}
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  );

  return (
    <div className={clsx('w-full min-w-0', className)}>
      {label ? (
        <label htmlFor={inputId} className="label">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      ) : null}
      {trailing ? (
        <div className="flex min-w-0 items-center gap-1">
          {selectEl}
          <div className="shrink-0">{trailing}</div>
        </div>
      ) : (
        selectEl
      )}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
});

Select.propTypes = {
  label: PropTypes.string,
  hint: PropTypes.string,
  error: PropTypes.string,
  className: PropTypes.string,
  selectClassName: PropTypes.string,
  required: PropTypes.bool,
  id: PropTypes.string,
  options: PropTypes.array,
  placeholder: PropTypes.string,
  children: PropTypes.node,
  trailing: PropTypes.node,
};

export default Select;
