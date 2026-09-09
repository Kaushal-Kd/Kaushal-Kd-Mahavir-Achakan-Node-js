import { QrCode } from 'lucide-react';
import PropTypes from 'prop-types';
import { useMemo } from 'react';

import { resolveLedgerAccountQrPreview } from '../../lib/paymentAccountFilters.js';
import { imagePreview } from '../../stores/uiStore.js';

const SIZE_CLASS = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
};

const ICON_SIZE = {
  sm: 14,
  md: 16,
};

function AccountBankQrButton({ accountId, accounts, accountKind, size }) {
  const preview = useMemo(
    () => resolveLedgerAccountQrPreview({ accountId, accounts, accountKind }),
    [accountId, accounts, accountKind]
  );

  if (!preview?.url) return null;

  return (
    <button
      type="button"
      onClick={() => imagePreview.open(preview.url, preview.title)}
      className={`inline-flex shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 hover:border-brand hover:bg-brand-light hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 ${SIZE_CLASS[size] || SIZE_CLASS.md}`}
      title="View bank QR code"
      aria-label="View bank QR code"
    >
      <QrCode size={ICON_SIZE[size] || ICON_SIZE.md} aria-hidden />
    </button>
  );
}

AccountBankQrButton.propTypes = {
  accountId: PropTypes.string,
  accounts: PropTypes.array,
  accountKind: PropTypes.oneOf(['payment', 'security']),
  size: PropTypes.oneOf(['sm', 'md']),
};

AccountBankQrButton.defaultProps = {
  accountId: '',
  accounts: [],
  accountKind: 'payment',
  size: 'md',
};

export default AccountBankQrButton;
