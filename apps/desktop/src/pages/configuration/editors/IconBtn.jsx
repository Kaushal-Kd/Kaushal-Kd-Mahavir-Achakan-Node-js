import clsx from 'clsx';
import PropTypes from 'prop-types';

const IconBtn = ({ title, onClick, disabled, className, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'p-1.5 rounded hover:bg-gray-100 text-gray-600 transition',
      'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
      className
    )}
  >
    {children}
  </button>
);

IconBtn.propTypes = {
  title: PropTypes.string,
  onClick: PropTypes.func,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node,
};

IconBtn.defaultProps = {
  title: '',
  onClick: undefined,
  disabled: false,
  className: '',
  children: null,
};

export default IconBtn;
