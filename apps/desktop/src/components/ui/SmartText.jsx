import PropTypes from 'prop-types';

/**
 * Translates English strings on the fly via the dictionary service (requirements §58).
 * For Phase 1 this is a pass-through. Real dictionary wiring lands in Phase 2.
 */
const SmartText = ({ children = null }) => <>{children}</>;

SmartText.propTypes = { children: PropTypes.node };

export default SmartText;
