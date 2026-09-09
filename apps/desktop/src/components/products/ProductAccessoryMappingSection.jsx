import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Save, X } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import { accessoriesApi } from '../../lib/api/accessories.js';
import { guardedMutate } from '../../lib/guardedMutate.js';
import { productsApi } from '../../lib/api/products.js';
import { toast } from '../../stores/uiStore.js';
import Button from '../ui/Button.jsx';
import Input from '../ui/Input.jsx';

/**
 * Per-product accessory mapping — saved to product_accessories and auto-added on booking.
 * Edit mode: pass productId. Draft mode (Create Product): pass value + onChange.
 */
const ProductAccessoryMappingSection = ({ productId, value, onChange }) => {
  const queryClient = useQueryClient();
  const isDraft = !productId;
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [mapped, setMapped] = useState([]);

  const mappingQuery = useQuery({
    queryKey: ['product-accessory-mapping', productId],
    queryFn: () => productsApi.getAccessoryMapping(productId).then((r) => r.data),
    enabled: !!productId,
  });

  useEffect(() => {
    if (isDraft) {
      setMapped(Array.isArray(value) ? value : []);
      return;
    }
    const rows = mappingQuery.data?.accessories;
    if (Array.isArray(rows)) {
      setMapped(
        rows.map((r, index) => ({
          accessory_id: r.accessory_id,
          name: r.name || '',
          image_url: r.image_url || null,
          is_recommended: r.is_recommended !== false,
          is_required: !!r.is_required,
          display_order: Number(r.display_order ?? index),
        }))
      );
    }
  }, [isDraft, value, mappingQuery.data]);

  const categoryCountsQuery = useQuery({
    queryKey: ['accessories', 'category-counts', 'product-mapping'],
    queryFn: () => accessoriesApi.categoryCounts().then((r) => r.data),
  });

  const accessoriesQuery = useQuery({
    queryKey: ['accessories', 'product-mapping-picker', search, categoryId],
    queryFn: () =>
      accessoriesApi.list({
        per_page: 500,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(categoryId !== 'all' ? { category_id: categoryId } : {}),
      }),
  });

  const catalog = useMemo(() => accessoriesQuery.data?.data || [], [accessoriesQuery.data?.data]);

  const mappedIds = useMemo(() => new Set(mapped.map((m) => m.accessory_id)), [mapped]);

  const commitMapped = (next) => {
    setMapped(next);
    if (isDraft && typeof onChange === 'function') onChange(next);
  };

  const toggleAccessory = (accessory) => {
    const id = accessory.id;
    if (mappedIds.has(id)) {
      commitMapped(mapped.filter((m) => m.accessory_id !== id));
      return;
    }
    commitMapped([
      ...mapped,
      {
        accessory_id: id,
        name: accessory.name || '',
        image_url: accessory.image_url || null,
        is_recommended: true,
        is_required: false,
        display_order: mapped.length,
      },
    ]);
  };

  const moveMapped = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= mapped.length) return;
    const next = [...mapped];
    const tmp = next[index];
    next[index] = next[j];
    next[j] = tmp;
    commitMapped(next.map((row, i) => ({ ...row, display_order: i })));
  };

  const updateMappedRow = (accessoryId, patch) => {
    commitMapped(
      mapped.map((row) => (row.accessory_id === accessoryId ? { ...row, ...patch } : row))
    );
  };

  const saveMut = useMutation({
    mutationFn: () =>
      productsApi.updateAccessoryMapping(productId, {
        accessories: mapped.map((row, index) => ({
          accessory_id: row.accessory_id,
          is_recommended: row.is_recommended !== false,
          is_required: !!row.is_required,
          display_order: index,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-accessory-mapping', productId] });
      toast.success('Accessory mapping saved');
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Could not save mapping');
    },
  });

  return (
    <div className="card p-4 mt-6 border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Accessory mapping</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Mapped accessories are auto-added when this product is used in a booking.
            {isDraft ? ' Selected accessories will be linked after you Submit.' : ''}
          </p>
        </div>
        {!isDraft ? (
          <Button
            type="button"
            size="sm"
            icon={Save}
            onClick={() => guardedMutate(saveMut)}
            loading={saveMut.isPending}
            disabled={mappingQuery.isLoading}
          >
            Save mapping
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(9rem,11rem)_1fr] gap-2 min-w-0 h-72">
          <div className="border border-gray-200 rounded-md overflow-hidden flex flex-col min-h-0 h-full">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-gray-700 bg-gray-50 border-b border-gray-200 shrink-0">
              Categories
            </div>
            <div className="flex-1 min-h-0 scroll-area">
              <button
                type="button"
                onClick={() => setCategoryId('all')}
                className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                  categoryId === 'all' ? 'bg-brand-light text-brand font-semibold' : 'hover:bg-gray-50'
                }`}
              >
                All ({categoryCountsQuery.data?.total || 0})
              </button>
              {categoryCountsQuery.isLoading ? (
                <p className="px-2 py-2 text-xs text-gray-500">Loading…</p>
              ) : (
                (categoryCountsQuery.data?.by_category || []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                      categoryId === c.id
                        ? 'bg-brand-light text-brand font-semibold'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate">
                      {c.label} ({c.count || 0})
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="min-w-0 flex flex-col min-h-0 h-full">
            <Input
              label="Search accessories"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name…"
            />
            <div className="mt-2 flex-1 min-h-0 scroll-area rounded-md border border-gray-200 p-2 space-y-1">
              {accessoriesQuery.isLoading ? (
                <p className="text-sm text-gray-500 p-2">Loading accessories…</p>
              ) : catalog.length === 0 ? (
                <p className="text-sm text-gray-500 p-2">No accessories found.</p>
              ) : (
                catalog.map((a) => {
                  const checked = mappedIds.has(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-sm text-gray-800 rounded px-1 py-1 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-brand focus:ring-brand"
                        checked={checked}
                        onChange={() => toggleAccessory(a)}
                      />
                      <span className="truncate">{a.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col min-h-0 h-72">
          <p className="text-xs font-medium text-gray-700 mb-2 shrink-0">
            Mapped accessories ({mapped.length})
          </p>
          {mapped.length === 0 ? (
            <p className="text-sm text-gray-500 rounded-md border border-dashed border-gray-200 p-4 flex-1">
              No accessories mapped yet. Select accessories from the list.
            </p>
          ) : (
            <ul className="space-y-2 flex-1 min-h-0 scroll-area pr-1">
              {mapped.map((row, idx) => (
                <li
                  key={row.accessory_id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-sm"
                >
                  <span className="flex-1 min-w-0 truncate font-medium text-gray-900">{row.name}</span>
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-brand focus:ring-brand"
                      checked={row.is_recommended}
                      onChange={(e) =>
                        updateMappedRow(row.accessory_id, { is_recommended: e.target.checked })
                      }
                    />
                    Recommended
                  </label>
                  <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-brand focus:ring-brand"
                      checked={row.is_required}
                      onChange={(e) =>
                        updateMappedRow(row.accessory_id, { is_required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={ArrowUp}
                      title="Move up"
                      disabled={idx === 0}
                      onClick={() => moveMapped(idx, -1)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={ArrowDown}
                      title="Move down"
                      disabled={idx === mapped.length - 1}
                      onClick={() => moveMapped(idx, 1)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      iconOnly
                      icon={X}
                      title="Remove"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() =>
                        commitMapped(mapped.filter((m) => m.accessory_id !== row.accessory_id))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

ProductAccessoryMappingSection.propTypes = {
  productId: PropTypes.string,
  value: PropTypes.arrayOf(PropTypes.object),
  onChange: PropTypes.func,
};

export default ProductAccessoryMappingSection;
