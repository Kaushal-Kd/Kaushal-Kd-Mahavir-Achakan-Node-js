import clsx from 'clsx';
import PropTypes from 'prop-types';
import { forwardRef } from 'react';

import { blockNegativeNumberKeys, nonNegativeChange } from '../../lib/numberInput.js';

/**
 * Number field that rejects negative values (amounts, qty, %, etc.).
 * Empty is allowed while typing; on blur, empty becomes min unless allowEmpty is true.
 */
const NumberInput = forwardRef(function NumberInput(
  {
    min = 0,
    max = undefined,
    step = undefined,
    onChange = undefined,
    onBlur = undefined,
    onKeyDown = undefined,
    className = undefined,
    allowEmpty = false,
    ...rest
  },
  ref
) {
  const handleKeyDown = (e) => {
    blockNegativeNumberKeys(e);
    onKeyDown?.(e);
  };

  const handleChange = nonNegativeChange((e) => {
    onChange?.(e);
  }, { min });

  const handleBlur = (e) => {
    if (!allowEmpty && (e.target.value === '' || e.target.value == null)) {
      const next = String(min);
      e.target.value = next;
      onChange?.({
        ...e,
        target: { ...e.target, value: next },
        currentTarget: { ...e.currentTarget, value: next },
      });
    }
    onBlur?.(e);
  };

  return (
    <input
      ref={ref}
      type="number"
      min={min}
      max={max}
      step={step}
      className={clsx(className)}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

NumberInput.propTypes = {
  min: PropTypes.number,
  max: PropTypes.number,
  step: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onChange: PropTypes.func,
  onBlur: PropTypes.func,
  onKeyDown: PropTypes.func,
  className: PropTypes.string,
  allowEmpty: PropTypes.bool,
};

export default NumberInput;
