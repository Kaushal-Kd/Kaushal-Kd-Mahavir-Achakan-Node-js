import { APP_NAME } from '@wrs/shared/constants';
import { ShieldOff, WifiOff } from 'lucide-react';
import PropTypes from 'prop-types';

import Button from './ui/Button.jsx';

const IpAccessOfflineGate = ({ online = false, validating = false, onRetry }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
    <div className="card max-w-lg w-full p-6 text-center">
      <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
        {online ? <ShieldOff size={24} /> : <WifiOff size={24} />}
      </div>
      <h1 className="text-lg font-semibold text-gray-900">IP access verification required</h1>
      <p className="mt-2 text-sm text-gray-600">
        {online
          ? validating
            ? 'Checking whether your current IP address is authorized…'
            : `${APP_NAME} could not verify your IP address. It will retry automatically, or you can retry now.`
          : `This account is protected by IP whitelisting. Connect to the internet so ${APP_NAME} can verify your current IP address.`}
      </p>
      {validating ? (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-brand">
          <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
          Validating access…
        </div>
      ) : null}
      {online && !validating ? (
        <Button className="mt-4" variant="secondary" onClick={onRetry}>
          Retry verification
        </Button>
      ) : null}
    </div>
  </div>
);

IpAccessOfflineGate.propTypes = {
  online: PropTypes.bool,
  validating: PropTypes.bool,
  onRetry: PropTypes.func.isRequired,
};

export default IpAccessOfflineGate;
