import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INDIAN_STATE_OPTIONS,
  ORDER_NUMBER_PREFIX_MAX,
  normalizePhone,
  phoneInputDigits,
  validateFields,
} from '@wrs/shared';
import { FilterX, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Button from '../../../components/ui/Button.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import ImageUploader from '../../../components/ui/ImageUploader.jsx';
import TableColumnPicker from '../../../components/ui/TableColumnPicker.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Select from '../../../components/ui/Select.jsx';
import SmartImage from '../../../components/ui/SmartImage.jsx';
import Toggle from '../../../components/ui/Toggle.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { api, unwrap } from '../../../lib/api.js';
import { useAuthStore } from '../../../stores/authStore.js';
import { useShopStore } from '../../../stores/shopStore.js';
import { toast } from '../../../stores/uiStore.js';

import Tab from './_Tab.jsx';
import ShopEmailSettingsPanel from './ShopEmailSettingsPanel.jsx';

const EMPTY_FORM = {
  shop_name: '',
  company_name: '',
  owner_name: '',
  gstin: '',
  pan: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  logo_url: '',
  parent_shop_id: '',
  order_number_prefix: '',
  is_active: true,
};

/**
 * Collects the ids of `rootId` and all of its descendants (shops whose
 * parent_shop_id chain reaches rootId). Used to exclude self + branches
 * from the Parent-shop picker so we can't form a cycle.
 */
function collectDescendantIds(shops, rootId) {
  if (!rootId) return new Set();
  const childrenByParent = new Map();
  for (const s of shops) {
    const arr = childrenByParent.get(s.parent_shop_id) || [];
    arr.push(s.id);
    childrenByParent.set(s.parent_shop_id, arr);
  }
  const out = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    for (const c of childrenByParent.get(id) || []) {
      if (!out.has(c)) {
        out.add(c);
        queue.push(c);
      }
    }
  }
  return out;
}

const RULES = {
  shop_name: { required: true, label: 'Shop name' },
  company_name: { required: true, label: 'Company name' },
  phone: { type: 'phone', label: 'Phone' },
  email: { type: 'email', label: 'Email' },
  gstin: { type: 'gstin', label: 'GSTIN' },
  pan: { type: 'pan', label: 'PAN' },
  pincode: { type: 'pincode', label: 'PIN' },
};

/** Compact default: logo, shop, type, city, status; hide owner, state, phone, GSTIN. */
const SHOPS_TAB_DEFAULT_HIDDEN = ['owner_name', 'state', 'phone', 'gstin'];

