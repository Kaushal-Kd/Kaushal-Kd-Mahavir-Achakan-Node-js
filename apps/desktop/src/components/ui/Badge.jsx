import clsx from 'clsx';
import PropTypes from 'prop-types';

const TONES = {
  brand: 'border-brand text-brand',
  gray: 'border-gray-300 text-gray-700',
  green: 'border-green-500 text-green-700',
  yellow: 'border-yellow-500 text-yellow-700',
  red: 'border-red-500 text-red-700',
};

const Badge = ({ tone = 'gray', children = null, className = '' }) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs font-medium',
      TONES[tone] || TONES.gray,
      className
    )}
  >
    {children}
  </span>
);

Badge.propTypes = {
  tone: PropTypes.oneOf(['brand', 'gray', 'green', 'yellow', 'red']),
  children: PropTypes.node,
  className: PropTypes.string,
};

export default Badge;
