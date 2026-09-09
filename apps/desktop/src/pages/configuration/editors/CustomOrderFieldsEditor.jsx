import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useMemo, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Select from '../../../components/ui/Select.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { customOrderFieldsApi } from '../../../lib/api/customOrderFields.js';
import { guardedMutate } from '../../../lib/guardedMutate.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

import IconBtn from './IconBtn.jsx';

const emptyForm = {
  label: '',
  field_type: 'number',
  unit: '',
  required: false,
};

const fieldTypeOptions = [
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
];

const CustomOrderFieldsEditor = ({ def }) => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState('');
  const selectedShopName = useSelectedShopName();
  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDelete,
  } = useAdminDelete({
    deleteFn: (row, admin_password) => customOrderFieldsApi.remove(row.id, { admin_password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-order-fields'] });
      toast.success('Field deactivated');
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['custom-order-fields', { includeInactive: true }],
    queryFn: () => customOrderFieldsApi.list({ include_inactive: 'true' }),
  });

  const fields = useMemo(() => {
    const arr = data?.data || [];
    return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [data]);

  const openAdd = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      sort_order: (fields.at(-1)?.sort_order || 0) + 1,
    });
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      label: row.label || '',
      field_type: row.field_type || 'number',
      unit: row.unit || '',
      required: !!row.required,
    });
    setErr('');
    setModalOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        label: String(form.label || '').trim(),
        field_type: form.field_type,
        unit: String(form.unit || '').trim() || null,
        required: !!form.required,
      };
      if (!payload.label) {
        const e = new Error('Label is required');
        e.code = 'LOCAL';
        throw e;
      }
      if (editing) return customOrderFieldsApi.update(editing.id, payload);
      return customOrderFieldsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-order-fields'] });
      setModalOpen(false);
      toast.success(editing ? 'Field updated' : 'Field added');
    },
    onError: (e) => {
      if (e.code === 'LOCAL') {
        setErr(e.message);
        return;
      }
      toast.error(e.response?.data?.error?.message || e?.message || 'Could not save');
    },
  });

  const reorderMut = useMutation({
    mutationFn: (ordered_ids) => customOrderFieldsApi.reorder(ordered_ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-order-fields'] });
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Could not reorder'),
  });

  const moveField = (index, dir) => {
    const next = [...fields];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    reorderMut.mutate(next.map((r) => r.id));
  };

  return (
    <Section title={def?.label || 'Custom order measurements'} description={def?.description}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-gray-600">
          Define measurement fields shown on customized product orders (length, sleeve, neck, etc.).
        </p>
        <Button type="button" variant="primary" size="sm" icon={Plus} onClick={openAdd}>
          Add field
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : fields.length === 0 ? (
        <p className="text-xs text-gray-500">No fields yet. Add your first measurement field.</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="table w-full text-xs">
            <thead>
              <tr>
                <th className="text-left w-16">
                  <TableHeaderLabel>Order</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Label</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Type</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Unit</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Required</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Active</TableHeaderLabel>
                </th>
                <th className="text-right w-28">
                  <TableHeaderLabel align="right">Actions</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fields.map((row, index) => (
                <tr key={row.id} className={row.is_active ? '' : 'opacity-50'}>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-0.5">
                      <IconBtn
                        title="Move up"
                        disabled={index === 0 || reorderMut.isPending}
                        onClick={() => moveField(index, -1)}
                      >
                        <ArrowUp size={14} />
                      </IconBtn>
                      <IconBtn
                        title="Move down"
                        disabled={index === fields.length - 1 || reorderMut.isPending}
                        onClick={() => moveField(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </IconBtn>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 font-medium text-gray-900">{row.label}</td>
                  <td className="px-2 py-1.5 capitalize">{row.field_type}</td>
                  <td className="px-2 py-1.5">{row.unit || '—'}</td>
                  <td className="px-2 py-1.5">{row.required ? 'Yes' : 'No'}</td>
                  <td className="px-2 py-1.5">{row.is_active ? 'Yes' : 'No'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex items-center justify-end gap-0.5">
                      <IconBtn title="Edit" onClick={() => openEdit(row)}>
                        <Pencil size={14} />
                      </IconBtn>
                      {row.is_active ? (
                        <IconBtn
                          title="Deactivate"
                          onClick={() => requestDelete(row)}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </IconBtn>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => !saveMut.isPending && setModalOpen(false)}
        title={editing ? 'Edit measurement field' : 'Add measurement field'}
      >
        <div className="space-y-3">
          <Input
            label="Label"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <Select
            label="Type"
            value={form.field_type}
            onChange={(e) => setForm((f) => ({ ...f, field_type: e.target.value }))}
            options={fieldTypeOptions}
          />
          <Input
            label="Unit (optional)"
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
            placeholder="inch, cm"
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand"
              checked={form.required}
              onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))}
            />
            Required on custom orders
          </label>
          {err ? <p className="text-xs text-red-600">{err}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
              disabled={saveMut.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={saveMut.isPending}
              onClick={() => guardedMutate(saveMut)}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Deactivate field?"
        description="It will be hidden on new orders but existing values are kept."
        itemLabel={deleting?.label}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
        confirmLabel="Deactivate"
      />
    </Section>
  );
};

CustomOrderFieldsEditor.propTypes = {
  def: PropTypes.shape({
    label: PropTypes.string,
    description: PropTypes.string,
  }),
};

export default CustomOrderFieldsEditor;
