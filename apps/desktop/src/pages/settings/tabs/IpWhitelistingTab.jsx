import ShopIpPolicies from './ShopIpPolicies.jsx';
import { useAuthStore } from '../../../stores/authStore.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { Globe2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Select from '../../../components/ui/Select.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import {
  useIpWhitelist,
  useUpdateGlobalIpWhitelist,
  useUpdateUserIpWhitelist,
} from '../../../hooks/api/useIpWhitelist.js';
import { getApiErrorMessage } from '../../../lib/apiError.js';
import { toast } from '../../../stores/uiStore.js';

import Tab, { Section } from './_Tab.jsx';

const MODE_OPTIONS = [
  { value: 'inherit', label: 'Inherit global policy' },
  { value: 'anywhere', label: 'Access from anywhere' },
  { value: 'restricted', label: 'Custom IP allowlist' },
];

const EFFECTIVE_LABELS = {
  unrestricted: 'Unrestricted (global disabled)',
  anywhere: 'Unrestricted by user override',
  user_restricted: 'Restricted by custom allowlist',
  global_restricted: 'Restricted by global allowlist',
};

function cleanRanges(values) {
  return (values || []).map((value) => String(value || '').trim()).filter(Boolean);
}

const IpRangeEditor = ({ values, onChange, maxItems, disabled = false, addLabel = 'Add IP' }) => {
  const rows = values.length ? values : [''];
  const updateAt = (index, value) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };
  const removeAt = (index) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));

  return (
    <div className="space-y-2">
      {rows.map((value, index) => (
        <div key={`${index}-${rows.length}`} className="flex items-start gap-2">
          <Input
            aria-label={`Allowed IP address or CIDR range ${index + 1}`}
            value={value}
            disabled={disabled}
            placeholder="203.0.113.10 or 203.0.113.0/24"
            onChange={(event) => updateAt(index, event.target.value)}
            inputClassName="font-mono text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            icon={Trash2}
            iconOnly
            aria-label={`Remove IP range ${index + 1}`}
            disabled={disabled}
            onClick={() => removeAt(index)}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={Plus}
        disabled={disabled || rows.length >= maxItems}
        onClick={() => onChange([...rows, ''])}
      >
        {addLabel}
      </Button>
      <p className="text-xs text-gray-500">
        Exact IPv4/IPv6 addresses and CIDR ranges are supported. {cleanRanges(rows).length}/
        {maxItems} configured.
      </p>
    </div>
  );
};

IpRangeEditor.propTypes = {
  values: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  maxItems: PropTypes.number.isRequired,
  disabled: PropTypes.bool,
  addLabel: PropTypes.string,
};

const InstallationIpPolicies = () => {
  const query = useIpWhitelist();
  const payload = query.data?.data;
  const [globalEnabled, setGlobalEnabled] = useState(false);
  const [globalRanges, setGlobalRanges] = useState([]);
  const [userDrafts, setUserDrafts] = useState({});

  useEffect(() => {
    if (!payload) return;
    setGlobalEnabled(Boolean(payload.global?.enabled));
    setGlobalRanges(payload.global?.allowed_ranges || []);
    setUserDrafts(
      Object.fromEntries(
        (payload.users || []).map((user) => [
          user.id,
          { mode: user.mode || 'inherit', allowed_ranges: user.allowed_ranges || [] },
        ])
      )
    );
  }, [payload]);

  const globalMutation = useUpdateGlobalIpWhitelist({
    onSuccess: () => toast.success('Global IP policy saved'),
    onError: (error) => toast.error(getApiErrorMessage(error, 'Could not save global IP policy')),
  });
  const userMutation = useUpdateUserIpWhitelist({
    onSuccess: () => toast.success('User IP policy saved'),
    onError: (error) => toast.error(getApiErrorMessage(error, 'Could not save user IP policy')),
  });

  const users = useMemo(() => payload?.users || [], [payload]);
  const addCurrentIp = () => {
    const currentIp = String(payload?.current_ip || '').trim();
    if (!currentIp || globalRanges.includes(currentIp)) return;
    setGlobalRanges((ranges) => [...ranges, currentIp]);
  };
  const updateUserDraft = (userId, patch) => {
    setUserDrafts((drafts) => ({
      ...drafts,
      [userId]: { ...(drafts[userId] || { mode: 'inherit', allowed_ranges: [] }), ...patch },
    }));
  };

  if (query.isLoading) {
    return (
      <Tab title="IP Whitelisting" description="Control CRM access by network location.">
        <div className="card p-8 text-center text-sm text-gray-500">Loading IP policies…</div>
      </Tab>
    );
  }

  if (query.isError) {
    return (
      <Tab title="IP Whitelisting" description="Control CRM access by network location.">
        <div className="card p-6 text-center">
          <p className="text-sm text-red-600">
            {getApiErrorMessage(query.error, 'Could not load IP policies')}
          </p>
          <Button className="mt-3" variant="secondary" onClick={() => query.refetch()}>
            Try again
          </Button>
        </div>
      </Tab>
    );
  }

  return (
    <Tab
      title="IP Whitelisting"
      description="Installation-wide network access controls. Super administrators always retain emergency access."
    >
      <div className="rounded-md border border-brand/20 bg-brand-light px-4 py-3 flex flex-wrap items-center gap-3">
        <Globe2 size={18} className="text-brand" />
        <div>
          <div className="text-xs text-gray-500">Your detected public IP</div>
          <div className="font-mono text-sm font-semibold text-gray-900">
            {payload?.current_ip || 'Unavailable'}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={!payload?.current_ip || globalRanges.includes(payload.current_ip)}
          onClick={addCurrentIp}
        >
          Add to global list
        </Button>
      </div>

      <Section
        title="Global IP policy"
        description="This is the default for every user whose policy is set to Inherit global."
        actions={<ShieldCheck size={20} className="text-brand" />}
      >
        <div className="space-y-4">
          <Toggle
            checked={globalEnabled}
            onChange={setGlobalEnabled}
            label="Enable global IP whitelisting"
            description="Inherited users can access the CRM only from the ranges below."
          />
          <IpRangeEditor
            values={globalRanges}
            onChange={setGlobalRanges}
            maxItems={100}
            disabled={!globalEnabled}
            addLabel="Add global IP"
          />
          <div className="flex justify-end">
            <Button
              loading={globalMutation.isPending}
              onClick={() =>
                globalMutation.mutate({
                  enabled: globalEnabled,
                  allowed_ranges: cleanRanges(globalRanges),
                })
              }
            >
              Save global policy
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="User-specific policies"
        description="A user override takes precedence over the global default."
      >
        {users.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            No non-super-admin users found.
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user) => {
              const draft = userDrafts[user.id] || {
                mode: user.mode || 'inherit',
                allowed_ranges: user.allowed_ranges || [],
              };
              const saving = userMutation.isPending && userMutation.variables?.userId === user.id;
              return (
                <div key={user.id} className="rounded-md border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">{user.name}</h3>
                        <span className={user.is_active ? 'badge badge-green' : 'badge badge-gray'}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span
                          className={
                            user.current_ip_allowed ? 'badge badge-green' : 'badge badge-red'
                          }
                        >
                          {user.current_ip_allowed
                            ? 'Current IP allowed'
                            : 'Current IP would be denied'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      <p className="mt-1 text-xs text-gray-600">
                        {EFFECTIVE_LABELS[user.effective_mode] || user.effective_mode}
                      </p>
                    </div>
                    <div className="w-full sm:w-64">
                      <Select
                        label="Access policy"
                        value={draft.mode}
                        options={MODE_OPTIONS}
                        onChange={(event) =>
                          updateUserDraft(user.id, {
                            mode: event.target.value,
                            allowed_ranges:
                              event.target.value === 'restricted' ? draft.allowed_ranges : [],
                          })
                        }
                      />
                    </div>
                  </div>
                  {draft.mode === 'restricted' ? (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <IpRangeEditor
                        values={draft.allowed_ranges}
                        onChange={(allowedRanges) =>
                          updateUserDraft(user.id, { allowed_ranges: allowedRanges })
                        }
                        maxItems={50}
                        addLabel="Add user IP"
                      />
                    </div>
                  ) : null}
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      loading={saving}
                      disabled={userMutation.isPending && !saving}
                      onClick={() =>
                        userMutation.mutate({
                          userId: user.id,
                          payload: {
                            mode: draft.mode,
                            allowed_ranges:
                              draft.mode === 'restricted' ? cleanRanges(draft.allowed_ranges) : [],
                          },
                        })
                      }
                    >
                      Save user policy
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </Tab>
  );
};

InstallationIpPolicies.propTypes = {};
function IpWhitelistingTab() {
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const shopId = useShopStore((s) => s.selectedShopId);
  const [global, setGlobal] = useState(false);
  return <>
    {role === 'super_admin' && <div className="mb-3 flex flex-wrap gap-2"><Button variant={global ? 'secondary' : 'primary'} onClick={() => setGlobal(false)}>Selected shop policies</Button><Button variant={global ? 'primary' : 'secondary'} onClick={() => setGlobal(true)}>Installation policies</Button></div>}
    {role === 'super_admin' && global ? <InstallationIpPolicies key={userId} /> : <ShopIpPolicies key={userId + ':' + shopId} />}
  </>;
}
IpWhitelistingTab.propTypes = {};
export default IpWhitelistingTab;
