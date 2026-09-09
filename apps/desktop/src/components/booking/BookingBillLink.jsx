import clsx from 'clsx';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';

const DEFAULT_CLASS = 'font-mono text-xs text-brand hover:underline';

/**
 * Clickable rental booking / bill number → Process Order.
 */
export default function BookingBillLink({
  orderId,
  children,
  className,
  stopPropagation = true,
  onNavigate,
  returnTo,
  returnLabel,
}) {
  const label = children ?? '';
  const id = String(orderId || '').trim();
  if (!id) {
    return <span className={className}>{label || '—'}</span>;
  }
  const display = label || '—';
  const returnPath = String(returnTo || '').trim();
  return (
    <Link
      to={`/booking/${id}`}
      state={
        returnPath
          ? {
              returnTo: returnPath,
              returnLabel: returnLabel || 'Back',
            }
          : undefined
      }
      className={clsx(DEFAULT_CLASS, className)}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onNavigate?.();
      }}
    >
      {display}
    </Link>
  );
}

BookingBillLink.propTypes = {
  orderId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  children: PropTypes.node,
  className: PropTypes.string,
  stopPropagation: PropTypes.bool,
  onNavigate: PropTypes.func,
  returnTo: PropTypes.string,
  returnLabel: PropTypes.string,
};
