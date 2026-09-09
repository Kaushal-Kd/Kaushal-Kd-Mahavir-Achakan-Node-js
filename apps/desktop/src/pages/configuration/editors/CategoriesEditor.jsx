import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency } from '@wrs/shared';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Link2,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../../components/ui/TableHeaderLabel.jsx';
import Select from '../../../components/ui/Select.jsx';
import { useAdminDelete } from '../../../hooks/useAdminDelete.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { categoriesApi } from '../../../lib/api/categories.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

import IconBtn from './IconBtn.jsx';

const emptyCategory = {
  label: '',
  category_type: 'product',
  sort_order: 0,
  is_active: true,
  is_washable: false,
  dc_price: 0,
};

const CategoriesEditor = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyCategory);
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
    deleteFn: (row, admin_password) => categoriesApi.remove(row.id, { admin_password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      toast.success('Category removed');
    },
  });
  const [activeType, setActiveType] = useState('product');
  const [search, setSearch] = useState('');
  const [mappingCategory, setMappingCategory] = useState(null);
  const [mappingIds, setMappingIds] = useState([]);

  const { data, isLoading } = useQuery({
    queryKey: ['categories', activeType],
    queryFn: () => categoriesApi.list({ type: activeType }),
  });
  const cats = useMemo(() => {
    const arr = data?.data || [];
    return [...arr].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [data]);
  const searching = search.trim().length > 0;
  const filteredCats = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cats;
    return cats.filter((c) => String(c.label || '').toLowerCase().includes(term));
  }, [cats, search]);
  const { data: accessoryCategoriesRes } = useQuery({
    queryKey: ['categories', 'accessory', 'for-product-mapping'],
    queryFn: () => categoriesApi.list({ type: 'accessory' }),
  });
  const accessoryCategories = accessoryCategoriesRes?.data || [];

  const openAdd = () => {
    setEditing(null);
    setForm({
      ...emptyCategory,
      category_type: activeType,
      sort_order: (cats.at(-1)?.sort_order || 0) + 1,
    });
    setErr('');
    setModalOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      label: c.label || '',
      category_type: c.category_type || 'product',
      sort_order: c.sort_order || 0,
      is_active: !!c.is_active,
      is_washable: !!c.is_washable,
      dc_price: Number(c.dc_price || 0),
    });
    setErr('');
    setModalOpen(true);
  };
  const openMapping = async (c) => {
    setMappingCategory(c);
    setMappingIds(Array.isArray(c.accessory_category_ids) ? c.accessory_category_ids : []);
    try {
      const res = await categoriesApi.getAccessoryCategoryMapping(c.id);
      setMappingIds(Array.isArray(res?.data?.accessory_category_ids) ? res.data.accessory_category_ids : []);
    } catch (e) {
      toast.error(e?.response?.data?.error?.message || 'Could not load mapped accessory categories');
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        label: form.label.trim(),
        category_type: form.category_type || 'product',
        sort_order: Number(form.sort_order) || 0,
        is_active: !!form.is_active,
        is_washable: !!form.is_washable,
        dc_price: Number(form.dc_price) || 0,
      };
      if (!payload.label) {
        const e = new Error('Name is required');
        e.code = 'LOCAL';
        throw e;
      }
      if (editing) return categoriesApi.update(editing.id, payload);
      return categoriesApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      setModalOpen(false);
      toast.success(editing ? 'Category updated' : 'Category added');
    },
    onError: (e) => {
      if (e.code === 'LOCAL') {
        setErr(e.message);
      } else {
        setErr(e.response?.data?.error?.message || 'Save failed');
      }
    },
  });

  const reorderMut = useMutation({
    mutationFn: ({ id, sort_order }) => categoriesApi.update(id, { sort_order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const mappingMut = useMutation({
    mutationFn: ({ categoryId, accessory_category_ids }) =>
      categoriesApi.updateAccessoryCategoryMapping(categoryId, { accessory_category_ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      toast.success('Accessory category mapping saved');
      setMappingCategory(null);
      setMappingIds([]);
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error?.message || 'Could not save mapping');
    },
  });

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= cats.length) return;
    const a = cats[idx];
    const b = cats[j];
    const so = a.sort_order;
    reorderMut.mutate({ id: a.id, sort_order: b.sort_order });
    reorderMut.mutate({ id: b.id, sort_order: so });
  };

  return (
    <Section
      title="Categories"
      description="Each product belongs to a category. Changes take effect immediately."
      actions={
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              className={`px-2.5 py-1 text-xs rounded ${
                activeType === 'product' ? 'bg-white text-brand shadow-sm' : 'text-gray-600'
              }`}
              onClick={() => setActiveType('product')}
            >
              Product
            </button>
            <button
              type="button"
              className={`px-2.5 py-1 text-xs rounded ${
                activeType === 'accessory' ? 'bg-white text-brand shadow-sm' : 'text-gray-600'
              }`}
              onClick={() => setActiveType('accessory')}
            >
              Accessory
            </button>
          </div>
          <Button icon={Plus} size="sm" onClick={openAdd}>
            Add category
          </Button>
        </div>
      }
    >
      {cats.length > 0 ? (
        <div className="relative w-full max-w-sm mb-3">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories…"
            className="input pl-8 h-9 w-full"
            aria-label="Search categories"
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
      ) : cats.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center">
          No categories yet. Click <span className="font-medium">Add category</span> to create one.
        </div>
      ) : filteredCats.length === 0 ? (
        <div className="text-sm text-gray-500 py-8 text-center">
          No categories match “{search.trim()}”.
        </div>
      ) : (
        <div className="rounded-md border border-gray-200 overflow-hidden">
          <table className="table w-full text-sm">
            <thead>
              <tr>
                <th className="text-left w-10">
                  <TableHeaderLabel nowrap>#</TableHeaderLabel>
                </th>
                <th className="text-left">
                  <TableHeaderLabel>Name</TableHeaderLabel>
                </th>
                {activeType === 'product' ? (
                  <th className="text-left">
                    <TableHeaderLabel>Accessory Categories</TableHeaderLabel>
                  </th>
                ) : null}
                <th className="text-left w-28">
                  <TableHeaderLabel>Is Washable</TableHeaderLabel>
                </th>
                <th className="text-right w-28">
                  <TableHeaderLabel align="right">DC Price</TableHeaderLabel>
                </th>
                <th className="text-left w-24">
                  <TableHeaderLabel>Status</TableHeaderLabel>
                </th>
                <th className="text-right w-44">
                  <TableHeaderLabel align="right">Actions</TableHeaderLabel>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredCats.map((c) => {
                // Reorder acts on the full list, so a filtered row still needs
                // its real position — a filtered index would swap the wrong rows.
                const idx = cats.indexOf(c);
                return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400">
                    <div className="flex items-center gap-1">
                      <GripVertical size={12} className="text-gray-300" />
                      <span className="font-mono text-xs">{idx + 1}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900">{c.label}</td>
                  {activeType === 'product' ? (
                    <td className="px-3 py-2">
                      {Array.isArray(c.accessory_categories) && c.accessory_categories.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.accessory_categories.map((item) => (
                            <span
                              key={item.id}
                              className="inline-flex items-center rounded border border-brand/30 bg-brand-light/30 px-1.5 py-0.5 text-[11px] text-brand"
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">None mapped</span>
                      )}
                    </td>
                  ) : null}
                  <td className="px-3 py-2">{c.is_washable ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(Number(c.dc_price || 0))}</td>
                  <td className="px-3 py-2">
                    {c.is_active ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="gray">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end items-center gap-1">
                      <IconBtn
                        title={searching ? 'Clear the search to reorder' : 'Move up'}
                        onClick={() => move(idx, -1)}
                        disabled={searching || idx === 0}
                      >
                        <ArrowUp size={14} />
                      </IconBtn>
                      <IconBtn
                        title={searching ? 'Clear the search to reorder' : 'Move down'}
                        onClick={() => move(idx, 1)}
                        disabled={searching || idx === cats.length - 1}
                      >
                        <ArrowDown size={14} />
                      </IconBtn>
                      <IconBtn title="Edit" onClick={() => openEdit(c)}>
                        <Pencil size={14} />
                      </IconBtn>
                      {activeType === 'product' ? (
                        <IconBtn title="Map accessory categories" onClick={() => openMapping(c)}>
                          <Link2 size={14} />
                        </IconBtn>
                      ) : null}
                      <IconBtn
                        title="Remove"
                        onClick={() => requestDelete(c)}
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

      <Modal
        isOpen={!!mappingCategory}
        onClose={() => {
          setMappingCategory(null);
          setMappingIds([]);
        }}
        title={mappingCategory ? `Map Accessory Categories · ${mappingCategory.label}` : 'Map Accessory Categories'}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setMappingCategory(null);
                setMappingIds([]);
              }}
            >
              Cancel
            </Button>
            <Button
              icon={Save}
              onClick={() =>
                mappingMut.mutate({
                  categoryId: mappingCategory.id,
                  accessory_category_ids: mappingIds,
                })
              }
              loading={mappingMut.isPending}
            >
              Save mapping
            </Button>
          </>
        }
      >
        {accessoryCategories.length === 0 ? (
          <div className="text-sm text-gray-500">
            No accessory categories found. Create accessory categories first.
          </div>
        ) : (
          <div className="max-h-72 overflow-auto rounded-md border border-gray-200 p-2.5 space-y-1.5">
            {accessoryCategories.map((c) => {
              const checked = mappingIds.includes(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-brand focus:ring-brand"
                    checked={checked}
                    onChange={(e) => {
                      setMappingIds((prev) => {
                        const arr = Array.isArray(prev) ? prev : [];
                        if (e.target.checked) {
                          if (arr.includes(c.id)) return arr;
                          return [...arr, c.id];
                        }
                        return arr.filter((id) => id !== c.id);
                      });
                    }}
                  />
                  <span>{c.label}</span>
                </label>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit category' : 'Add category'}
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
            label="Category name"
            required
            placeholder="e.g. Sherwani"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          />
          <Input
            type="number"
            label="Sort order"
            value={form.sort_order}
            onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
          />
          <Select
            label="Is Washable"
            value={form.is_washable ? 'true' : 'false'}
            onChange={(e) =>
              setForm((f) => ({ ...f, is_washable: e.target.value === 'true' }))
            }
            options={[
              { value: 'true', label: 'Yes' },
              { value: 'false', label: 'No' },
            ]}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            label="DC Price"
            value={form.dc_price}
            onChange={(e) => setForm((f) => ({ ...f, dc_price: e.target.value }))}
          />
          <Select
            label="Category type"
            value={form.category_type}
            onChange={(e) => setForm((f) => ({ ...f, category_type: e.target.value }))}
            options={[
              { value: 'product', label: 'Product' },
              { value: 'accessory', label: 'Accessory' },
            ]}
          />
          {err ? <p className="text-xs text-red-600">{err}</p> : null}
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        title="Remove category"
        description="Existing products keep their reference but the category won't be available to new ones."
        itemLabel={deleting?.label}
        shopName={selectedShopName}
        errorMessage={deleteError}
        onClearError={clearDeleteError}
        loading={deleteLoading}
        confirmLabel="Remove"
      />
    </Section>
  );
};

export default CategoriesEditor;
