import { useMutation, useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDateTime, isIndianPhone, phoneInputDigits } from '@wrs/shared';
import { Pencil, Plus, Search, Shield, Trash2, Wallet, ZoomIn } from 'lucide-react';
import { useState } from 'react';

import PaymentAccountFormModal, {
  createPaymentAccountLocalId,
  emptyPaymentAccountDraft,
} from '../../../components/accounts/PaymentAccountFormModal.jsx';
import SecurityAccountFormModal, {
  emptySecurityAccountDraft,
} from '../../../components/accounts/SecurityAccountFormModal.jsx';
import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Button from '../../../components/ui/Button.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { paymentAccountsApi } from '../../../lib/api/paymentAccounts.js';
import { securityAccountsApi } from '../../../lib/api/securityAccounts.js';
import { isBankPaymentAccountGroup, isBankSecurityAccountType, securityAccountTypeLabel } from '../../../lib/paymentAccountFilters.js';
import { imagePreview, toast } from '../../../stores/uiStore.js';

import Tab, { Section } from './_Tab.jsx';

function AccountSearchField({ value, onChange, label }) {
  return (
    <div className="relative w-full max-w-sm mb-3">
      <Search
        size={14}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, contact or group…"
        className="input pl-8 h-9 w-full"
        aria-label={label}
      />
    </div>
  );
}

function AccountGroupBadge({ group }) {
  const label = String(group || '').trim() || '—';
  const isBank = isBankPaymentAccountGroup(group);
  return (
    <span
      className={`inline-flex max-w-[120px] truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isBank ? 'bg-brand-light text-brand' : 'bg-gray-100 text-gray-700'
      }`}
      title={label}
    >
      {label}
    </span>
  );
}

