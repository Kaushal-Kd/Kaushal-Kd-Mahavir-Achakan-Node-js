import clsx from 'clsx';
import PropTypes from 'prop-types';
import { forwardRef } from 'react';

import { blockNegativeNumberKeys, nonNegativeChange } from '../../lib/numberInput.js';
import DatePicker from './DatePicker.jsx';

const Input = forwardRef(function Input(
  {
    label,
    hint,
    error,
    className,
    inputClassName,
    required,
    id,
    panelAlign,
    onChange,
    onBlur,
    onKeyDown,
    type,
    min,
    max,
    ...rest
  },
  ref
) {
  const inputId = id || `input-${rest.name || Math.random().toString(36).slice(2, 8)}`;
  const isNumber = type === 'number';
  const numberMin = isNumber ? (min ?? 0) : min;

  const handleKeyDown = isNumber
    ? (e) => {
        if (Number(numberMin) >= 0) blockNegativeNumberKeys(e);
        onKeyDown?.(e);
      }
    : onKeyDown;

  const handleChange = isNumber ? nonNegativeChange(onChange, { min: numberMin }) : onChange;

  const handleBlur = isNumber
    ? (e) => {
        if (e.target.value === '' || e.target.value == null) {
          const next = String(numberMin);
          e.target.value = next;
          onChange?.({
            ...e,
            target: { ...e.target, value: next },
            currentTarget: { ...e.currentTarget, value: next },
          });
        }
        onBlur?.(e);
      }
    : onBlur;

  if (type === 'date') {
    const { type: _type, ...dateProps } = rest;
    return (
      <DatePicker
        id={inputId}
        label={label}
        hint={hint}
        error={error}
        className={className}
        inputClassName={inputClassName}
        required={required}
        inputRef={ref}
        panelAlign={panelAlign}
        min={min}
        max={max}
        onChange={onChange}
        onBlur={onBlur}
        {...dateProps}
      />
    );
  }
  return (
    <div className={clsx('w-full min-w-0', className)}>
      {label ? (
        <label htmlFor={inputId} className="label">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        type={type}
        required={required}
        min={isNumber ? numberMin : undefined}
        className={clsx(
          'input',
          inputClassName,
          error && 'border-red-400 focus:border-red-500 focus:ring-red-400'
        )}
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        onBlur={handleBlur}
        {...rest}
      />
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
});

Input.propTypes = {
  label: PropTypes.string,
  hint: PropTypes.string,
  error: PropTypes.string,
  className: PropTypes.string,
  inputClassName: PropTypes.string,
  required: PropTypes.bool,
  id: PropTypes.string,
  /** Only used when type="date" — passed to DatePicker for popover alignment */
  panelAlign: PropTypes.oneOf(['start', 'end']),
  onChange: PropTypes.func,
  onBlur: PropTypes.func,
  onKeyDown: PropTypes.func,
  type: PropTypes.string,
  min: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  max: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
};

export default Input;
