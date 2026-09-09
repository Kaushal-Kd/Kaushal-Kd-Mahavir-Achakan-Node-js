import clsx from 'clsx';
import PropTypes from 'prop-types';

const Card = ({ className = '', children = null, as: As = 'div', padded = false }) => (
  <As className={clsx('card', padded && 'p-5', className)}>{children}</As>
);

Card.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
  as: PropTypes.elementType,
  padded: PropTypes.bool,
};

export default Card;
