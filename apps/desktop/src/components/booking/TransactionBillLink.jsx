import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { voucherReferenceHref } from '../../lib/voucherReference.js';

import BookingBillLink from './BookingBillLink.jsx';
import SaleBillLink from './SaleBillLink.jsx';

/**
 * Bill ref on finance rows: booking payment → Process Order, sale → edit sale.
 */
export default function TransactionBillLink({
  orderId,
  saleId,
  purchaseId,
  voucherId,
  referenceKind,
  billKind,
  linkedBillId,
  children,
  className,
  stopPropagation = true,
}) {
  const label = children ?? '';
  if (referenceKind === 'payment_voucher' || referenceKind === 'receipt_voucher') {
    const href = voucherReferenceHref(referenceKind, voucherId);
    if (!href) return <span className={className}>{label || '—'}</span>;
    return (
      <Link
        to={href}
        className={className || 'font-mono text-xs text-brand hover:underline'}
        onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      >
        {label || '—'}
      </Link>
    );
  }
  if (saleId) {
    return (
      <SaleBillLink saleId={saleId} className={className} stopPropagation={stopPropagation}>
        {label}
      </SaleBillLink>
    );
  }
  const purchaseTarget = purchaseId || (billKind === 'purchase' ? linkedBillId : null);
  if (purchaseTarget) {
    return (
      <Link
        to={`/purchases/${purchaseTarget}/edit`}
        className={className || 'font-mono text-xs text-brand hover:underline'}
        onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      >
        {label || '—'}
      </Link>
    );
  }
  if (voucherId) {
    const href =
      billKind === 'washing' && linkedBillId
        ? `/laundry/${linkedBillId}`
        : `/payment-vouchers?edit=${voucherId}`;
    return (
      <Link
        to={href}
        className={className || 'font-mono text-xs text-brand hover:underline'}
        onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
      >
        {label || '—'}
      </Link>
    );
  }
  return (
    <BookingBillLink orderId={orderId} className={className} stopPropagation={stopPropagation}>
      {label}
    </BookingBillLink>
  );
}

TransactionBillLink.propTypes = {
  orderId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  saleId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  purchaseId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  voucherId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  referenceKind: PropTypes.string,
  billKind: PropTypes.string,
  linkedBillId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  children: PropTypes.node,
  className: PropTypes.string,
  stopPropagation: PropTypes.bool,
};
