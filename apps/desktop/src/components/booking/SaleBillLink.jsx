import clsx from 'clsx';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';

const DEFAULT_CLASS = 'font-mono text-xs text-brand hover:underline';

/**
 * Clickable sale bill number → edit sale.
 */
export default function SaleBillLink({
  saleId,
  children,
  className,
  stopPropagation = true,
}) {
  const label = children ?? '';
  const id = String(saleId || '').trim();
  if (!id) {
    return <span className={className}>{label || '—'}</span>;
  }
  const display = label || '—';
  return (
    <Link
      to={`/sales/${id}/edit`}
      className={clsx(DEFAULT_CLASS, className)}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {display}
    </Link>
  );
}

SaleBillLink.propTypes = {
  saleId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  children: PropTypes.node,
  className: PropTypes.string,
  stopPropagation: PropTypes.bool,
};
