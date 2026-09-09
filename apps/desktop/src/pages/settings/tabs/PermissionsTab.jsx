import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, ROLES } from '@wrs/shared';
import { RotateCcw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import PermissionMatrix, {
  permissionMatrixEqual,
  titleizePermission,
} from '../../../components/permissions/PermissionMatrix.jsx';
import Button from '../../../components/ui/Button.jsx';
import ConfirmDialog from '../../../components/ui/ConfirmDialog.jsx';
import Select from '../../../components/ui/Select.jsx';
import { api, unwrap } from '../../../lib/api.js';
import { canEditLoadedRolePermissions, permissionEditorScope } from '../../../lib/permissionEditorState.js';
import { useAuthStore } from '../../../stores/authStore.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { toast } from '../../../stores/uiStore.js';

import Tab, { Section } from './_Tab.jsx';

const roleLabel = (r) => ROLE_LABELS[r] || titleizePermission(r);

const PermissionsTab = () => {
  const qc = useQueryClient();
  const authRole = useAuthStore((s) => s.user?.role);
  const selectedShopId = useShopStore((s) => s.selectedShopId);
  const isAdmin = ['super_admin', 'shop_admin'].includes(authRole);

  const [role, setRole] = useState(ROLES.SALESMAN);
  const [grid, setGrid] = useState({});
  const [draftScope, setDraftScope] = useState('');
  const [resetOpen, setResetOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['role-permissions', selectedShopId],
    queryFn: () => api.get('/roles/permissions').then(unwrap),
    enabled: Boolean(selectedShopId),
  });

  const roleList = data?.meta?.roles || Object.values(ROLES);
  const currentServer = useMemo(() => data?.data?.[role] || null, [data, role]);
  const currentScope = permissionEditorScope(selectedShopId, role);

  useEffect(() => {
    setGrid(currentServer ? JSON.parse(JSON.stringify(currentServer)) : {});
    setDraftScope(currentServer ? currentScope : '');
  }, [currentScope, currentServer]);

  const isDirty = useMemo(
    () => !permissionMatrixEqual(grid, currentServer),
    [grid, currentServer]
  );

  const isAdminRole = [ROLES.SUPER_ADMIN, ROLES.SHOP_ADMIN].includes(role);
  const canEdit = canEditLoadedRolePermissions({ shopId: selectedShopId, role, authRole, currentServer,
    draftScope, loading: isLoading, error: isError });

  const saveMut = useMutation({
    mutationFn: (payload) => {
      if (!canEdit) throw new Error('Load this shop and role before saving permissions.');
      return api.put(`/roles/permissions/${role}`, { permissions: payload }).then(unwrap);
    },
    onSuccess: async () => {
      toast.success(`Saved permissions for ${roleLabel(role)}`);
      await qc.invalidateQueries({ queryKey: ['role-permissions', selectedShopId] });
    },
    onError: (err) =>
      toast.error(
        err?.response?.data?.message ||
          err?.response?.data?.error?.message ||
          err?.message ||
          'Could not save permissions'
      ),
  });

  const resetMut = useMutation({
    mutationFn: () => {
      if (!canEdit) throw new Error('Load this shop and role before resetting permissions.');
      return api.post(`/roles/permissions/${role}/reset`).then(unwrap);
    },
    onSuccess: async () => {
      toast.success(`${roleLabel(role)} reset to defaults`);
      setResetOpen(false);
      await qc.invalidateQueries({ queryKey: ['role-permissions', selectedShopId] });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || 'Could not reset');
      setResetOpen(false);
    },
  });

  return (
    <Tab
      title="Set Menu Permission"
      description="Default permissions per role. Override an individual user from Master → Users → Edit → Permissions."
      actions={
        canEdit ? (
          <>
            <Button
              variant="ghost"
              icon={RotateCcw}
              onClick={() => setResetOpen(true)}
              disabled={saveMut.isPending || resetMut.isPending}
            >
              Reset to defaults
            </Button>
            <Button
              icon={Save}
              onClick={() => saveMut.mutate(grid)}
              loading={saveMut.isPending}
              disabled={!isDirty || resetMut.isPending}
            >
              Save changes
            </Button>
          </>
        ) : null
      }
    >
      <Section padded={false} className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="permission-role" className="text-sm text-gray-700 whitespace-nowrap">Role</label>
            <Select
              id="permission-role"
              value={role}
              disabled={saveMut.isPending || resetMut.isPending}
              onChange={(e) => setRole(e.target.value)}
              options={roleList.map((r) => ({ value: r, label: roleLabel(r) }))}
              className="min-w-[220px]"
            />
          </div>
        </div>

        {isAdminRole ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Administrator roles always have full access. This row is read-only.
          </div>
        ) : !isAdmin ? (
          <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            Only Super Admins and Shop Admins can edit this shop&apos;s role matrix.
          </div>
        ) : isDirty ? (
          <div className="mt-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-brand">
            You have unsaved changes for {roleLabel(role)}.
          </div>
        ) : null}
      </Section>

      {isError ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Permissions could not be loaded for this shop. Editing is disabled to protect the existing settings.
          <Button size="sm" variant="secondary" onClick={() => void refetch()} className="ml-2">Retry</Button>
        </div>
      ) : null}

      <div className="card p-0 overflow-hidden">
        <PermissionMatrix
          grid={draftScope === currentScope ? grid : {}}
          onChange={setGrid}
          editable={canEdit && !saveMut.isPending && !resetMut.isPending}
          forceAllOn={isAdminRole}
          loading={isLoading}
        />
      </div>

      <p className="text-xs text-gray-500">
        Tip: code-level baselines live in <code>defaultPermissionsByRole()</code>{' '}
        (<code>@wrs/shared</code>). Saved role permissions apply to new users and existing
        users who inherit this role in the selected shop. Individual user overrides
        are preserved; Super Admin can edit them from Users → Edit.
      </p>

      <ConfirmDialog
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => resetMut.mutate()}
        title={`Reset ${roleLabel(role)} to defaults?`}
        message="This restores the built-in defaults for inherited users in the selected shop. Individual user overrides are not changed."
        confirmLabel="Reset"
        danger
        loading={resetMut.isPending}
      />
    </Tab>
  );
};

export default PermissionsTab;
