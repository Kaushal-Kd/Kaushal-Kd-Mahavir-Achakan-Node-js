import { formatCurrency, round2 } from '@wrs/shared';
import PropTypes from 'prop-types';

/** Read-only “Security on order: ₹X” for settlement modal footers. */
const ModalSecurityOnOrderHint = ({ amount, className = '' }) => (
  <span
    className={`text-[10px] leading-snug tabular-nums ${className}`.trim()}
    title="Expected security deposit on this booking"
  >
    <span className="font-medium text-gray-600">Security on order:</span>{' '}
    <span className="font-semibold text-green-700">{formatCurrency(round2(Number(amount) || 0))}</span>
  </span>
);

ModalSecurityOnOrderHint.propTypes = {
  amount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  className: PropTypes.string,
};

ModalSecurityOnOrderHint.defaultProps = {
  amount: 0,
  className: '',
};

export default ModalSecurityOnOrderHint;
