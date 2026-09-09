import { useEffect, useState } from 'react';
import { shopIpCommandSchema } from '@wrs/shared';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Select from '../../../components/ui/Select.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import { useSaveShopIpPolicy, useShopIpPolicies } from '../../../hooks/api/useShopIpPolicies.js';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus.js';
import { getApiErrorMessage } from '../../../lib/apiError.js';
import { syncService } from '../../../services/syncService.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { toast } from '../../../stores/uiStore.js';
import Tab, { Section } from './_Tab.jsx';

const splitRanges = (text) =>
  String(text)
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
const options = [
  { value: 'inherit', label: 'Inherit shop policy' },
  { value: 'anywhere', label: 'No additional shop restriction' },
  { value: 'restricted', label: 'Custom shop IP allowlist' },
];

export default function ShopIpPolicies() {
  const shopId = useShopStore((s) => s.selectedShopId);
  const query = useShopIpPolicies();
  const online = useOnlineStatus();
  const data = query.data?.data;
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (data)
      setDraft({
        revision: data.revision,
        enabled: data.enabled,
        ranges: data.allowed_ranges.join(', '),
        users: Object.fromEntries(
          data.users.map((u) => [u.id, { mode: u.mode, ranges: u.allowed_ranges.join(', ') }])
        ),
      });
  }, [data]);
  useEffect(
    () =>
      syncService.subscribe((state) =>
        setPending(state.entries.some((e) => e.entity === 'shop_ip_command'))
      ),
    []
  );
  const save = useSaveShopIpPolicy({
    onSuccess: (result) =>
      toast.success(
        result.queued
          ? 'IP change saved locally. Pending sync; effective access has not changed.'
          : 'Shop IP policy saved'
      ),
    onError: (error) => toast.error(getApiErrorMessage(error, 'Could not save IP policy')),
  });
  const submit = (policy) => {
    const body = shopIpCommandSchema.safeParse({
      policy,
      expected_revision: draft.revision,
      idempotency_key: syncService.createIdempotencyKey(),
    });
    if (!body.success) {
      toast.error(body.error.issues[0].message);
      return;
    }
    save.mutate({ shopId, body: body.data });
  };
  const disabled = !draft || query.isFetching || query.isError || save.isPending || pending;
  return (
    <Tab
      title="Shop IP Whitelisting"
      description="Manage this shop and its members. Installation-level restrictions still apply. Super Admin retains recovery access."
    >
      {query.isError && (
        <div role="alert" className="card p-4 text-red-700">
          {getApiErrorMessage(query.error, 'Could not load shop IP policies')}{' '}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      )}
      {!data || !draft ? (
        <p className="p-4 text-sm text-gray-600">
          {query.isLoading ? 'Loading shop policies…' : 'Connect to load this shop’s policies.'}
        </p>
      ) : (
        <>
          <div className="card p-3 text-sm">
            Your detected IP: <strong className="font-mono">{data.current_ip}</strong>
            {!online && <p>Offline: changes will remain pending until validated by the server.</p>}
            {pending && (
              <p className="text-brand">
                An IP change is pending. Resolve it in the sync queue before making another change.
              </p>
            )}
          </div>
          <Section
            title="Shop default"
            description="Inherited members must connect from an allowed address when enabled."
          >
            <Toggle
              label="Enable shop IP restrictions"
              checked={draft.enabled}
              onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
            />
            <Input
              label="Allowed IP addresses / CIDR ranges, separated by commas"
              value={draft.ranges}
              onChange={(e) => setDraft((d) => ({ ...d, ranges: e.target.value }))}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!online || disabled}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    ranges: [...new Set([...splitRanges(d.ranges), data.current_ip])].join(', '),
                  }))
                }
              >
                Add current IP
              </Button>
              <Button
                disabled={disabled}
                loading={save.isPending}
                onClick={() =>
                  submit({
                    kind: 'shop',
                    enabled: draft.enabled,
                    allowed_ranges: splitRanges(draft.ranges),
                  })
                }
              >
                Save shop policy
              </Button>
            </div>
          </Section>
          <Section
            title="User policies"
            description="These overrides affect only this shop. They cannot override an installation-level denial."
          >
            <div className="space-y-3">
              {data.users.map((user) => {
                const row = draft.users[user.id];
                if (!row) return null;
                const patch = (value) =>
                  setDraft((d) => ({
                    ...d,
                    users: { ...d.users, [user.id]: { ...d.users[user.id], ...value } },
                  }));
                return (
                  <div className="card p-4" key={user.id}>
                    <div className="mb-3 flex flex-wrap justify-between gap-2">
                      <strong>{user.name}</strong>
                      <span
                        className={`text-xs ${user.effective.allowed ? 'text-green-700' : 'text-red-700'}`}
                      >
                        {user.effective.allowed ? 'Current IP allowed' : 'Current IP denied'}
                      </span>
                    </div>
                    <Select
                      label="Access in this shop"
                      value={row.mode}
                      options={options}
                      onChange={(e) => patch({ mode: e.target.value })}
                    />
                    {row.mode === 'restricted' && (
                      <Input
                        label="Allowed IP addresses / CIDR ranges, separated by commas"
                        value={row.ranges}
                        onChange={(e) => patch({ ranges: e.target.value })}
                      />
                    )}
                    <Button
                      className="mt-3"
                      disabled={disabled}
                      onClick={() =>
                        submit({
                          kind: 'user',
                          user_id: user.id,
                          mode: row.mode,
                          allowed_ranges: row.mode === 'restricted' ? splitRanges(row.ranges) : [],
                        })
                      }
                    >
                      Save user policy
                    </Button>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}
    </Tab>
  );
}
ShopIpPolicies.propTypes = {};
