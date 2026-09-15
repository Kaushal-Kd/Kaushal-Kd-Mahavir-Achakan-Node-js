import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatInstantDateTime } from '@wrs/shared';
import { MonitorOff, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import Select from '../../../components/ui/Select.jsx';
import { authApi } from '../../../lib/api/auth.js';
import { useAuthStore } from '../../../stores/authStore.js';
import { toast } from '../../../stores/uiStore.js';

import Tab from './_Tab.jsx';

const REVOKE_REASON = 'Revoked from Login User Device settings';

const DevicesTab = () => {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('active');
  const [target, setTarget] = useState(null);
  const [revokeAll, setRevokeAll] = useState(false);
  const role = useAuthStore((state) => state.user?.role);
  const canApprove = ['super_admin', 'shop_admin'].includes(role);
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
    onError: (error) =>
      toast.error(error?.response?.data?.error?.message || 'Could not revoke device'),
  });

  const approvalMutation = useMutation({
    mutationFn: ({ id, approved }) => authApi.setDeviceApproval(id, approved),
    onSuccess: async (_response, variables) => {
      toast.success(
        variables.approved ? 'Device approved for mobile data' : 'Device approval removed'
      );
      await queryClient.invalidateQueries({ queryKey: ['auth-devices'] });
      await queryClient.invalidateQueries({ queryKey: ['shop-ip-policies'] });
    },
    onError: (error) =>
      toast.error(error?.response?.data?.error?.message || 'Could not change device approval'),
  });

  const columns = useMemo(
    () => [
      { key: 'user_name', header: 'User' },
      {
        key: 'device_name',
        header: 'Device',
        render: (row) => row.device_name || 'Unknown device',
      },
      { key: 'ip', header: 'IP address', render: (row) => row.ip || '—' },
      {
        key: 'login_at',
        header: 'Login Date & Time',
        render: (row) => formatInstantDateTime(row.login_at),
      },
      {
        key: 'last_used_at',
        header: 'Last Used',
        render: (row) => formatInstantDateTime(row.last_used_at),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <span className={row.status === 'active' ? 'badge badge-green' : 'badge badge-gray'}>
            {row.status}
          </span>
        ),
      },
      {
        key: 'approval',
        header: 'Mobile data',
        render: (row) => (
          <span className={row.is_approved ? 'badge badge-green' : 'badge badge-gray'}>
            {row.is_approved ? 'Approved' : 'Not approved'}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        render: (row) => (
          <div className="flex flex-wrap gap-2">
            {canApprove ? (
              <Button
                size="sm"
                variant="secondary"
                icon={row.is_approved ? ShieldOff : ShieldCheck}
                loading={approvalMutation.isPending && approvalMutation.variables?.id === row.id}
                onClick={() => approvalMutation.mutate({ id: row.id, approved: !row.is_approved })}
              >
                {row.is_approved ? 'Remove approval' : 'Approve'}
              </Button>
            ) : null}
            {row.status === 'active' ? (
              <Button size="sm" variant="danger" icon={MonitorOff} onClick={() => setTarget(row)}>
                Revoke
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [approvalMutation, canApprove]
  );

  return (
    <Tab
      title="Login User Device"
      description="Approve trusted devices for mobile-data access, or revoke login sessions. Approval is shop-specific."
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
          <Button
            variant="danger"
            icon={MonitorOff}
            disabled={!rows.some((row) => row.status === 'active')}
            onClick={() => setRevokeAll(true)}
          >
            Revoke All
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        loading={query.isLoading}
        emptyTitle="No device sessions"
      />
      <ConfirmDialog
        isOpen={!!target || revokeAll}
        onClose={() => {
          setTarget(null);
          setRevokeAll(false);
        }}
        onConfirm={() => mutation.mutate()}
        title={revokeAll ? 'Revoke all devices?' : 'Revoke this device?'}
        message={
          revokeAll
            ? 'Every active session in this shop scope will be signed out.'
            : `${target?.user_name || 'This user'} will be signed out on ${target?.device_name || 'this device'}.`
        }
        confirmLabel="Revoke"
        danger
        loading={mutation.isPending}
      />
    </Tab>
  );
};

export default DevicesTab;
