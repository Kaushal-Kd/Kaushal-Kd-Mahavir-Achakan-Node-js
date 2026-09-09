import { shopEmailSettingsSchema } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useEffect, useRef, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Select from '../../../components/ui/Select.jsx';
import { useShopEmailSettings } from '../../../hooks/api/useShopEmailSettings.js';
import { emailSettingsDirty, emailSettingsForm } from '../../../lib/shopEmailSettingsState.js';
import { useAuthStore } from '../../../stores/authStore.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { toast } from '../../../stores/uiStore.js';

function ShopEmailSettingsForm({ shopId, userId, role }) {
  const query = useShopEmailSettings(shopId, userId, role);
  const data = query.data?.data;
  const [form, setForm] = useState(() => emailSettingsForm());
  const [loadedRevision, setLoadedRevision] = useState(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!data || data.shop_id !== shopId || loadedRevision === data.revision) return;
    setForm(emailSettingsForm(data));
    setLoadedRevision(data.revision);
  }, [data, loadedRevision, shopId]);
  const superAdmin = role === 'super_admin';
  const ready = Boolean(
    data && data.shop_id === shopId && loadedRevision === data.revision && !query.isError
  );
  const editable =
    ready &&
    superAdmin &&
    query.online &&
    !query.busy &&
    !query.isFetching &&
    data.encryption_ready;
  const dirty = emailSettingsDirty(form, data);
  const change = (key) => (event) =>
    setForm((previous) => ({
      ...previous,
      [key]: key === 'port' ? Number(event.target.value) : event.target.value,
    }));

  async function submit(event) {
    event.preventDefault();
    if (!editable) return;
    const parsed = shopEmailSettingsSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || 'Check the email settings.');
      return;
    }
    try {
      await query.run('save', parsed.data);
      if (active.current)
        toast.success('Email settings saved for this shop. Send a test and check your inbox.');
    } catch (error) {
      if (active.current)
        toast.error(
          error?.response?.data?.error?.message ||
            error?.message ||
            'Could not save email settings.'
        );
    } finally {
      if (active.current) setForm((previous) => ({ ...previous, password: '' }));
    }
  }

  async function sendTest() {
    if (!editable || dirty || !data?.configured) return;
    try {
      const response = await query.run('test', { expected_revision: data.revision });
      if (active.current) toast.success(response.data.message);
    } catch (error) {
      if (active.current)
        toast.error(
          error?.response?.data?.error?.message || error?.message || 'Could not send test email.'
        );
    }
  }

  return (
    <section className="card space-y-3 p-4" aria-label="Shop email settings">
      <h3 className="text-base font-semibold text-gray-900">Email Settings</h3>
      <p className="text-sm text-gray-600">
        Selected shop: <strong>{data?.shop_name || 'Loading…'}</strong>. These settings send
        administrator password OTPs; they do not change phone login.
      </p>
      {!query.online && (
        <p role="status" className="text-sm text-yellow-800">
          Connect to the server to load, change or test email settings. Passwords are never queued
          offline.
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load this shop’s email settings.{' '}
          <Button
            size="sm"
            variant="secondary"
            disabled={!query.online || query.busy}
            onClick={() => query.refetch()}
          >
            Reload
          </Button>
        </p>
      )}
      {data && (
        <p role="status" className="text-sm text-gray-700">
          {data.status === 'credentials_locked'
            ? 'Saved credentials cannot be unlocked. Contact Super Admin.'
            : data.configured
              ? 'Configured. Inbox delivery still needs to be checked.'
              : 'Not configured for this shop.'}
        </p>
      )}
      {data?.last_test_status && (
        <p className="text-xs text-gray-600">
          Last test:{' '}
          {data.last_test_status === 'accepted'
            ? 'Accepted by email server — check the inbox/spam folder.'
            : 'Failed — review the credentials and connection.'}
        </p>
      )}
      {!superAdmin ? (
        <p className="text-xs text-gray-500">
          Only Super Admin can change credentials or send a configuration test.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3" autoComplete="off">
          {data && !data.encryption_ready && (
            <p role="alert" className="text-sm text-yellow-800">
              The server administrator must configure SHOP_SMTP_ENCRYPTION_KEY before saving
              credentials. This is an encryption key, not an email password.
            </p>
          )}
          <fieldset disabled={!editable} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="SMTP server"
              value={form.host}
              onChange={change('host')}
              placeholder="smtp.example.com"
              maxLength={253}
            />
            <Select
              label="Port / security"
              value={String(form.port)}
              onChange={change('port')}
              options={[
                { value: '587', label: '587 — STARTTLS (required)' },
                { value: '465', label: '465 — TLS' },
              ]}
            />
            <Input
              label="SMTP username"
              value={form.username}
              onChange={change('username')}
              maxLength={320}
              autoComplete="off"
            />
            <Input
              label="Sender email"
              type="email"
              value={form.from_email}
              onChange={change('from_email')}
              maxLength={254}
            />
            <div className="min-w-0 sm:col-span-2">
              <Input
                label="SMTP password / app password"
                type="password"
                value={form.password}
                onChange={change('password')}
                autoComplete="new-password"
                maxLength={4096}
                hint={
                  data?.has_password
                    ? 'A password is saved securely. Leave blank to keep it, or enter a replacement.'
                    : 'Enter the sending email service password; not your app login password.'
                }
              />
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!editable || !dirty} loading={query.busy}>
              Save email settings
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={sendTest}
              disabled={!editable || dirty || !data?.configured}
            >
              Send test email
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!query.online || query.busy}
              onClick={() => {
                setForm(emailSettingsForm(data));
                query.refetch();
              }}
            >
              Discard / reload
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            The test goes only to your registered Super Admin email. Saving does not send an email.
            Updating settings resets the last test result.
          </p>
        </form>
      )}
    </section>
  );
}

ShopEmailSettingsForm.propTypes = {
  shopId: PropTypes.string.isRequired,
  userId: PropTypes.string.isRequired,
  role: PropTypes.string.isRequired,
};

export default function ShopEmailSettingsPanel() {
  const shopId = useShopStore((state) => state.selectedShopId);
  const user = useAuthStore((state) => state.user);
  if (!user || !['super_admin', 'shop_admin'].includes(user.role)) return null;
  if (!shopId)
    return <p className="text-sm text-gray-600">Select a shop to view its email settings.</p>;
  return (
    <ShopEmailSettingsForm
      key={`${shopId}:${user.id}:${user.role}`}
      shopId={shopId}
      userId={user.id}
      role={user.role}
    />
  );
}

ShopEmailSettingsPanel.propTypes = {};
