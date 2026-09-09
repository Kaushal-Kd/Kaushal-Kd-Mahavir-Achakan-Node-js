import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatCurrency,
  formatDateTime,
  normalizePhone,
  phoneInputDigits,
  ROLE_LABELS,
  ROLES,
  validateFields,
} from '@wrs/shared';
import clsx from 'clsx';
import { FilterX, KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import PermissionMatrix, {
  permissionMatrixEqual,
} from '../../../components/permissions/PermissionMatrix.jsx';
import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Button from '../../../components/ui/Button.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import PasswordInput from '../../../components/ui/PasswordInput.jsx';
import Select from '../../../components/ui/Select.jsx';
import TableColumnPicker from '../../../components/ui/TableColumnPicker.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus.js';
import { api, unwrap } from '../../../lib/api.js';
import { getApiErrorMessage } from '../../../lib/apiError.js';
import { usersApi } from '../../../lib/api/users.js';
import { useAuthStore } from '../../../stores/authStore.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { toast } from '../../../stores/uiStore.js';

import Tab from './_Tab.jsx';

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  phone2: '',
  address: '',
  remark: '',
  username: '',
  role: ROLES.SALESMAN,
  password: '',
  shop_ids: [],
  is_active: true,
};

const RULES = {
  name: { required: true, label: 'Name' },
  email: { type: 'email', label: 'Email' },
  phone: { type: 'phone', required: true, label: 'Login phone' },
  phone2: { type: 'phone', label: 'Mobile 2' },
};

/** Matches ONLINE_WINDOW_MS in the backend's lib/presence.js. */
const ONLINE_WINDOW_MS = 2 * 60_000;

/** Compact default: name, email, phone, role, status; hide username, shops, dates. */
const USERS_TAB_DEFAULT_HIDDEN = ['username', 'shops', 'created_at', 'last_login_at'];

