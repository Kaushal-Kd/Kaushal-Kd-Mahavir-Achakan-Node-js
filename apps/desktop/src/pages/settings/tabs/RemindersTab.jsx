import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { remindersApi } from '../../../lib/api/reminders.js';
import {
  datetimeLocalToReminderFields,
  formatReminderDateTime,
  nowReminderDatetimeLocal,
  reminderRowToDatetimeLocal,
} from '../../../lib/reminderDateTime.js';
import { toast } from '../../../stores/uiStore.js';

import Tab, { Section } from './_Tab.jsx';
import IconBtn from '../../configuration/editors/IconBtn.jsx';

const REMINDER_CELL = 'px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis align-middle';

const emptyForm = () => ({
  description: '',
  assignee: '',
  reminder_at: nowReminderDatetimeLocal(),
});

const RemindersTab = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
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
    deleteFn: (row, admin_password) => remindersApi.remove(row.id, { admin_password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      toast.success('Reminder deleted');
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['reminders'],
    queryFn: () => remindersApi.list(),
  });

  const rows = useMemo(() => {
    const arr = data?.data || [];
    return [...arr];
  }, [data]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const description = String(row.description || '').toLowerCase();
      const assignee = String(row.assignee || '').toLowerCase();
      const when = formatReminderDateTime(row.reminder_date, row.reminder_time).toLowerCase();
      return description.includes(term) || assignee.includes(term) || when.includes(term);
    });
  }, [rows, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      description: row.description || '',
      assignee: row.assignee || '',
      reminder_at: reminderRowToDatetimeLocal(row),
    });
    setErr('');
    setModalOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const description = form.description.trim();
      const assignee = form.assignee.trim();
      if (!description) {
        const e = new Error('Description is required');
        e.code = 'LOCAL';
        throw e;
      }
      if (!assignee) {
        const e = new Error('Assignee is required');
        e.code = 'LOCAL';
        throw e;
      }
      const { reminder_date, reminder_time } = datetimeLocalToReminderFields(form.reminder_at);
      const payload = { description, assignee, reminder_date, reminder_time };
      if (editing) return remindersApi.update(editing.id, payload);
      return remindersApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setModalOpen(false);
      toast.success(editing ? 'Reminder updated' : 'Reminder created');
    },
    onError: (e) => {
      if (e.code === 'LOCAL') {
        setErr(e.message);
      } else {
        setErr(e.response?.data?.error?.message || 'Save failed');
      }
    },
  });

  return (
    <Tab
      title="Reminders"
      description="Create reminders with a description, assignee, date, and time."
      actions={
        <Button icon={Plus} size="sm" onClick={openCreate}>
          Create Reminder
        </Button>
      }
    >
      <Section title="Your reminders" padded>
        {isLoading ? (
          <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No reminders yet. Use <span className="font-medium">Create Reminder</span> to add one.
          </p>
        ) : (
          <>
            <div className="relative w-full max-w-sm mb-3">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description, assignee, date…"
                className="input pl-8 h-9 w-full"
                aria-label="Search reminders"
              />
            </div>
            {filteredRows.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No reminders match your search.
              </p>
            ) : (
              <div className="rounded-md border border-gray-200 overflow-x-auto">
                <table className="table w-full text-sm table-fixed min-w-[640px]">
                  <thead>
                    <tr>
                      <th className={`text-left ${REMINDER_CELL} w-[42%]`}>
                        <TableHeaderLabel>Description</TableHeaderLabel>
                      </th>
                      <th className={`text-left ${REMINDER_CELL} w-[22%]`}>
                        <TableHeaderLabel>Assignee</TableHeaderLabel>
                      </th>
                      <th className={`text-left ${REMINDER_CELL} w-[24%]`}>
                        <TableHeaderLabel>Date & time</TableHeaderLabel>
                      </th>
                      <th className={`text-right ${REMINDER_CELL} w-[12%]`}>
                        <TableHeaderLabel align="right">Actions</TableHeaderLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td
                          className={`${REMINDER_CELL} text-gray-900 max-w-0`}
                          title={row.description || ''}
                        >
                          {row.description || '—'}
                        </td>
                        <td
                          className={`${REMINDER_CELL} text-gray-800 max-w-0`}
                          title={row.assignee || ''}
                        >
                          {row.assignee || '—'}
                        </td>
                        <td className={`${REMINDER_CELL} text-gray-800 tabular-nums`}>
                          {formatReminderDateTime(row.reminder_date, row.reminder_time)}
                        </td>
                        <td className={`${REMINDER_CELL} text-right`}>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit reminder' : 'Create Reminder'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button icon={Save} onClick={() => saveMut.mutate()} loading={saveMut.isPending}>
              {editing ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="reminder-description" className="label">
              Description<span className="text-red-500 ml-0.5">*</span>
            </label>
            <textarea
              id="reminder-description"
              rows={4}
              className="input w-full resize-y min-h-[88px]"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What needs to be done?"
            />
          </div>
          <Input
            label="Assignee"
            required
            value={form.assignee}
            onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
            placeholder="e.g. Miraj bhai"
            hint="The person responsible for completing this reminder."
          />
          <Input
            type="datetime-local"
            label="Date & time"
            required
            value={form.reminder_at}
            onChange={(e) => setForm((f) => ({ ...f, reminder_at: e.target.value }))}
          />
          {err ? <p className="text-xs text-red-600">{err}</p> : null}
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Delete reminder"
        description={
          deleting ? (
            <>
              Delete this reminder for{' '}
              <span className="font-semibold">
                {formatReminderDateTime(deleting.reminder_date, deleting.reminder_time)}
              </span>
              ?
            </>
          ) : null
        }
        itemLabel={deleting?.description}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
      />
    </Tab>
  );
};

export default RemindersTab;
