import { Bell, BellOff, BellRing } from 'lucide-react';
import PropTypes from 'prop-types';

import Button from '../ui/Button.jsx';
import { toast } from '../../stores/uiStore.js';

const ReminderBrowserNotifyButton = ({ supported, permission, onEnable }) => {
  if (!supported) return null;

  if (permission === 'granted') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand"
        title="Browser will alert you at the reminder time"
      >
        <BellRing size={12} aria-hidden />
        Alerts on
      </span>
    );
  }

  if (permission === 'denied') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-gray-500"
        title="Allow notifications for this site in the browser address bar"
      >
        <BellOff size={12} aria-hidden />
        Alerts blocked
      </span>
    );
  }

  const enable = async () => {
    const next = await onEnable?.();
    if (next === 'granted') {
      toast.success('Browser will notify you at each reminder time');
      return;
    }
    if (next === 'denied') {
      toast.error('Notifications are blocked. Allow them in the browser address bar.');
    }
  };

  return (
    <Button type="button" size="sm" variant="secondary" onClick={enable} className="px-2">
      <span className="inline-flex items-center gap-1">
        <Bell size={12} aria-hidden />
        Notify me
      </span>
    </Button>
  );
};

ReminderBrowserNotifyButton.propTypes = {
  supported: PropTypes.bool,
  permission: PropTypes.string,
  onEnable: PropTypes.func,
};

ReminderBrowserNotifyButton.defaultProps = {
  supported: false,
  permission: 'default',
  onEnable: undefined,
};

export default ReminderBrowserNotifyButton;
