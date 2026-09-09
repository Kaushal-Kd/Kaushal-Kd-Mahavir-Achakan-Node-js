import clsx from 'clsx';
import PropTypes from 'prop-types';

import AccountBankQrButton from './AccountBankQrButton.jsx';

function AccountSelectWithQr({
  accountId,
  accounts,
  accountKind,
  size,
  className,
  children,
}) {
  return (
    <div className={clsx('flex min-w-0 items-center gap-1', className)}>
      <div className="min-w-0 flex-1">{children}</div>
      <AccountBankQrButton
        accountId={accountId}
        accounts={accounts}
        accountKind={accountKind}
        size={size}
      />
    </div>
  );
}

AccountSelectWithQr.propTypes = {
  accountId: PropTypes.string,
  accounts: PropTypes.array,
  accountKind: PropTypes.oneOf(['payment', 'security']),
  size: PropTypes.oneOf(['sm', 'md']),
  className: PropTypes.string,
  children: PropTypes.node.isRequired,
};

AccountSelectWithQr.defaultProps = {
  accountId: '',
  accounts: [],
  accountKind: 'payment',
  size: 'md',
  className: '',
};

export default AccountSelectWithQr;