const UsersTab = () => {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const currentUser = useAuthStore((s) => s.user);
  const selectedShopId = useShopStore((s) => s.selectedShopId);
  const selectedShopName = useSelectedShopName();
  const canManage = ['super_admin', 'shop_admin'].includes(currentUser?.role);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusTab, setStatusTab] = useState('active');
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [otpChallenge, setOtpChallenge] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [activeTarget, setActiveTarget] = useState(null);
  const [modalTab, setModalTab] = useState('details');
  // Drives the online/offline dot without a network round-trip.
  const [presenceTick, setPresenceTick] = useState(() => Date.now());
  const [permsGrid, setPermsGrid] = useState({});
  const [permsServer, setPermsServer] = useState({});
  const [permsOverridden, setPermsOverridden] = useState(false);
  const [commissionBasis, setCommissionBasis] = useState('');
  const [commissionRate, setCommissionRate] = useState('0');
  const [loginIdentityTarget, setLoginIdentityTarget] = useState(null);
  const [loginIdentity, setLoginIdentity] = useState({ phone: '', email: '' });
  const formRules = useMemo(
    () => ({
      ...RULES,
      email: {
        ...RULES.email,
        required: [ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(form.role),
      },
    }),
    [form.role]
  );
  const liveErrors = useMemo(() => validateFields(form, formRules), [form, formRules]);
  const roleOptions = useMemo(
    () =>
      Object.values(ROLES)
        .filter((role) => role !== ROLES.SUPER_ADMIN)
        .filter((role) => currentUser?.role === ROLES.SUPER_ADMIN || role !== ROLES.SHOP_ADMIN)
        .map((role) => ({ value: role, label: ROLE_LABELS[role] || role })),
    [currentUser?.role]
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  useEffect(() => {
    const id = window.setInterval(() => setPresenceTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDelete,
  } = useAdminDelete({
    deleteFn: (row, admin_password) =>
      api.delete(`/users/${row.id}`, { data: { admin_password } }).then(unwrap),
    onSuccess: () => {
      toast.success('User deleted');
      invalidate();
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['users', selectedShopId, userSearch, statusTab],
    queryFn: () =>
      usersApi.list({
        per_page: 200,
        ...(selectedShopId ? { shop_id: selectedShopId } : {}),
        ...(userSearch.trim() ? { search: userSearch.trim() } : {}),
        ...(statusTab === 'all' ? {} : { is_active: statusTab === 'active' ? 'true' : 'false' }),
      }),
    enabled: Boolean(selectedShopId),
    // presenceTick below only re-renders the dot against a clock; without a
    // refetch `last_seen_at` itself never moves, so a list left open would show
    // everyone drifting offline and nobody ever coming back. 60s matches the
    // server's presence write throttle — polling faster would return identical
    // timestamps.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: loginReadiness } = useQuery({
    queryKey: ['users', 'login-readiness', selectedShopId],
    queryFn: () => usersApi.loginReadiness(),
    enabled: currentUser?.role === ROLES.SUPER_ADMIN && Boolean(selectedShopId),
  });

  const loginModeMut = useMutation({
    mutationFn: (mode) => usersApi.setLoginMode(mode),
    onSuccess: async (response) => {
      toast.success(
        response.data.mode === 'phone_only'
          ? 'Phone-only login enabled'
          : 'Transition login enabled'
      );
      await qc.invalidateQueries({ queryKey: ['users', 'login-readiness'] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not change login mode')),
  });

  const loginIdentityMut = useMutation({
    mutationFn: () =>
      usersApi.updateLoginIdentity(loginIdentityTarget.id, {
        phone: normalizePhone(loginIdentity.phone),
        email: loginIdentity.email.trim(),
      }),
    onSuccess: async () => {
      await invalidate();
      setLoginIdentityTarget(null);
      toast.success('Login details saved. The existing password is unchanged.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not save login details')),
  });

  const rows = useMemo(() => {
    let r = data?.data || [];
    r = r.filter((u) => u.role !== ROLES.SUPER_ADMIN);
    if (currentUser?.role === ROLES.SHOP_ADMIN) {
      r = r.filter((u) => u.role !== ROLES.SHOP_ADMIN);
    }
    if (selectedShopId) {
      r = r.filter((u) => {
        const ids = Array.isArray(u.shop_ids) ? u.shop_ids : [];
        return ids.includes(selectedShopId);
      });
    }
    if (roleFilter) r = r.filter((u) => u.role === roleFilter);
    return r;
  }, [currentUser?.role, data, roleFilter, selectedShopId]);

  const userFiltersClear = !userSearch.trim() && !roleFilter;
  const clearUserFilters = () => {
    setUserSearch('');
    setRoleFilter('');
  };

  const { data: shopsData } = useQuery({
    queryKey: ['shops-for-users'],
    queryFn: () => api.get('/shops', { params: { per_page: 200 } }).then(unwrap),
  });
  const shops = shopsData?.data || [];

  const handleApiError = (err, fallback) => {
    const details = err?.response?.data?.error?.details;
    if (Array.isArray(details)) {
      const fe = {};
      for (const d of details) fe[d.path] = d.message;
      setErrors(fe);
    }
    toast.error(err?.response?.data?.message || err?.response?.data?.error?.message || fallback);
  };

  const createMut = useMutation({
    mutationFn: (payload) => api.post('/users', payload).then(unwrap),
    onSuccess: () => {
      toast.success('User created');
      invalidate();
      close();
    },
    onError: (err) => handleApiError(err, 'Could not create user'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => api.put(`/users/${id}`, payload).then(unwrap),
    onSuccess: () => {
      toast.success('User updated');
      invalidate();
      close();
    },
    onError: (err) => handleApiError(err, 'Could not update user'),
  });

  const passwordMut = useMutation({
    mutationFn: ({ id, password, admin_password }) =>
      api.put(`/users/${id}`, { password, admin_password }).then(unwrap),
    onSuccess: () => {
      toast.success('Password updated');
      invalidate();
      setPwdOpen(false);
      setPwdUser(null);
      setNewPassword('');
      setConfirmPassword('');
      setAdminPassword('');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not update password')),
  });

  const otpRequestMut = useMutation({
    mutationFn: (targetUserId) =>
      api.post('/auth/password-otp/request', { target_user_id: targetUserId }).then(unwrap),
    onSuccess: (response) => {
      setOtpChallenge(response.data.challenge_id);
      setOtpEmail(response.data.email || 'the administrator email');
      toast.success(`OTP sent to ${response.data.email || 'the administrator email'}`);
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not send password OTP')),
  });

  const otpConfirmMut = useMutation({
    mutationFn: (payload) => api.post('/auth/password-otp/confirm', payload).then(unwrap),
    onSuccess: () => {
      toast.success('Administrator password updated');
      invalidate();
      setPwdOpen(false);
      setPwdUser(null);
      setNewPassword('');
      setConfirmPassword('');
      setOtpChallenge(null);
      setOtpCode('');
      setOtpEmail('');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not update password')),
  });

  // Per-user permission grid. Seeded from the user's stored snapshot, falling
  // back to the role matrix for users created before they had one.
  const roleBypassesPermissions = form.role === ROLES.SUPER_ADMIN || form.role === ROLES.SHOP_ADMIN;
  const permsDirty = useMemo(
    () => !permissionMatrixEqual(permsGrid, permsServer),
    [permsGrid, permsServer]
  );

  const permsMut = useMutation({
    mutationFn: ({ id, permissions, resetToRole }) =>
      api
        .put(`/users/${id}`, resetToRole ? { permissions_overridden: false } : { permissions })
        .then(unwrap),
    onSuccess: (res, vars) => {
      const next = res?.data?.permissions || {};
      setPermsServer(next);
      setPermsGrid(JSON.parse(JSON.stringify(next)));
      setPermsOverridden(!!res?.data?.permissions_overridden);
      invalidate();
      toast.success(vars.resetToRole ? 'Permissions reset to role' : 'Permissions saved');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not save permissions')),
  });

  const commissionMut = useMutation({
    mutationFn: ({ id, basis, rate }) =>
      usersApi.updateCommission(id, { basis: basis || null, rate: Number(rate || 0) }),
    onSuccess: () => {
      toast.success('Commission settings saved');
      invalidate();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Could not save commission settings')),
  });

  const resetPermsToRole = () => {
    if (!editing?.id) return;
    permsMut.mutate({ id: editing.id, resetToRole: true });
  };

  const activeMut = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/users/${id}`, { is_active }).then(unwrap),
    onSuccess: (_res, vars) => {
      toast.success(vars.is_active ? 'User activated' : 'User deactivated');
      invalidate();
      setActiveTarget(null);
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Could not update status'));
      setActiveTarget(null);
    },
  });

  // Activating is harmless, so it applies straight away. Deactivating locks the
  // user out, so it asks first.
  const requestActiveChange = (row, next) => {
    if (next) activeMut.mutate({ id: row.id, is_active: true });
    else setActiveTarget(row);
  };

  const resetValidation = () => {
    setErrors({});
    setTouched({});
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      shop_ids: selectedShopId ? [selectedShopId] : [],
    });
    resetValidation();
    setOpen(true);
  };

  const openEdit = async (row) => {
    setEditing(row);
    setModalTab('details');
    let assignedShopIds = [];
    let perms = row.permissions || {};
    let overridden = !!row.permissions_overridden;
    let commissionBasisValue = row.commission_basis || '';
    let commissionRateValue = Number(row.commission_rate || 0);
    try {
      const detail = await api.get(`/users/${row.id}`).then(unwrap);
      assignedShopIds = Array.isArray(detail?.data?.shop_ids) ? detail.data.shop_ids : [];
      // The detail endpoint is the authoritative source for the grid — the
      // list response can be a trimmed row.
      if (detail?.data?.permissions) perms = detail.data.permissions;
      overridden = !!detail?.data?.permissions_overridden;
      commissionBasisValue = detail?.data?.commission_basis || '';
      commissionRateValue = Number(detail?.data?.commission_rate || 0);
    } catch {
      /* fall through — will still open modal */
    }
    setPermsServer(perms);
    setPermsGrid(JSON.parse(JSON.stringify(perms)));
    setPermsOverridden(overridden);
    setCommissionBasis(commissionBasisValue);
    setCommissionRate(String(commissionRateValue));
    setForm({
      name: row.name || '',
      email: row.email || '',
      phone: row.phone || '',
      phone2: row.phone2 || '',
      address: row.address || '',
      remark: row.remark || '',
      username: row.username || '',
      role: row.role || ROLES.SALESMAN,
      password: '',
      shop_ids: assignedShopIds,
      is_active: !!row.is_active,
    });
    resetValidation();
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setModalTab('details');
  };

  const openPasswordModal = (user) => {
    setPwdUser(user);
    setNewPassword('');
    setConfirmPassword('');
    setAdminPassword('');
    setOtpChallenge(null);
    setOtpCode('');
    setOtpEmail('');
    setPwdOpen(true);
  };

  const submitPassword = () => {
    if (!pwdUser?.id) return;
    const adminTarget = [ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(pwdUser.role);
    if (adminTarget && !otpChallenge) {
      otpRequestMut.mutate(pwdUser.id);
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (adminTarget) {
      if (!/^\d{6}$/.test(otpCode)) {
        toast.error('Enter the 6-digit OTP');
        return;
      }
      otpConfirmMut.mutate({
        challenge_id: otpChallenge,
        otp: otpCode,
        new_password: newPassword,
        confirm: confirmPassword,
      });
      return;
    }
    if (!adminPassword.trim()) {
      toast.error('Master Password is required');
      return;
    }
    passwordMut.mutate({
      id: pwdUser.id,
      password: newPassword,
      admin_password: adminPassword,
    });
  };

  const onField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const onBlur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));
  const showError = (key) =>
    touched[key] || errors[key] ? errors[key] || liveErrors[key] : undefined;

  const toggleShop = (id) =>
    setForm((f) => ({
      ...f,
      shop_ids: f.shop_ids.includes(id) ? f.shop_ids.filter((x) => x !== id) : [...f.shop_ids, id],
    }));

  const onSubmit = (e) => {
    e.preventDefault();
    const allTouched = Object.keys(formRules).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);
    const errs = validateFields(form, formRules);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    if (!editing && (!form.password || form.password.length < 8)) {
      return toast.error('Password must be at least 8 characters');
    }

    const trimmedUsername = form.username.trim();
    const loginIdentity = [currentUser?.username, currentUser?.email]
      .filter(Boolean)
      .map((v) => String(v).trim().toLowerCase());
    const usernameLooksAutofilled =
      !editing && trimmedUsername && loginIdentity.includes(trimmedUsername.toLowerCase());

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() ? normalizePhone(form.phone) : null,
      phone2: form.phone2.trim() ? normalizePhone(form.phone2) : null,
      address: form.address.trim() || null,
      remark: form.remark.trim() || null,
      username: usernameLooksAutofilled ? null : trimmedUsername || null,
      role: form.role,
      shop_ids: form.shop_ids,
      is_active: !!form.is_active,
    };
    if (!editing && form.password) payload.password = form.password;

    if (editing) updateMut.mutate({ id: editing.id, payload });
    else createMut.mutate(payload);
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Full name',
        columnPickerLabel: 'Full name',
        render: (r) => {
          // Derived from the timestamp against a ticking clock rather than the
          // server's is_online snapshot, which would stay frozen on a list left
          // open. presenceTick re-renders this every 30s.
          const seenAt = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
          const online = Number.isFinite(seenAt) && presenceTick - seenAt < ONLINE_WINDOW_MS;
          const seenLabel = online
            ? 'Online now'
            : r.last_seen_at
              ? `Last seen ${formatDateTime(r.last_seen_at)}`
              : 'Never seen';
          return (
            <div className="flex items-center gap-2">
              <div className="relative shrink-0">
                <div className="h-8 w-8 rounded-full bg-brand-light text-brand flex items-center justify-center text-xs font-semibold">
                  {(r.name || '?').slice(0, 1).toUpperCase()}
                </div>
                <span
                  className={clsx(
                    'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white',
                    online ? 'bg-green-500' : 'bg-gray-300'
                  )}
                  title={seenLabel}
                  aria-label={seenLabel}
                />
              </div>
              <div>
                <div className="font-medium text-gray-900">{r.name}</div>
                <div className="text-[11px] text-gray-400">{online ? 'Online' : 'Offline'}</div>
              </div>
            </div>
          );
        },
      },
      { key: 'email', header: 'Email', columnPickerLabel: 'Email', render: (r) => r.email || '—' },
      {
        key: 'phone',
        header: 'Phone number',
        columnPickerLabel: 'Phone number',
        render: (r) => r.phone || '—',
      },
      {
        key: 'username',
        header: 'Username',
        columnPickerLabel: 'Username',
        render: (r) => (r.username ? `@${r.username}` : '—'),
      },
      {
        key: 'role',
        header: 'Role',
        columnPickerLabel: 'Role',
        render: (r) => (
          <span className="inline-flex whitespace-nowrap">
            <Badge tone="brand">{ROLE_LABELS[r.role] || r.role}</Badge>
          </span>
        ),
      },
      {
        key: 'commission',
        header: 'Commission',
        columnPickerLabel: 'Commission',
        render: (r) => {
          if (r.role !== ROLES.SALESMAN || !r.commission_basis) return '—';
          const basis = r.commission_basis === 'booking' ? 'booking' : 'product';
          return `${formatCurrency(Number(r.commission_rate || 0))} / ${basis}`;
        },
      },
      {
        key: 'shops',
        header: 'Shops',
        columnPickerLabel: 'Shops',
        render: (r) => {
          const names = Array.isArray(r.shop_names) ? r.shop_names : [];
          if (names.length === 0) return '—';
          if (names.length <= 2) return names.join(', ');
          return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
        },
      },
      {
        key: 'created_at',
        header: 'Created date',
        columnPickerLabel: 'Created date',
        render: (r) => (r.created_at ? formatDateTime(r.created_at) : '—'),
      },
      {
        key: 'last_login_at',
        header: 'Last login date',
        columnPickerLabel: 'Last login date',
        render: (r) => (r.last_login_at ? formatDateTime(r.last_login_at) : 'Never'),
      },
      {
        key: 'is_active',
        header: 'Active / Inactive',
        columnPickerLabel: 'Status',
        render: (r) =>
          canManage ? (
            // Toggled straight from the list — no need to open the edit form.
            <div data-stop-row-click>
              <Toggle
                size="sm"
                checked={!!r.is_active}
                disabled={activeMut.isPending || r.id === currentUser?.id}
                onChange={(next) => requestActiveChange(r, next)}
                label={r.is_active ? 'Active' : 'Inactive'}
              />
            </div>
          ) : r.is_active ? (
            <Badge tone="green">Active</Badge>
          ) : (
            <Badge tone="gray">Inactive</Badge>
          ),
      },
      {
        key: 'actions',
        header: '',
        locked: true,
        align: 'right',
        render: (r) =>
          canManage ? (
            <div className="flex gap-1 justify-end">
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                iconOnly
                onClick={() => openEdit(r)}
                aria-label="Edit"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={KeyRound}
                iconOnly
                onClick={() => openPasswordModal(r)}
                aria-label="Change password"
                title="Change password"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                onClick={() => requestDelete(r)}
                aria-label="Delete user"
                title="Delete user"
                disabled={deleteLoading}
              />
            </div>
          ) : null,
      },
    ],
    [
      canManage,
      deleteLoading,
      openEdit,
      requestDelete,
      openPasswordModal,
      activeMut.isPending,
      currentUser?.id,
      presenceTick,
    ]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('settings-users', allColumns, {
    defaultHidden: USERS_TAB_DEFAULT_HIDDEN,
  });

  return (
    <Tab
      title="Users"
      description={
        selectedShopName
          ? `Team members with access to ${selectedShopName}. Super admins are not listed here.`
          : 'Select a shop in the top bar to view its users.'
      }
      compact
    >
      {currentUser?.role === ROLES.SUPER_ADMIN && loginReadiness?.data ? (
        <div className="card mb-2 flex flex-wrap items-center gap-3 p-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-gray-900">Phone login transition</div>
            <div className="text-gray-600">
              {loginReadiness.data.ready_for_phone_only
                ? 'All active users are ready for phone-only login.'
                : `${loginReadiness.data.blocked.length} active user(s) still need a unique phone or admin email.`}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={loginModeMut.isPending}
            disabled={
              !online ||
              loginReadiness.data.mode === 'phone_only' ||
              !loginReadiness.data.ready_for_phone_only
            }
            onClick={() => loginModeMut.mutate('phone_only')}
          >
            Enable phone-only
          </Button>
          {loginReadiness.data.mode === 'phone_only' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={loginModeMut.isPending}
              disabled={!online}
              onClick={() => loginModeMut.mutate('dual_transition')}
            >
              Restore transition mode
            </Button>
          ) : null}
          {loginReadiness.data.email_otp_configured === false ? (
            <p className="w-full text-yellow-800" role="status">
              Email OTP is not configured for the selected shop. Super Admin can configure it in
              Settings → Shops / Branches → Email Settings. Existing passwords are unchanged.
            </p>
          ) : null}
          {!online ? (
            <p className="w-full text-yellow-800">
              Connect to the server to update login settings.
            </p>
          ) : null}
          {loginReadiness.data.blocked.length ? (
            <ul
              className="w-full max-h-56 overflow-y-auto divide-y divide-gray-200"
              aria-label="Login setup issues"
            >
              {loginReadiness.data.blocked.map((user) => (
                <li key={user.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900">
                      {user.name} ({ROLE_LABELS[user.role] || user.role})
                    </div>
                    <div className="break-words text-gray-600">{user.reason}</div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!online}
                    onClick={() => {
                      setLoginIdentityTarget(user);
                      setLoginIdentity({ phone: user.phone || '', email: user.email || '' });
                    }}
                  >
                    Edit login details
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Modal
        isOpen={Boolean(loginIdentityTarget)}
        onClose={() => {
          if (!loginIdentityMut.isPending) setLoginIdentityTarget(null);
        }}
        title={`Login details - ${loginIdentityTarget?.name || ''}`}
        size="md"
        closeOnBackdrop={false}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={loginIdentityMut.isPending}
              onClick={() => setLoginIdentityTarget(null)}
            >
              Cancel
            </Button>
            <Button
              loading={loginIdentityMut.isPending}
              disabled={!online}
              onClick={() => {
                const issues = validateFields(loginIdentity, {
                  phone: RULES.phone,
                  email: {
                    ...RULES.email,
                    required: [ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(
                      loginIdentityTarget?.role
                    ),
                  },
                });
                if (Object.keys(issues).length) {
                  toast.error(Object.values(issues).join(' '));
                  return;
                }
                loginIdentityMut.mutate();
              }}
            >
              Save login details
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-gray-600">
          Use this person&apos;s real, unique phone number. This does not reset their password.
        </p>
        <div className="space-y-3">
          <Input
            label="Login phone"
            value={loginIdentity.phone}
            inputMode="tel"
            maxLength={10}
            onChange={(event) =>
              setLoginIdentity((old) => ({ ...old, phone: phoneInputDigits(event.target.value) }))
            }
          />
          <Input
            label="Email for administrator password OTP"
            value={loginIdentity.email}
            type="email"
            onChange={(event) => setLoginIdentity((old) => ({ ...old, email: event.target.value }))}
          />
        </div>
      </Modal>
      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          type="search"
          className="flex-1 min-w-[8rem] outline-none text-xs"
          placeholder="Search name, email, phone…"
          value={userSearch}
          name="users-search"
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-lpignore="true"
          data-form-type="other"
          onChange={(e) => setUserSearch(e.target.value)}
        />
        <label className="flex items-center gap-0.5 shrink-0">
          <span className="text-gray-500">Role</span>
          <select
            className="border border-gray-200 rounded px-1 py-0.5 h-7 bg-white text-[11px] max-w-[9rem]"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">All roles</option>
            {roleOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={FilterX}
          className="h-7 px-1.5 text-[11px]"
          onClick={clearUserFilters}
          disabled={userFiltersClear}
        >
          Clear
        </Button>
        <div className="text-xs text-gray-500 ml-1">
          {rows.length} user{rows.length === 1 ? '' : 's'}
        </div>
        <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
          {[
            { id: 'active', label: 'Active' },
            { id: 'inactive', label: 'Inactive' },
            { id: 'all', label: 'All' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatusTab(t.id)}
              className={`px-2 py-1 text-xs border-r border-gray-200 last:border-r-0 ${
                statusTab === t.id
                  ? 'bg-brand text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {canManage ? (
          <Button className="ml-auto" icon={Plus} onClick={openCreate}>
            Add user
          </Button>
        ) : null}
        <TableColumnPicker {...pickerProps} />
      </div>

      {!selectedShopId ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          Select a shop from the navbar to manage users for that shop.
        </div>
      ) : (
        <DataTable
          columns={visibleColumns}
          rows={rows}
          loading={isLoading}
          emptyTitle="No users yet"
          emptyMessage="No users are assigned to this shop yet."
          visibleCount={rows.length}
          totalCount={rows.length}
          countLabel="users"
        />
      )}

      <Modal
        isOpen={open}
        onClose={close}
        title={editing ? `Edit user — ${editing.name}` : 'Add user'}
        size="lg"
        footer={
          // The Permissions tab saves through its own button — showing "Save
          // changes" there would imply it also saves the grid, which it doesn't.
          modalTab !== 'details' && editing ? (
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={close}
                disabled={createMut.isPending || updateMut.isPending}
              >
                Cancel
              </Button>
              <Button onClick={onSubmit} loading={createMut.isPending || updateMut.isPending}>
                {editing ? 'Save changes' : 'Create user'}
              </Button>
            </>
          )
        }
      >
        {editing ? (
          <div className="mb-4 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
            {[
              { id: 'details', label: 'Details' },
              { id: 'permissions', label: 'Permissions' },
              ...(form.role === ROLES.SALESMAN ? [{ id: 'commission', label: 'Commission' }] : []),
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setModalTab(t.id)}
                className={clsx(
                  'px-3 py-1 text-xs rounded',
                  modalTab === t.id
                    ? 'bg-white text-brand shadow-sm font-semibold'
                    : 'text-gray-600'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null}

        {modalTab === 'permissions' && editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-gray-600">
                Based on role:{' '}
                <span className="font-semibold text-gray-900">
                  {ROLE_LABELS[form.role] || form.role}
                </span>
                {permsOverridden ? (
                  <Badge tone="brand" className="ml-2">
                    Customised
                  </Badge>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetPermsToRole}
                disabled={!permsOverridden || permsMut.isPending}
              >
                Reset to role
              </Button>
            </div>

            {roleBypassesPermissions ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {ROLE_LABELS[form.role] || form.role} always has full access — permissions cannot be
                restricted for this role.
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                Some menu items share one permission module. Turning off{' '}
                <span className="font-medium">Settings</span> hides Colors, Sizes, Units, Tailors,
                Reminders and Time Slots together.
              </div>
            )}

            <div className="card p-0 overflow-hidden max-h-[24rem] overflow-y-auto scroll-area">
              <PermissionMatrix
                grid={permsGrid}
                onChange={setPermsGrid}
                editable={canManage && !roleBypassesPermissions}
                forceAllOn={roleBypassesPermissions}
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => permsMut.mutate({ id: editing.id, permissions: permsGrid })}
                loading={permsMut.isPending}
                disabled={!canManage || roleBypassesPermissions || !permsDirty}
              >
                Save permissions
              </Button>
            </div>
          </div>
        ) : modalTab === 'commission' && editing ? (
          <div className="space-y-4">
            <div className="rounded-md border border-brand/20 bg-brand-light px-3 py-2 text-xs text-gray-700">
              Commission is configured for this salesman in the currently selected shop. It is
              earned only after a booking reaches Delivered or a later return/closed stage.
            </div>
            <Select
              label="Commission basis"
              value={commissionBasis}
              onChange={(e) => {
                setCommissionBasis(e.target.value);
                if (!e.target.value) setCommissionRate('0');
              }}
              options={[
                { value: '', label: 'No commission' },
                { value: 'booking', label: 'Booking-wise' },
                { value: 'product', label: 'Product-wise' },
              ]}
            />
            <Input
              label={
                commissionBasis === 'product' ? 'Rate per product quantity' : 'Rate per booking'
              }
              type="number"
              min="0"
              step="0.01"
              disabled={!commissionBasis}
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              hint="Fixed rupee amount; this is not a percentage."
            />
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  const rate = Number(commissionRate || 0);
                  if (!Number.isFinite(rate) || rate < 0) {
                    toast.error('Commission rate must be zero or more');
                    return;
                  }
                  commissionMut.mutate({ id: editing.id, basis: commissionBasis, rate });
                }}
                loading={commissionMut.isPending}
                disabled={!canManage}
              >
                Save commission
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3" noValidate>
            <Input
              label="Full name"
              required
              value={form.name}
              onChange={onField('name')}
              onBlur={onBlur('name')}
              error={showError('name')}
            />
            <Input
              label="Email"
              type="email"
              required={[ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(form.role)}
              value={form.email}
              onChange={onField('email')}
              onBlur={onBlur('email')}
              error={showError('email')}
            />
            <Input
              label="Login phone"
              required
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit phone number"
              value={form.phone}
              onChange={(e) =>
                onField('phone')({ target: { value: phoneInputDigits(e.target.value) } })
              }
              onBlur={onBlur('phone')}
              error={showError('phone')}
            />
            <Input
              label="Alternate phone"
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit mobile (optional)"
              value={form.phone2}
              onChange={(e) =>
                onField('phone2')({ target: { value: phoneInputDigits(e.target.value) } })
              }
              onBlur={onBlur('phone2')}
              error={showError('phone2')}
            />
            <Input
              label="Username"
              name="wrs-user-username"
              autoComplete="off"
              hint="Optional display alias; login uses the phone number above"
              value={form.username}
              onChange={onField('username')}
            />
            <Select
              label="Role"
              required
              value={form.role}
              onChange={onField('role')}
              options={roleOptions}
            />
            {!editing ? (
              <PasswordInput
                label="Password"
                required
                autoComplete="new-password"
                value={form.password}
                onChange={onField('password')}
                hint="Min 8 characters"
              />
            ) : (
              <div>
                {/* Not a <label>: there is no editable control to associate it with. */}
                <div className="label">Password</div>
                <div className="flex items-center gap-2">
                  <span className="input flex-1 text-gray-400 select-none">••••••••</span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={KeyRound}
                    onClick={() => {
                      close();
                      openPasswordModal(editing);
                    }}
                  >
                    Change
                  </Button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Stored encrypted — it cannot be displayed. Use Change to set a new one.
                </p>
              </div>
            )}

            <div className="col-span-2">
              <label className="label" htmlFor="wrs-user-address">
                Address <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                id="wrs-user-address"
                className="input"
                rows={2}
                value={form.address}
                onChange={onField('address')}
                maxLength={500}
              />
            </div>

            <div className="col-span-2">
              <label className="label" htmlFor="wrs-user-remark">
                Remark <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                id="wrs-user-remark"
                className="input"
                rows={2}
                value={form.remark}
                onChange={onField('remark')}
                maxLength={500}
              />
            </div>

            <div className="col-span-2">
              <div className="label">Assigned shops</div>
              {shops.length === 0 ? (
                <div className="text-xs text-gray-500">No shops available.</div>
              ) : (
                <div className="grid grid-cols-2 gap-1 max-h-36 overflow-auto border border-gray-200 rounded-md p-2">
                  {shops.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-brand focus:ring-brand"
                        checked={form.shop_ids.includes(s.id)}
                        onChange={() => toggleShop(s.id)}
                        disabled={currentUser?.role === ROLES.SHOP_ADMIN}
                      />
                      <span>
                        {s.shop_name}{' '}
                        {s.city ? <span className="text-gray-400 text-xs">· {s.city}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="col-span-2">
              <Toggle
                checked={!!form.is_active}
                onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                label="Active"
                description="User can sign in and be assigned to orders"
              />
            </div>
          </form>
        )}
      </Modal>

      <Modal
        isOpen={pwdOpen}
        onClose={() => setPwdOpen(false)}
        title={pwdUser ? `Change password — ${pwdUser.name}` : 'Change password'}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setPwdOpen(false)}
              disabled={passwordMut.isPending || otpRequestMut.isPending || otpConfirmMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={submitPassword}
              loading={passwordMut.isPending || otpRequestMut.isPending || otpConfirmMut.isPending}
            >
              {[ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(pwdUser?.role) && !otpChallenge
                ? 'Send email OTP'
                : 'Update password'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {![ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(pwdUser?.role) || otpChallenge ? (
            <>
              {[ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(pwdUser?.role) ? (
                <Input
                  label="Email OTP"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  hint={`Sent to ${otpEmail}`}
                />
              ) : null}
              <PasswordInput
                label="New password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                hint="Minimum 8 characters with uppercase, lowercase and number"
              />
              <PasswordInput
                label="Confirm password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </>
          ) : (
            <div className="rounded-md border border-brand/20 bg-brand-light px-3 py-2 text-sm text-gray-700">
              A one-time code will be sent to this administrator&apos;s email before a new password
              can be entered.
            </div>
          )}
          {![ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(pwdUser?.role) ? (
            <div className="pt-2 border-t border-gray-100">
              <PasswordInput
                label="Master Password"
                required
                autoComplete="new-password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                hint={`Password of any Shop Admin for ${selectedShopName || 'this shop'}`}
              />
            </div>
          ) : null}
          <p className="text-xs text-gray-500">
            The user will be signed out of all devices and must sign in with the new password.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(activeTarget)}
        onClose={() => setActiveTarget(null)}
        onConfirm={() => activeMut.mutate({ id: activeTarget.id, is_active: false })}
        title="Deactivate user"
        message={
          <>
            <span className="font-medium">{activeTarget?.name}</span> will be signed out and unable
            to sign in until reactivated.
          </>
        }
        confirmLabel="Deactivate"
        danger
        loading={activeMut.isPending}
      />

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Delete user"
        description="This user will lose access to assigned shops."
        itemLabel={deleting?.name}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
      />
    </Tab>
  );
};

export default UsersTab;