const ShopsTab = () => {
  const qc = useQueryClient();
  const authRole = useAuthStore((s) => s.user?.role);
  const isSuper = authRole === 'super_admin';
  const setShops = useShopStore((s) => s.setShops);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [shopSearch, setShopSearch] = useState('');
  const selectedShopName = useSelectedShopName();

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['shops-all'] });
    try {
      const fresh = await api.get('/shops').then(unwrap);
      if (Array.isArray(fresh?.data)) setShops(fresh.data);
    } catch {
      /* non-fatal */
    }
  };

  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error: deleteError,
    clearError: clearDeleteError,
    loading: deleteLoading,
    close: closeDelete,
  } = useAdminDelete({
    deleteFn: (row, admin_password) =>
      api.delete(`/shops/${row.id}`, { data: { admin_password } }).then(unwrap),
    onSuccess: async () => {
      toast.success('Shop deactivated');
      await invalidate();
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['shops-all', shopSearch],
    queryFn: () =>
      api
        .get('/shops', {
          params: { per_page: 200, ...(shopSearch.trim() ? { search: shopSearch.trim() } : {}) },
        })
        .then(unwrap),
  });

  const liveErrors = useMemo(() => validateFields(form, RULES), [form]);

  const handleApiError = (err) => {
    const details = err?.response?.data?.error?.details;
    if (Array.isArray(details)) {
      const fe = {};
      for (const d of details) fe[d.path] = d.message;
      setErrors(fe);
    }
    toast.error(
      err?.response?.data?.message || err?.response?.data?.error?.message || 'Could not save'
    );
  };

  const createMut = useMutation({
    mutationFn: (payload) => api.post('/shops', payload).then(unwrap),
    onSuccess: async () => {
      toast.success('Shop created');
      await qc.invalidateQueries({ queryKey: ['config-bill-numbering'] });
      await invalidate();
      closeModal();
    },
    onError: handleApiError,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => api.put(`/shops/${id}`, payload).then(unwrap),
    onSuccess: async () => {
      toast.success('Shop updated');
      await qc.invalidateQueries({ queryKey: ['config-bill-numbering'] });
      await invalidate();
      closeModal();
    },
    onError: handleApiError,
  });

  const resetValidation = () => {
    setErrors({});
    setTouched({});
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    resetValidation();
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      shop_name: row.shop_name || '',
      company_name: row.company_name || '',
      owner_name: row.owner_name || '',
      gstin: row.gstin || '',
      pan: row.pan || '',
      phone: row.phone || '',
      email: row.email || '',
      address: row.address || '',
      city: row.city || '',
      state: row.state || '',
      pincode: row.pincode || '',
      logo_url: row.logo_url || '',
      parent_shop_id: row.parent_shop_id || '',
      order_number_prefix: row.order_number_prefix || '',
      is_active: !!row.is_active,
    });
    resetValidation();
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
  };

  const onField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const onBlur = (key) => () => setTouched((t) => ({ ...t, [key]: true }));
  const showError = (key) =>
    touched[key] || errors[key] ? errors[key] || liveErrors[key] : undefined;

  const onSubmit = (e) => {
    e.preventDefault();
    const allTouched = Object.keys(RULES).reduce((acc, k) => ({ ...acc, [k]: true }), {});
    setTouched(allTouched);
    const errs = validateFields(form, RULES);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    const payload = { ...form };
    if (payload.gstin) payload.gstin = payload.gstin.toUpperCase();
    if (payload.pan) payload.pan = payload.pan.toUpperCase();
    Object.keys(payload).forEach((k) => {
      if (payload[k] === '') payload[k] = null;
    });
    payload.shop_name = form.shop_name.trim();
    payload.company_name = form.company_name.trim();
    payload.is_active = !!form.is_active;
    if (payload.phone) payload.phone = normalizePhone(payload.phone);

    if (editing) updateMut.mutate({ id: editing.id, payload });
    else createMut.mutate(payload);
  };

  const rows = data?.data || [];

  // Quick id -> shop lookup used to render the "Branch of …" column.
  const shopById = useMemo(() => {
    const m = new Map();
    for (const s of rows) m.set(s.id, s);
    return m;
  }, [rows]);

  // Candidates for the Parent-shop picker: every active shop except
  // (a) the shop currently being edited and (b) all of its descendants.
  const parentOptions = useMemo(() => {
    const blocked = editing ? collectDescendantIds(rows, editing.id) : new Set();
    return rows
      .filter((s) => s.is_active && !blocked.has(s.id))
      .map((s) => ({
        value: s.id,
        label: `${s.shop_name}${s.city ? ` — ${s.city}` : ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows, editing]);

  const allColumns = useMemo(
    () => [
      {
        key: 'logo_url',
        header: '',
        columnPickerLabel: 'Logo',
        width: 52,
        render: (r) => (
          <SmartImage
            src={r.logo_url}
            alt={r.shop_name}
            className="h-9 w-9 rounded-md object-cover border border-gray-200"
          />
        ),
      },
      {
        key: 'shop_name',
        header: 'Shop name',
        columnPickerLabel: 'Shop name',
        render: (r) => (
          <div>
            <div className="font-medium text-gray-900">{r.shop_name}</div>
            <div className="text-xs text-gray-500">{r.company_name}</div>
          </div>
        ),
      },
      {
        key: 'hierarchy',
        header: 'Type',
        columnPickerLabel: 'Type',
        render: (r) => {
          if (!r.parent_shop_id) {
            return <Badge tone="brand">Parent</Badge>;
          }
          const parent = shopById.get(r.parent_shop_id);
          return (
            <div className="flex flex-col">
              <Badge tone="gray">Branch</Badge>
              <span className="text-xs text-gray-500 mt-0.5">of {parent?.shop_name || '—'}</span>
            </div>
          );
        },
      },
      {
        key: 'owner_name',
        header: 'Owner',
        columnPickerLabel: 'Owner',
        render: (r) => r.owner_name || '—',
      },
      { key: 'city', header: 'City', columnPickerLabel: 'City', render: (r) => r.city || '—' },
      { key: 'state', header: 'State', columnPickerLabel: 'State', render: (r) => r.state || '—' },
      { key: 'phone', header: 'Phone', columnPickerLabel: 'Phone', render: (r) => r.phone || '—' },
      {
        key: 'gstin',
        header: 'GSTIN',
        columnPickerLabel: 'GSTIN',
        render: (r) => (r.gstin ? <span className="font-mono text-xs">{r.gstin}</span> : '—'),
      },
      {
        key: 'is_active',
        header: 'Status',
        columnPickerLabel: 'Status',
        render: (r) =>
          r.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>,
      },
      {
        key: 'actions',
        header: '',
        locked: true,
        align: 'right',
        render: (r) => (
          <div className="flex gap-1 justify-end">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              iconOnly
              onClick={() => openEdit(r)}
              aria-label="Edit"
            />
            {isSuper ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                onClick={() => requestDelete(r)}
                aria-label="Delete"
                className="text-red-600 hover:bg-red-50"
              />
            ) : null}
          </div>
        ),
      },
    ],
    [isSuper, openEdit, shopById]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('settings-shops', allColumns, {
    defaultHidden: SHOPS_TAB_DEFAULT_HIDDEN,
  });

  return (
    <Tab
      title="Shops / Branches"
      description="Multi-branch configuration. Add, edit, or deactivate shop locations."
    >
      <ShopEmailSettingsPanel />
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        <p className="font-semibold">How this works</p>
        <p className="mt-1">
          A Shop is an isolated data scope with its own inventory, bill numbering, accounts,
          reports, users, and settings. A Branch links to its parent for organization but keeps
          separate operational data. For two floors at one location, create separate cash payment
          accounts for each counter instead of creating separate shops.
        </p>
      </div>
      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          className="flex-1 min-w-[8rem] outline-none text-xs"
          placeholder="Search shop, company, city, GSTIN…"
          value={shopSearch}
          onChange={(e) => setShopSearch(e.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={FilterX}
          className="h-7 px-1.5 text-[11px]"
          onClick={() => setShopSearch('')}
          disabled={!shopSearch.trim()}
        >
          Clear
        </Button>
        <TableColumnPicker {...pickerProps} />
      </div>

      <div className="flex items-center justify-end mb-3">
        {isSuper ? (
          <Button icon={Plus} onClick={openCreate}>
            Add shop
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={isLoading}
        emptyTitle="No shops yet"
        emptyMessage="Add your first shop to get started."
        visibleCount={rows.length}
        totalCount={rows.length}
        countLabel="shops"
      />

      <Modal
        isOpen={open}
        onClose={closeModal}
        title={editing ? `Edit shop — ${editing.shop_name}` : 'Add shop'}
        size="lg"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={closeModal}
              disabled={createMut.isPending || updateMut.isPending}
            >
              Cancel
            </Button>
            <Button onClick={onSubmit} loading={createMut.isPending || updateMut.isPending}>
              {editing ? 'Save changes' : 'Create shop'}
            </Button>
          </>
        }
      >
        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3" noValidate>
          <div className="col-span-2">
            <ImageUploader
              value={form.logo_url}
              onChange={(url) => setForm((f) => ({ ...f, logo_url: url }))}
              folder="shop-logos"
              label="Shop logo"
              hint="PNG / JPG / WEBP · optimized to max 700 KB · shown on bills"
            />
          </div>
          <div className="col-span-2">
            <Select
              label="Parent shop"
              value={form.parent_shop_id || ''}
              onChange={onField('parent_shop_id')}
              hint={
                form.parent_shop_id
                  ? 'This shop is a branch of the selected parent (HQ).'
                  : 'Leave empty if this shop is itself a parent. Pick an existing shop to make this one its branch.'
              }
            >
              <option value="">— None (this shop is a Parent) —</option>
              {parentOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label="Shop name"
            required
            value={form.shop_name}
            onChange={onField('shop_name')}
            onBlur={onBlur('shop_name')}
            error={showError('shop_name')}
          />
          <Input
            label="Company name"
            required
            value={form.company_name}
            onChange={onField('company_name')}
            onBlur={onBlur('company_name')}
            error={showError('company_name')}
          />
          <Input
            label="Bill number prefix"
            value={form.order_number_prefix}
            onChange={onField('order_number_prefix')}
            hint={`Optional. Letters and numbers only, max ${ORDER_NUMBER_PREFIX_MAX}. Empty = default O. Bill format is set under Configuration → Bill numbering.`}
            placeholder="e.g. KUV"
          />
          <Input label="Owner name" value={form.owner_name} onChange={onField('owner_name')} />
          <Input
            label="Phone"
            inputMode="numeric"
            maxLength={10}
            placeholder="10-digit mobile"
            value={form.phone}
            onChange={(e) =>
              onField('phone')({ target: { value: phoneInputDigits(e.target.value) } })
            }
            onBlur={onBlur('phone')}
            error={showError('phone')}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={onField('email')}
            onBlur={onBlur('email')}
            error={showError('email')}
          />
          <Input
            label="GSTIN"
            value={form.gstin}
            onChange={(e) => onField('gstin')({ target: { value: e.target.value.toUpperCase() } })}
            onBlur={onBlur('gstin')}
            error={showError('gstin')}
            hint="15 characters — e.g. 22AAAAA0000A1Z5"
            maxLength={15}
          />
          <Input
            label="PAN"
            value={form.pan}
            onChange={(e) => onField('pan')({ target: { value: e.target.value.toUpperCase() } })}
            onBlur={onBlur('pan')}
            error={showError('pan')}
            hint="10 characters — e.g. AAAAA9999A"
            maxLength={10}
          />
          <Input
            label="Pincode"
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={onField('pincode')}
            onBlur={onBlur('pincode')}
            error={showError('pincode')}
          />
          <Input label="City" value={form.city} onChange={onField('city')} />
          <Select
            label="State"
            value={form.state}
            onChange={onField('state')}
            options={INDIAN_STATE_OPTIONS}
            placeholder="Select a state…"
          />
          <div className="col-span-2">
            <label htmlFor="shop-address" className="label">
              Address
            </label>
            <textarea
              id="shop-address"
              className="input"
              rows={2}
              value={form.address}
              onChange={onField('address')}
            />
          </div>
          <div className="col-span-2">
            <Toggle
              checked={!!form.is_active}
              onChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              label="Active"
              description="Appears in listings and can take new orders"
            />
          </div>
        </form>
      </Modal>

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Deactivate shop"
        description="Historical data is preserved and you can reactivate later."
        itemLabel={deleting?.shop_name}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
        confirmLabel="Deactivate"
      />
    </Tab>
  );
};

export default ShopsTab;
