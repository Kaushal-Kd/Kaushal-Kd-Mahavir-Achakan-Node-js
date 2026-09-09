import clsx from 'clsx';
import PropTypes from 'prop-types';

import { formatAccessoryGivenStatusLabel } from '../../lib/bookingAccessoryCart.js';

export { formatAccessoryGivenStatusLabel };

function normalizeLineType(type) {
  return String(type || 'rent').toLowerCase() === 'sell' ? 'sell' : 'rent';
}

const LineTypeTag = ({ type, compact, className }) => {
  const lineType = normalizeLineType(type);
  const isSell = lineType === 'sell';

  return (
    <span
      className={clsx(
        'shrink-0 font-medium',
        compact ? 'text-[12px]' : 'text-[12px]',
        isSell ? 'text-yellow-700' : 'text-brand',
        className
      )}
    >
      {isSell ? 'Sell' : 'Rent'}
    </span>
  );
};

LineTypeTag.propTypes = {
  type: PropTypes.string,
  compact: PropTypes.bool,
  className: PropTypes.string,
};

LineTypeTag.defaultProps = {
  type: 'rent',
  compact: false,
  className: '',
};

export default LineTypeTag;
