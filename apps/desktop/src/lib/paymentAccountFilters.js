/** Normalize payment_accounts.account_group for comparisons. */
export function normPaymentAccountGroup(g) {
  return String(g ?? '')
    .trim()
    .toLowerCase();
}

export function isBankPaymentAccountGroup(group) {
  return normPaymentAccountGroup(group) === 'bank accounts';
}

/** @param {{ is_active?: boolean }} account */
export function isActiveAccount(account) {
  return account?.is_active !== false;
}

/** @param {boolean} [activeOnly=true] */
export function isActiveSecurityAccount(account, activeOnly = true) {
  if (!account) return false;
  if (activeOnly && account.is_active === false) return false;
  return true;
}

export const SECURITY_ACCOUNT_TYPE_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
];

export function normSecurityAccountType(type) {
  return String(type ?? '')
    .trim()
    .toLowerCase();
}

export function isBankSecurityAccountType(type) {
  return normSecurityAccountType(type) === 'bank';
}

export function securityAccountTypeLabel(type) {
  return isBankSecurityAccountType(type) ? 'Bank' : 'Cash';
}

/**
 * @param {Array<{ account_group?: string, is_active?: boolean }>} accounts
 * @param {string[]} groups — normalized group names, e.g. 'bank accounts', 'income'
 * @param {{ activeOnly?: boolean }} [opts]
 */
export function paymentAccountsByGroup(accounts, groups, opts = {}) {
  const { activeOnly = true } = opts;
  const allowed = new Set(groups.map((g) => normPaymentAccountGroup(g)));
  return (accounts || []).filter((a) => {
    if (activeOnly && !isActiveAccount(a)) return false;
    return allowed.has(normPaymentAccountGroup(a.account_group));
  });
}

export function activeBankCashPaymentAccounts(accounts) {
  return [
    ...paymentAccountsByGroup(accounts, ['bank accounts']),
    ...paymentAccountsByGroup(accounts, ['cash accounts']),
  ];
}

export function activeIncomePaymentAccounts(accounts) {
  return paymentAccountsByGroup(accounts, ['income']);
}

/** @param {Array<{ is_active?: boolean }>} accounts */
export function activeSecurityAccountsList(accounts) {
  return (accounts || []).filter((a) => isActiveSecurityAccount(a));
}

/** @param {Array<{ id?: string }>} accounts */
export function findPaymentAccountById(accounts, id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return (accounts || []).find((a) => String(a.id) === key) || null;
}

/** @param {Array<{ id?: string }>} accounts */
export function findSecurityAccountById(accounts, id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return (accounts || []).find((a) => String(a.id) === key) || null;
}

/**
 * @param {{ accountId?: string, accounts?: Array<object>, accountKind?: 'payment' | 'security' }} params
 * @returns {{ url: string, title: string } | null}
 */
export function resolveLedgerAccountQrPreview({ accountId, accounts, accountKind = 'payment' }) {
  const id = String(accountId ?? '').trim();
  if (!id) return null;

  if (accountKind === 'security') {
    const account = findSecurityAccountById(accounts, id);
    if (!account || !isBankSecurityAccountType(account.account_type)) return null;
    const url = String(account.qr_code_url ?? '').trim();
    if (!url) return null;
    const name = String(account.name ?? '').trim();
    return { url, title: name ? `${name} — Bank QR` : 'Bank QR code' };
  }

  const account = findPaymentAccountById(accounts, id);
  if (!account || !isBankPaymentAccountGroup(account.account_group)) return null;
  const url = String(account.qr_code_url ?? '').trim();
  if (!url) return null;
  const name = String(account.name ?? '').trim();
  return { url, title: name ? `${name} — Bank QR` : 'Bank QR code' };
}
