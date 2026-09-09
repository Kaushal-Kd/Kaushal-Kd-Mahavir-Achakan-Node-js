import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@wrs/shared';
import { Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import { useModalSize } from '../../hooks/useModalSize.js';
import { accessoriesApi } from '../../lib/api/accessories.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import SmartImage from '../ui/SmartImage.jsx';

/**
 * Multi-select accessory picker (categories + search), same pattern as Create Order.
 */
export default function SelectAccessoriesModal({
  isOpen,
  onClose,
  onSave,
  title,
  alreadyAddedAccessoryIds,
  filterAccessory,
  renderAccessoryMeta,
}) {
  const modalSize = useModalSize('lg');
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [pendingPicks, setPendingPicks] = useState({});

  const addedSet = useMemo(
    () => new Set((alreadyAddedAccessoryIds || []).map(String)),
    [alreadyAddedAccessoryIds]
  );

  useEffect(() => {
    if (!isOpen) return;
    setCategoryId('all');
    setSearch('');
    setPendingPicks({});
  }, [isOpen]);

  const categoryCountsQuery = useQuery({
    queryKey: ['accessories', 'category-counts', 'select-modal'],
    queryFn: () => accessoriesApi.categoryCounts().then((r) => r.data),
    enabled: isOpen,
  });

  const searchQuery = useQuery({
    queryKey: ['accessories', 'select-modal', search, categoryId],
    queryFn: () =>
      accessoriesApi.list({
        search,
        per_page: 80,
        ...(categoryId !== 'all' ? { category_id: categoryId } : {}),
      }),
    enabled: isOpen,
  });

  const visibleRows = useMemo(() => {
    const rows = searchQuery.data?.data || [];
    const filter = filterAccessory || (() => true);
    return rows.filter(filter);
  }, [searchQuery.data?.data, filterAccessory]);

  const pendingCount = useMemo(
    () => Object.keys(pendingPicks).filter((id) => !addedSet.has(id)).length,
    [pendingPicks, addedSet]
  );

  const togglePick = (row, checked) => {
    if (addedSet.has(String(row.id))) return;
    setPendingPicks((prev) => {
      const next = { ...prev };
      if (checked) next[row.id] = row;
      else delete next[row.id];
      return next;
    });
  };

  const selectAllVisible = () => {
    setPendingPicks((prev) => {
      const next = { ...prev };
      for (const row of visibleRows) {
        if (!addedSet.has(String(row.id))) next[row.id] = row;
      }
      return next;
    });
  };

  const clearPending = () => setPendingPicks({});

  const handleSave = () => {
    const picked = Object.values(pendingPicks).filter((r) => r?.id && !addedSet.has(String(r.id)));
    if (picked.length === 0) {
      onClose();
      return;
    }
    onSave(picked);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={modalSize}
      title={title || 'Select items'}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Add selected{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 text-xs">
        <p className="text-[11px] text-gray-500 leading-snug">
          Choose one or more items, then click{' '}
          <span className="font-semibold text-gray-700">Add selected</span>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-2">
          <div className="border border-gray-200 rounded-md overflow-hidden h-[46vh] min-h-[12rem]">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-gray-700 bg-gray-50 border-b border-gray-200">
              Categories
            </div>
            <div className="max-h-[42vh] overflow-auto">
              <button
                type="button"
                onClick={() => setCategoryId('all')}
                className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                  categoryId === 'all' ? 'bg-brand-light text-brand font-semibold' : 'hover:bg-gray-50'
                }`}
              >
                All ({categoryCountsQuery.data?.total || 0})
              </button>
              {(categoryCountsQuery.data?.by_category || []).map((c) => (
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
                  {c.label} ({c.count || 0})
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 min-w-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Search by name, code, category or barcode"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
                All items
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[11px] text-brand hover:underline"
                  onClick={selectAllVisible}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-[11px] text-gray-600 hover:underline"
                  onClick={clearPending}
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[40vh] min-h-[10rem] overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {searchQuery.isLoading ? (
                <div className="px-2 py-6 text-center text-xs text-gray-500">Loading…</div>
              ) : visibleRows.length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-gray-500">No items found.</div>
              ) : (
                visibleRows.map((a) => {
                  const alreadyAdded = addedSet.has(String(a.id));
                  const isPending = Boolean(pendingPicks[a.id]);
                  const isChecked = alreadyAdded || isPending;
                  return (
                    <label
                      key={a.id}
                      className={`px-2 py-1.5 flex items-center gap-2 border-b border-gray-100 last:border-b-0 ${
                        alreadyAdded
                          ? 'bg-brand-light/80 ring-1 ring-inset ring-brand/30 cursor-default'
                          : isPending
                            ? 'bg-brand-light/40 ring-1 ring-inset ring-brand/20 hover:bg-brand-light/50 cursor-pointer'
                            : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={isChecked}
                        disabled={alreadyAdded}
                        onChange={(e) => togglePick(a, e.target.checked)}
                      />
                      <SmartImage
                        src={a.image_url}
                        alt={a.name}
                        className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-gray-800">{a.name}</div>
                        <div className="text-xs text-gray-500">
                          {a.code ? `${a.code} · ` : ''}
                          sell {formatCurrency(a.price_sell ?? a.price ?? 0)}
                          {renderAccessoryMeta ? renderAccessoryMeta(a) : null}
                          {alreadyAdded ? ' · already on sale' : ''}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

SelectAccessoriesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  title: PropTypes.string,
  alreadyAddedAccessoryIds: PropTypes.arrayOf(PropTypes.string),
  filterAccessory: PropTypes.func,
  renderAccessoryMeta: PropTypes.func,
};

SelectAccessoriesModal.defaultProps = {
  title: 'Select items',
  alreadyAddedAccessoryIds: [],
  filterAccessory: null,
  renderAccessoryMeta: null,
};
