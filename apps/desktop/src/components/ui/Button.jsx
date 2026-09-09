import clsx from 'clsx';
import PropTypes from 'prop-types';
import { useCallback, useRef, useState } from 'react';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const SIZES = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-sm px-4 py-2',
  lg: 'text-sm px-5 py-2.5',
};

const ICON_ONLY_SIZES = {
  sm: 'p-1 gap-0',
  md: 'p-1 gap-0',
  lg: 'p-1 gap-0',
};

const Button = ({
  variant = 'primary',
  size = 'md',
  icon: Icon = null,
  iconPosition = 'left',
  iconOnly = false,
  className = '',
  children = null,
  loading = false,
  disabled = false,
  onClick,
  ...rest
}) => {
  const clickLockRef = useRef(false);
  const [clickLocked, setClickLocked] = useState(false);
  const isDisabled = disabled || loading || clickLocked;
  const sizeClasses = iconOnly ? ICON_ONLY_SIZES[size] || ICON_ONLY_SIZES.md : SIZES[size] || '';

  const handleClick = useCallback(
    (event) => {
      if (disabled || loading || clickLockRef.current) return;
      if (!onClick) return;
      clickLockRef.current = true;
      setClickLocked(true);
      try {
        const result = onClick(event);
        Promise.resolve(result).finally(() => {
          clickLockRef.current = false;
          setClickLocked(false);
        });
      } catch (error) {
        clickLockRef.current = false;
        setClickLocked(false);
        throw error;
      }
    },
    [disabled, loading, onClick]
  );

  return (
    <button
      className={clsx(VARIANTS[variant] || VARIANTS.primary, sizeClasses, className)}
      disabled={isDisabled}
      onClick={onClick ? handleClick : undefined}
      {...rest}
    >
      {loading ? <Spinner /> : Icon && iconPosition === 'left' ? <Icon size={16} /> : null}
      {children}
      {!loading && Icon && iconPosition === 'right' ? <Icon size={16} /> : null}
    </button>
  );
};

const Spinner = () => (
  <svg
    className="animate-spin h-4 w-4 text-current"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>
);

Button.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary', 'ghost', 'danger']),
  size: PropTypes.oneOf(['sm', 'md', 'lg']),
  icon: PropTypes.elementType,
  iconPosition: PropTypes.oneOf(['left', 'right']),
  iconOnly: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node,
  loading: PropTypes.bool,
  disabled: PropTypes.bool,
  onClick: PropTypes.func,
};

export default Button;
