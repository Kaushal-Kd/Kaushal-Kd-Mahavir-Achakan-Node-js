import { Inbox } from 'lucide-react';
import PropTypes from 'prop-types';

const EmptyState = ({ icon: Icon = Inbox, title, message = null, action = null }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="rounded-full border border-gray-200 bg-surface p-4 mb-4">
      <Icon size={28} className="text-brand" />
    </div>
    <h3 className="text-base font-semibold text-gray-900 mb-1">{title}</h3>
    {message ? <p className="text-sm text-gray-500 max-w-sm mb-4">{message}</p> : null}
    {action}
  </div>
);

EmptyState.propTypes = {
  icon: PropTypes.elementType,
  title: PropTypes.string.isRequired,
  message: PropTypes.node,
  action: PropTypes.node,
};

export default EmptyState;
