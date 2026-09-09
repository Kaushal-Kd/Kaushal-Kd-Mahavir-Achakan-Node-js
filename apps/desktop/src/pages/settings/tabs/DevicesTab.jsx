import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInstantDateTime } from '@wrs/shared';
import { MonitorOff, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import Select from '../../../components/ui/Select.jsx';
import { authApi } from '../../../lib/api/auth.js';
import { toast } from '../../../stores/uiStore.js';

import Tab from './_Tab.jsx';

const REVOKE_REASON = 'Revoked from Login User Device settings';

const DevicesTab = () => {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [target, setTarget] = useState(null);
  const [revokeAll, setRevokeAll] = useState(false);
  const query = useQuery({
    queryKey: ['auth-devices', status],
    queryFn: () => authApi.listDevices({ status }),
  });
  const payload = query.data?.data || {};
  const rows = payload.rows || [];

  const mutation = useMutation({
    mutationFn: async () => {
      if (revokeAll) return authApi.revokeAllDevices({ reason: REVOKE_REASON });
      return authApi.revokeDevice(target.id, { reason: REVOKE_REASON });
    },
    onSuccess: async () => {
      toast.success(revokeAll ? 'All visible shop sessions revoked' : 'Device session revoked');
      setTarget(null);
      setRevokeAll(false);
      await queryClient.invalidateQueries({ queryKey: ['auth-devices'] });
    },
    onError: (error) => toast.error(error?.response?.data?.error?.message || 'Could not revoke device'),
  });

  const columns = useMemo(
    () => [
      { key: 'user_name', header: 'User' },
      { key: 'device_name', header: 'Device', render: (row) => row.device_name || 'Unknown device' },
      { key: 'ip', header: 'IP address', render: (row) => row.ip || '—' },
      { key: 'login_at', header: 'Login Date & Time', render: (row) => formatInstantDateTime(row.login_at) },
      { key: 'last_used_at', header: 'Last Used', render: (row) => formatInstantDateTime(row.last_used_at) },
      { key: 'status', header: 'Status', render: (row) => <span className={row.status === 'active' ? 'badge badge-green' : 'badge badge-gray'}>{row.status}</span> },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => row.status === 'active' ? (
          <Button size="sm" variant="danger" icon={MonitorOff} onClick={() => setTarget(row)}>
            Revoke
          </Button>
        ) : '—',
      },
    ],
    []
  );

  return (
    <Tab
      title="Login User Device"
      description="View active and revoked device sessions for users who can access this shop. Revocation takes effect immediately."
      actions={
        <>
          <div className="w-40">
            <Select
              aria-label="Device status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'revoked', label: 'Revoked' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          <Button variant="secondary" icon={RefreshCw} onClick={() => query.refetch()}>
            Refresh
          </Button>
          <Button variant="danger" icon={MonitorOff} disabled={!rows.some((row) => row.status === 'active')} onClick={() => setRevokeAll(true)}>
            Revoke All
          </Button>
        </>
      }
    >
      <DataTable columns={columns} rows={rows} loading={query.isLoading} emptyTitle="No device sessions" />
      <ConfirmDialog
        isOpen={!!target || revokeAll}
        onClose={() => { setTarget(null); setRevokeAll(false); }}
        onConfirm={() => mutation.mutate()}
        title={revokeAll ? 'Revoke all devices?' : 'Revoke this device?'}
        message={revokeAll ? 'Every active session in this shop scope will be signed out.' : `${target?.user_name || 'This user'} will be signed out on ${target?.device_name || 'this device'}.`}
        confirmLabel="Revoke"
        danger
        loading={mutation.isPending}
      />
    </Tab>
  );
};

export default DevicesTab;