function SecurityTypeBadge({ accountType }) {
  const label = securityAccountTypeLabel(accountType);
  const isBank = isBankSecurityAccountType(accountType);
  return (
    <span
      className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
        isBank ? 'bg-brand-light text-brand' : 'bg-gray-100 text-gray-700'
      }`}
    >
      {label}
    </span>
  );
}

function AccountQrThumb({ url, accountName, kind = 'Bank QR' }) {
  const src = String(url || '').trim();
  if (!src) {
    return <span className="text-gray-400">—</span>;
  }

  const open = () => {
    imagePreview.open(src, accountName ? `${accountName} — ${kind}` : kind);
  };

  return (
    <button
      type="button"
      onClick={open}
      className="group relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1"
      title="View QR code"
      aria-label={accountName ? `View QR code for ${accountName}` : 'View QR code'}
    >
      <img src={src} alt="" className="h-full w-full object-contain p-0.5" />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/10">
        <ZoomIn
          size={14}
          className="text-brand opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </span>
    </button>
  );
}

function cellText(value, { mono = false, maxWidth } = {}) {
  const text = String(value ?? '').trim() || '—';
  return (
    <span
      className={`block truncate text-gray-800 ${mono ? 'font-mono text-[11px]' : ''}`}
      style={maxWidth ? { maxWidth } : undefined}
      title={text === '—' ? undefined : text}
    >
      {text}
    </span>
  );
}

const AccountsConfigTab = () => {
  const selectedShopName = useSelectedShopName();
  const [activePanel, setActivePanel] = useState('advance');
  // Separate per panel — a term carried across would render "no accounts match"
  // on the other tab and read as if it were empty.
  const [paymentSearch, setPaymentSearch] = useState('');
  const [securitySearch, setSecuritySearch] = useState('');
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [newAccount, setNewAccount] = useState(() => emptyPaymentAccountDraft());
  const [newSecurity, setNewSecurity] = useState(() => emptySecurityAccountDraft());
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [editingSecurityId, setEditingSecurityId] = useState(null);

  const paymentAccountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });
  const securityAccountsQuery = useQuery({
    queryKey: ['security-accounts', 'settings'],
    queryFn: () => securityAccountsApi.list(),
  });

  const paymentAccounts = paymentAccountsQuery.data?.data || [];
  const securityAccounts = securityAccountsQuery.data?.data || [];

  const matchesSearch = (a, term, extraFields = []) => {
    const q = term.trim().toLowerCase();
    if (!q) return true;
    return [a?.name, a?.contact_no, ...extraFields]
      .map((v) => String(v ?? '').toLowerCase())
      .some((v) => v.includes(q));
  };
  const filteredPaymentAccounts = paymentAccounts.filter((a) =>
    matchesSearch(a, paymentSearch, [a?.account_group])
  );
  const filteredSecurityAccounts = securityAccounts.filter((a) =>
    matchesSearch(a, securitySearch, [a?.account_type])
  );

  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDelete,
  } = useAdminDelete({
    deleteFn: (item, admin_password) => {
      if (item.accountType === 'payment') {
        return paymentAccountsApi.remove(item.id, { admin_password });
      }
      return securityAccountsApi.remove(item.id, { admin_password });
    },
    onSuccess: async (_data, item) => {
      if (item.accountType === 'payment') {
        await paymentAccountsQuery.refetch();
        toast.success('Account removed');
      } else {
        await securityAccountsQuery.refetch();
        toast.success('Security account removed');
      }
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async () => {
      const name = String(newAccount.name || '').trim();
      const contactNo = String(newAccount.contact_no || '').trim();
      const accountGroup = String(newAccount.account_group || '').trim();
      if (!name) throw new Error('Name is required');
      if (!contactNo) throw new Error('Contact No is required');
      if (!isIndianPhone(contactNo)) throw new Error('Enter a valid 10-digit mobile number');
      if (!accountGroup) throw new Error('Account Group is required');
      const payload = {
        name,
        contact_no: contactNo,
        account_group: accountGroup,
        account_type: newAccount.account_type || 'other',
        opening_balance: Number(newAccount.opening_balance || 0),
        date: newAccount.date || '',
        email: String(newAccount.email || '').trim(),
        address: String(newAccount.address || '').trim(),
        remarks: String(newAccount.remarks || '').trim(),
        qr_code_url: isBankPaymentAccountGroup(accountGroup)
          ? String(newAccount.qr_code_url || '').trim()
          : '',
      };
      if (editingPaymentId) return paymentAccountsApi.update(editingPaymentId, payload);
      return paymentAccountsApi.create({ id: createPaymentAccountLocalId(), ...payload });
    },
    onSuccess: async () => {
      await paymentAccountsQuery.refetch();
      setNewAccount(emptyPaymentAccountDraft());
      setAccountModalOpen(false);
      setEditingPaymentId(null);
      toast.success(editingPaymentId ? 'Account updated' : 'Account created');
    },
    onError: (e) => toast.error(e?.message || 'Failed to create account'),
  });

  const createSecurityMutation = useMutation({
    mutationFn: async () => {
      const name = String(newSecurity.name || '').trim();
      const accountType = String(newSecurity.account_type || 'cash').trim() || 'cash';
      if (!name) throw new Error('Security account name is required');
      const payload = {
        name,
        account_type: accountType,
        qr_code_url: isBankSecurityAccountType(accountType)
          ? String(newSecurity.qr_code_url || '').trim()
          : '',
      };
      if (editingSecurityId) return securityAccountsApi.update(editingSecurityId, payload);
      return securityAccountsApi.create({ id: createPaymentAccountLocalId(), ...payload });
    },
    onSuccess: async () => {
      await securityAccountsQuery.refetch();
      setNewSecurity(emptySecurityAccountDraft());
      setSecurityModalOpen(false);
      setEditingSecurityId(null);
      toast.success(editingSecurityId ? 'Security account updated' : 'Security account created');
    },
    onError: (e) => toast.error(e?.message || 'Failed to create security account'),
  });

  const openCreatePayment = () => {
    setEditingPaymentId(null);
    setNewAccount(emptyPaymentAccountDraft());
    setAccountModalOpen(true);
  };

  const openEditPayment = (row) => {
    setEditingPaymentId(row.id);
    setNewAccount({
      name: row.name || '',
      // Legacy rows may hold longer or non-numeric values from before the
      // 10-digit rule; normalise on load so editing one doesn't fail to save.
      contact_no: phoneInputDigits(row.contact_no || ''),
      account_group: row.account_group || '',
      account_type: row.account_type || 'other',
      opening_balance: Number(row.opening_balance || 0),
      date: row.date || '',
      email: row.email || '',
      address: row.address || '',
      remarks: row.remarks || '',
      qr_code_url: row.qr_code_url || '',
    });
    setAccountModalOpen(true);
  };

  const openCreateSecurity = () => {
    setEditingSecurityId(null);
    setNewSecurity(emptySecurityAccountDraft());
    setSecurityModalOpen(true);
  };

  const openEditSecurity = (row) => {
    setEditingSecurityId(row.id);
    setNewSecurity({
      name: row.name || '',
      account_type: row.account_type || 'cash',
      qr_code_url: row.qr_code_url || '',
    });
    setSecurityModalOpen(true);
  };

  return (
    <Tab
      title="Accounts"
      description="Choose a list below. Advance accounts and security deposit accounts are separate and appear in different fields on Create Booking."
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 gap-0.5"
          role="tablist"
          aria-label="Account type"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === 'advance'}
            id="accounts-tab-advance"
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
              activePanel === 'advance'
                ? 'bg-white text-brand shadow-sm border border-gray-200'
                : 'text-gray-600 hover:text-gray-900 border border-transparent'
            }`}
            onClick={() => setActivePanel('advance')}
          >
            <Wallet size={14} className="shrink-0 opacity-90" aria-hidden />
            Payment Accounts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activePanel === 'security'}
            id="accounts-tab-security"
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors ${
              activePanel === 'security'
                ? 'bg-white text-brand shadow-sm border border-gray-200'
                : 'text-gray-600 hover:text-gray-900 border border-transparent'
            }`}
            onClick={() => setActivePanel('security')}
          >
            <Shield size={14} className="shrink-0 opacity-90" aria-hidden />
            Security Accounts
          </button>
        </div>
        {activePanel === 'advance' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={Plus}
            className="h-7 px-2.5 text-[11px] font-medium shrink-0"
            onClick={openCreatePayment}
          >
            Create account
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={Plus}
            className="h-7 px-2.5 text-[11px] font-medium shrink-0"
            onClick={openCreateSecurity}
          >
            Create security
          </Button>
        )}
      </div>

      {activePanel === 'advance' ? (
        <div role="tabpanel" aria-labelledby="accounts-tab-advance">
        <Section
          title="Advance payment accounts"
          description="Ledger-style records used only for the Advance account dropdown when the customer pays toward the booking."
          className="border-l-4 border-l-brand"
        >
          {paymentAccounts.length > 0 ? (
            <AccountSearchField
              value={paymentSearch}
              onChange={setPaymentSearch}
              label="Search advance accounts"
            />
          ) : null}
          {paymentAccounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50/80 px-3 py-4 text-sm text-gray-600">
              No advance accounts yet. Create one to use it on Create Booking.
            </div>
          ) : filteredPaymentAccounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50/80 px-3 py-4 text-sm text-gray-600">
              No advance accounts match “{paymentSearch.trim()}”.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="table w-full min-w-[1040px] text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Name</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Group</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Contact</TableHeaderLabel>
                      </th>
                      <th className="text-right px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel align="right">Opening</TableHeaderLabel>
                      </th>
                      <th className="text-center px-3 py-2 whitespace-nowrap w-[72px]">
                        <TableHeaderLabel>Bank QR</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Date</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap min-w-[140px]">
                        <TableHeaderLabel>Email</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap min-w-[160px]">
                        <TableHeaderLabel>Address</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap min-w-[140px]">
                        <TableHeaderLabel>Remarks</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Created</TableHeaderLabel>
                      </th>
                      <th className="text-right px-3 py-2 w-20 whitespace-nowrap" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredPaymentAccounts.map((a) => (
                      <tr key={a.id} className="bg-white hover:bg-gray-50/80">
                        <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                          {cellText(a.name)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <AccountGroupBadge group={a.account_group} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{cellText(a.contact_no, { mono: true })}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-gray-900">
                          {formatCurrency(Number(a.opening_balance || 0))}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-center">
                            {isBankPaymentAccountGroup(a.account_group) ? (
                              <AccountQrThumb url={a.qr_code_url} accountName={a.name} />
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{cellText(a.date)}</td>
                        <td className="px-3 py-2">{cellText(a.email, { maxWidth: 160 })}</td>
                        <td className="px-3 py-2">{cellText(a.address, { maxWidth: 180 })}</td>
                        <td className="px-3 py-2">{cellText(a.remarks, { maxWidth: 160 })}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                          {a.created_at ? formatDateTime(a.created_at) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditPayment(a)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:border-brand hover:bg-brand-light hover:text-brand"
                              aria-label="Edit account"
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete({ accountType: 'payment', ...a })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              aria-label="Remove account"
                            >
                              <Trash2 size={12} strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby="accounts-tab-security">
        <Section
          title="Security deposit accounts"
          description="Short labels for where security deposits are held. Used only for the Security account dropdown on Create Booking—not for advances."
          className="border-l-4 border-l-gray-400"
        >
          {securityAccounts.length > 0 ? (
            <AccountSearchField
              value={securitySearch}
              onChange={setSecuritySearch}
              label="Search security deposit accounts"
            />
          ) : null}
          {securityAccounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600">
              No security deposit accounts yet. These are separate from advance accounts.
            </div>
          ) : filteredSecurityAccounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600">
              No security deposit accounts match “{securitySearch.trim()}”.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="table w-full min-w-[560px] text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Name</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Type</TableHeaderLabel>
                      </th>
                      <th className="text-center px-3 py-2 whitespace-nowrap w-[72px]">
                        <TableHeaderLabel>Bank QR</TableHeaderLabel>
                      </th>
                      <th className="text-left px-3 py-2 whitespace-nowrap">
                        <TableHeaderLabel>Created</TableHeaderLabel>
                      </th>
                      <th className="text-right px-3 py-2 w-20 whitespace-nowrap" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredSecurityAccounts.map((a) => (
                      <tr key={a.id} className="bg-white hover:bg-gray-50/80">
                        <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                          {cellText(a.name)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <SecurityTypeBadge accountType={a.account_type} />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-center">
                            {isBankSecurityAccountType(a.account_type) ? (
                              <AccountQrThumb url={a.qr_code_url} accountName={a.name} />
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                          {a.created_at ? formatDateTime(a.created_at) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditSecurity(a)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:border-brand hover:bg-brand-light hover:text-brand"
                              aria-label="Edit security account"
                            >
                              <Pencil size={12} strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete({ accountType: 'security', ...a })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                              aria-label="Remove security account"
                            >
                              <Trash2 size={12} strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
        </div>
      )}

      <PaymentAccountFormModal
        isOpen={accountModalOpen}
        onClose={() => {
          setAccountModalOpen(false);
          setEditingPaymentId(null);
          setNewAccount(emptyPaymentAccountDraft());
        }}
        draft={newAccount}
        setDraft={setNewAccount}
        editingId={editingPaymentId}
        fixedAccountGroup={null}
        onSave={() => createPaymentMutation.mutate()}
        saveLoading={createPaymentMutation.isPending}
      />

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title={deleting?.accountType === 'security' ? 'Remove security account' : 'Remove account'}
        description={
          deleting?.accountType === 'security'
            ? 'This security deposit account will no longer appear on Create Booking.'
            : 'This advance payment account will no longer appear on Create Booking.'
        }
        itemLabel={deleting?.name}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
        confirmLabel="Remove"
      />

      <SecurityAccountFormModal
        isOpen={securityModalOpen}
        onClose={() => {
          setSecurityModalOpen(false);
          setEditingSecurityId(null);
          setNewSecurity(emptySecurityAccountDraft());
        }}
        draft={newSecurity}
        setDraft={setNewSecurity}
        editingId={editingSecurityId}
        onSave={() => createSecurityMutation.mutate()}
        saveLoading={createSecurityMutation.isPending}
      />
    </Tab>
  );
};

export default AccountsConfigTab;
