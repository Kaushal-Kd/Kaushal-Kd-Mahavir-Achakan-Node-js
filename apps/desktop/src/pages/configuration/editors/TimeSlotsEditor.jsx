import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatOrderTime12, normalizeTime12, parseOrderTimeTo24 } from '@wrs/shared';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Select from '../../../components/ui/Select.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { timeSlotsApi } from '../../../lib/api/timeSlots.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

import IconBtn from './IconBtn.jsx';

const emptySlot = {
  time_value: '9:00 AM',
  sort_order: 0,
};

const TimeSlotsEditor = ({ def }) => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySlot);
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
    deleteFn: (row, admin_password) => timeSlotsApi.remove(row.id, { admin_password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time-slots'] });
      toast.success('Time slot removed');
    },
  });
  const [deliveryDefaultId, setDeliveryDefaultId] = useState('');
  const [returnDefaultId, setReturnDefaultId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['time-slots'],
    queryFn: () => timeSlotsApi.list(),
  });

  const slots = useMemo(() => {
    const arr = data?.data || [];
    return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [data]);

  const serverDeliveryId = data?.defaults?.default_delivery_slot_id ?? '';
  const serverReturnId = data?.defaults?.default_return_slot_id ?? '';

  useEffect(() => {
    setDeliveryDefaultId(serverDeliveryId || '');
    setReturnDefaultId(serverReturnId || '');
  }, [serverDeliveryId, serverReturnId]);

  const slotSelectOptions = useMemo(
    () =>
      slots.map((row) => ({
        value: row.id,
        label: formatOrderTime12(row.time_value),
      })),
    [slots]
  );

  const defaultsDirty =
    (deliveryDefaultId || '') !== (serverDeliveryId || '') ||
    (returnDefaultId || '') !== (serverReturnId || '');

  const openAdd = () => {
    setEditing(null);
    setForm({
      ...emptySlot,
      sort_order: (slots.at(-1)?.sort_order || 0) + 1,
    });
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      time_value: parseOrderTimeTo24(row.time_value) || '09:00',
      sort_order: row.sort_order || 0,
    });
    setErr('');
    setModalOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const time_value = normalizeTime12(form.time_value);
      if (!time_value) {
        const e = new Error('Pick a valid time');
        e.code = 'LOCAL';
        throw e;
      }
      const payload = {
        time_value,
        sort_order: Number(form.sort_order) || 0,
      };
      if (editing) return timeSlotsApi.update(editing.id, payload);
      return timeSlotsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time-slots'] });
      setModalOpen(false);
      toast.success(editing ? 'Time slot updated' : 'Time slot added');
    },
    onError: (e) => {
      if (e.code === 'LOCAL') {
        setErr(e.message);
      } else {
        setErr(e.response?.data?.error?.message || 'Save failed');
      }
    },
  });

  const saveDefaultsMut = useMutation({
    mutationFn: () =>
      timeSlotsApi.updateDefaults({
        default_delivery_slot_id: deliveryDefaultId || null,
        default_return_slot_id: returnDefaultId || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time-slots'] });
      toast.success('Default delivery and return times saved');
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  return (
    <Section
      title={def.label}
      description={def.description}
      actions={
        <Button icon={Plus} size="sm" onClick={openAdd}>
          Create time slot
        </Button>
      }
    >
      {isLoading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
      ) : (
        <>
          <div className="mb-6 rounded-md border border-gray-200 bg-gray-50/80 p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Default times for new bookings</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Used when creating a booking or checking availability. Only one default delivery time
                and one default return time per shop.
              </p>
            </div>
            {slots.length === 0 ? (
              <p className="text-sm text-gray-500">
                Add time slots below, then choose which times to use as defaults.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                <Select
                  label="Default delivery time"
                  value={deliveryDefaultId}
                  onChange={(e) => setDeliveryDefaultId(e.target.value)}
                  options={slotSelectOptions}
                  placeholder="Select delivery time"
                  hint="Pre-filled on Create Booking and Check Availability"
                />
                <Select
                  label="Default return time"
                  value={returnDefaultId}
                  onChange={(e) => setReturnDefaultId(e.target.value)}
                  options={slotSelectOptions}
                  placeholder="Select return time"
                  hint="Pre-filled when return date is set"
                />
              </div>
            )}
            <div className="flex justify-end">
              <Button
                icon={Save}
                size="sm"
                onClick={() => saveDefaultsMut.mutate()}
                loading={saveDefaultsMut.isPending}
                disabled={!defaultsDirty || slots.length === 0}
              >
                Save default times
              </Button>
            </div>
          </div>

          {slots.length === 0 ? (
            <div className="text-sm text-gray-500 py-8 text-center">
              No time slots yet. Delivery and return times use the default half-hour grid until you
              add slots here.
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 overflow-hidden">
              <table className="table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">
                      <TableHeaderLabel>Time</TableHeaderLabel>
                    </th>
                    <th className="text-left">
                      <TableHeaderLabel>Defaults</TableHeaderLabel>
                    </th>
                    <th className="text-right w-36">
                      <TableHeaderLabel align="right">Actions</TableHeaderLabel>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {slots.map((row) => {
                    const tags = [];
                    if (row.is_default_delivery) tags.push('Delivery');
                    if (row.is_default_return) tags.push('Return');
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900 tabular-nums">
                          {formatOrderTime12(row.time_value)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {tags.length ? (
                            <span className="text-brand font-medium">{tags.join(' · ')}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end items-center gap-1">
                            <IconBtn title="Edit" onClick={() => openEdit(row)}>
                              <Pencil size={14} />
                            </IconBtn>
                            <IconBtn
                              title="Delete"
                              onClick={() => requestDelete(row)}
                              className="text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={14} />
                            </IconBtn>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit time slot' : 'Create time slot'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button icon={Save} onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
              {editing ? 'Save' : 'Add'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            type="time"
            label="Time"
            step={300}
            value={form.time_value}
            onChange={(e) => setForm((f) => ({ ...f, time_value: e.target.value }))}
          />
          {err ? <p className="text-xs text-red-600">{err}</p> : null}
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Remove time slot"
        description={
          deleting ? (
            <>
              It will no longer appear in delivery and return time lists.
              {deleting.is_default_delivery || deleting.is_default_return ? (
                <span className="block mt-2 text-amber-700">
                  This slot is a default time — save new defaults after removing it.
                </span>
              ) : null}
            </>
          ) : null
        }
        itemLabel={deleting ? formatOrderTime12(deleting.time_value) : undefined}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
        confirmLabel="Remove"
      />
    </Section>
  );
};

TimeSlotsEditor.propTypes = {
  def: PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    description: PropTypes.string,
  }).isRequired,
};

export default TimeSlotsEditor;
