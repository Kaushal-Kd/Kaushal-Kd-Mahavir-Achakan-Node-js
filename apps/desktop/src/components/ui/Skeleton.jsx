import clsx from 'clsx';
import PropTypes from 'prop-types';

const Skeleton = ({ className = 'h-4 w-full' }) => (
  <div className={clsx('animate-pulse bg-gray-100 rounded-md', className)} />
);

Skeleton.propTypes = { className: PropTypes.string };
export default Skeleton;
