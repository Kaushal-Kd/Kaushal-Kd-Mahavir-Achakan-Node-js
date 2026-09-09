import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatDateTime,
  normalizePhone,
  phoneInputDigits,
  ROLE_LABELS,
  validateFields,
} from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { authApi } from '../../lib/api/auth.js';
import { useAuthStore } from '../../stores/authStore.js';
import { toast } from '../../stores/uiStore.js';

const PROFILE_RULES = {
  name: { required: true, label: 'Name' },
  phone: { type: 'phone', required: true, label: 'Login phone' },
};

const EMPTY_PROFILE = {
  name: '',
  phone: '',
  username: '',
};

function InfoRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between py-2 border-b border-gray-100 last:border-0">
      <dt className="text-xs font-bold uppercase tracking-wide text-gray-500 shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900 sm:text-right break-words">{value ?? '—'}</dd>
    </div>
  );
}

InfoRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
};

const ProfilePage = () => {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);

  const [form, setForm] = useState(EMPTY_PROFILE);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authApi.getMe,
  });

  const user = data?.data?.user;
  const shops = data?.data?.shops || [];

  useEffect(() => {
    if (!user) return;
    setForm({
      name: user.name || '',
      phone: user.phone || '',
      username: user.username || '',
    });
  }, [user]);

  const liveErrors = useMemo(() => validateFields(form, PROFILE_RULES), [form]);

  const saveMut = useMutation({
    mutationFn: (payload) => authApi.updateProfile(payload),
    onSuccess: (resp) => {
      const updated = resp?.data?.user;
      if (updated) setUser(updated);
      toast.success('Profile updated');
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error?.message || err?.message || 'Could not update profile'),
  });

  const onField = (key) => (e) => {
    const value = key === 'phone' ? phoneInputDigits(e.target.value) : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const onBlur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));
  const showError = (key) =>
    touched[key] || errors[key] ? errors[key] || liveErrors[key] : undefined;

  const onSaveProfile = (e) => {
    e.preventDefault();
    const allTouched = Object.keys(PROFILE_RULES).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);
    const errs = validateFields(form, PROFILE_RULES);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    saveMut.mutate({
      name: form.name.trim(),
      phone: form.phone.trim() ? normalizePhone(form.phone) : null,
      username: form.username.trim() || null,
    });
  };

  const shopNames = shops.map((s) => s.shop_name || s.name).filter(Boolean);

  return (
    <>
      <PageHeader
        title="Profile"
        description="View and update your account details"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <form className="card p-4 space-y-4" onSubmit={onSaveProfile}>
          <h2 className="text-sm font-bold text-gray-900">Account details</h2>

          <Input
            label="Full name"
            name="name"
            value={form.name}
            onChange={onField('name')}
            onBlur={onBlur('name')}
            error={showError('name')}
            required
            disabled={isLoading || saveMut.isPending}
          />

          <Input
            label="Email"
            name="email"
            value={user?.email || ''}
            readOnly
            disabled
            hint="Email cannot be changed"
          />

          <Input
            label="Login phone"
            name="phone"
            value={form.phone}
            onChange={onField('phone')}
            onBlur={onBlur('phone')}
            error={showError('phone')}
            disabled={isLoading || saveMut.isPending}
            inputMode="numeric"
            maxLength={10}
            required
          />

          <Input
            label="Username"
            name="username"
            value={form.username}
            onChange={onField('username')}
            disabled={isLoading || saveMut.isPending}
            hint="Optional login username"
          />

          <div className="flex justify-end pt-1">
            <Button type="submit" loading={saveMut.isPending} disabled={isLoading}>
              Save changes
            </Button>
          </div>
        </form>

        <div className="card p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Account info</h2>
          <dl>
            <InfoRow
              label="Role"
              value={ROLE_LABELS[user?.role] || user?.role?.replace(/_/g, ' ')}
            />
            <InfoRow
              label="Status"
              value={
                user ? (
                  <Badge tone={user.is_active ? 'green' : 'red'}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                ) : (
                  '—'
                )
              }
            />
            <InfoRow
              label="Assigned shops"
              value={shopNames.length ? shopNames.join(', ') : '—'}
            />
            <InfoRow
              label="Last login"
              value={user?.last_login_at ? formatDateTime(user.last_login_at) : '—'}
            />
            <InfoRow
              label="Member since"
              value={user?.created_at ? formatDateTime(user.created_at) : '—'}
            />
            <InfoRow label="Last device" value={user?.last_device_name} />
          </dl>
        </div>
      </div>
    </>
  );
};

export default ProfilePage;
