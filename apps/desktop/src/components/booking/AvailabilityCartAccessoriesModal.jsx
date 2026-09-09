import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@wrs/shared';
import { Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useModalSize } from '../../hooks/useModalSize.js';
import { validateRentAccessoryQty } from '../../lib/accessoryAvailability.js';
import { accessoriesApi } from '../../lib/api/accessories.js';
import {
  accessoryDefaultType,
  catalogAccessoryToLine,
  createBookingLineId,
  filterRecommendedGroupItems,
  formatAccessoryDateAvailability,
  isAccessoryPickerOutOfStock,
  recommendationRowsToAccessoryLines,
  resolveAccessoryPickerType,
  selectedAccessoriesForCartDraft,
  sortAccessoriesByDisplayOrder,
} from '../../lib/bookingAccessoryCart.js';
import { toast } from '../../stores/uiStore.js';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import SmartImage from '../ui/SmartImage.jsx';

/**
 * Accessory picker for availability cart lines (recommended + catalog), aligned with Create Order.
 */
export default function AvailabilityCartAccessoriesModal({
  isOpen,
  onClose,
  cartLine,
  onSave,
}) {
  const modalSize = useModalSize('lg');
  const [accessoryLines, setAccessoryLines] = useState([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [pendingRecommendedSelections, setPendingRecommendedSelections] = useState({});
  const [pendingAccessoryPicks, setPendingAccessoryPicks] = useState({});
  const [accessoryCategoryId, setAccessoryCategoryId] = useState('all');
  const [accessorySearch, setAccessorySearch] = useState('');
  const [openRecommendedCategoryKey, setOpenRecommendedCategoryKey] = useState('');
  const [recommendedCategorySearch, setRecommendedCategorySearch] = useState({});
  const [saving, setSaving] = useState(false);
  const recommendedDropdownWrapRef = useRef(null);

  const categoryCountsQuery = useQuery({
    queryKey: ['accessories', 'category-counts', 'availability-cart-modal'],
    queryFn: () => accessoriesApi.categoryCounts().then((r) => r.data),
    enabled: isOpen,
  });

  const accessorySearchQuery = useQuery({
    queryKey: [
      'accessory-search-availability-cart',
      accessorySearch,
      accessoryCategoryId,
      cartLine?.from,
      cartLine?.to,
    ],
    queryFn: () =>
      accessoriesApi.list({
        search: accessorySearch,
        per_page: 80,
        include_active_count: '1',
        from: cartLine?.from,
        to: cartLine?.to,
        ...(accessoryCategoryId !== 'all' ? { category_id: accessoryCategoryId } : {}),
      }),
    enabled: isOpen && !!cartLine?.from && !!cartLine?.to,
  });

  const categoryLabelById = useMemo(() => {
    const rows = categoryCountsQuery.data?.by_category || [];
    return new Map(rows.map((c) => [String(c.id), c.label]));
  }, [categoryCountsQuery.data?.by_category]);

  useEffect(() => {
    if (!isOpen || !cartLine?.product_id) return;
    let cancelled = false;
    setLoadingRec(true);
    setAccessorySearch('');
    setAccessoryCategoryId('all');
    setPendingAccessoryPicks({});
    setOpenRecommendedCategoryKey('');
    setRecommendedCategorySearch({});

    (async () => {
      try {
        const res = await accessoriesApi.recommendations({
          product_id: cartLine.product_id,
          category_id: cartLine.category_id || '',
          from: cartLine.from,
          to: cartLine.to,
        });
        if (cancelled) return;
        const payload = res?.data;
        const recPayload =
          payload && Array.isArray(payload.data)
            ? payload
            : { data: [] };
        const catalogFromApi = recommendationRowsToAccessoryLines(recPayload, categoryLabelById);

        const savedById = new Map(
          (cartLine.accessories || []).map((a) => [String(a.accessory_id), a])
        );
        const merged = catalogFromApi.map((row) => {
          const ex = savedById.get(String(row.accessory_id));
          if (!ex) return row;
          savedById.delete(String(row.accessory_id));
          return {
            ...row,
            line_id: ex.line_id || row.line_id,
            selected: true,
            qty: Math.max(1, Number(ex.qty) || 1),
            price: Number(ex.price ?? row.price) || row.price,
            remarks: String(ex.remarks ?? '').trim().slice(0, 500),
            type: ex.type ?? row.type,
            accessory_order_status: ex.accessory_order_status ?? row.accessory_order_status,
          };
        });
        for (const ex of savedById.values()) {
          merged.push({
            ...ex,
            line_id: ex.line_id || createBookingLineId(),
            selected: true,
            qty: Math.max(1, Number(ex.qty) || 1),
          });
        }

        setAccessoryLines(merged);
        const init = {};
        const clearedLineIds = new Set();
        for (const a of merged) {
          const pickType = resolveAccessoryPickerType(a, a.type);
          const selected = !!a.selected;
          const outOfStock = isAccessoryPickerOutOfStock(a, { type: pickType });
          if (selected && outOfStock) {
            init[a.line_id] = false;
            clearedLineIds.add(a.line_id);
          } else {
            init[a.line_id] = selected;
          }
        }
        if (clearedLineIds.size > 0) {
          setAccessoryLines((prev) =>
            prev.map((a) => (clearedLineIds.has(a.line_id) ? { ...a, selected: false } : a))
          );
        }
        setPendingRecommendedSelections(init);
      } catch {
        if (!cancelled) {
          const saved = (cartLine.accessories || []).map((a) => ({
            ...a,
            line_id: a.line_id || createBookingLineId(),
            selected: true,
          }));
          setAccessoryLines(saved);
          const init = {};
          for (const a of saved) init[a.line_id] = true;
          setPendingRecommendedSelections(init);
        }
      } finally {
        if (!cancelled) setLoadingRec(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    cartLine?.product_id,
    cartLine?.category_id,
    cartLine?.from,
    cartLine?.to,
    cartLine?.accessories,
    categoryCountsQuery.data,
  ]);

  useEffect(() => {
    if (!openRecommendedCategoryKey) return;
    const onDocDown = (e) => {
      const wrap = recommendedDropdownWrapRef.current;
      if (!wrap?.contains(e.target)) setOpenRecommendedCategoryKey('');
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [openRecommendedCategoryKey]);

  const recommendedAccessoryGroups = useMemo(() => {
    const map = new Map();
    for (const a of accessoryLines) {
      const key = String(a?.category_id ?? '').trim();
      if (!key) continue;
      const label =
        String(a?.category_name || '').trim() ||
        String(categoryLabelById.get(key) || '').trim() ||
        `Category ${key}`;
      if (!map.has(key)) {
        map.set(key, { key, label, items: [], displayOrder: null });
      }
      const group = map.get(key);
      group.items.push(a);
      const order =
        a?.category_display_order !== undefined && a?.category_display_order !== null
          ? Number(a.category_display_order || 0)
          : null;
      if (order !== null && Number.isFinite(order)) {
        if (group.displayOrder === null || order < group.displayOrder) {
          group.displayOrder = order;
        }
      }
    }
    return Array.from(map.values())
      .map((group) => ({
        ...group,
        items: sortAccessoriesByDisplayOrder(group.items),
      }))
      .sort((a, b) => {
        const ao = a.displayOrder;
        const bo = b.displayOrder;
        if (ao !== null && bo !== null && ao !== bo) return ao - bo;
        if (ao !== null && bo === null) return -1;
        if (ao === null && bo !== null) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [accessoryLines, categoryLabelById]);

  const isAccessoryOnLine = (accessoryId) => {
    const id = String(accessoryId || '');
    return accessoryLines.some((a) => String(a.accessory_id) === id && !!a.selected);
  };

  const pendingSaveCount = useMemo(() => {
    const rec = Object.values(pendingRecommendedSelections).filter(Boolean).length;
    const extra = Object.keys(pendingAccessoryPicks).filter((id) => !isAccessoryOnLine(id)).length;
    return rec + extra;
  }, [pendingRecommendedSelections, pendingAccessoryPicks, accessoryLines]);

  const togglePendingRecommended = async (lineId, checked) => {
    if (checked) {
      const acc = accessoryLines.find((a) => a.line_id === lineId);
      if (acc) {
        const pickType = resolveAccessoryPickerType(acc, acc.type);
        if (isAccessoryPickerOutOfStock(acc, { type: pickType })) {
          toast.warning(`${acc.name_snapshot || 'Accessory'} is not available for selected dates`);
          return;
        }
        if (
          pickType !== 'sell' &&
          cartLine?.from &&
          cartLine?.to &&
          acc.accessory_id
        ) {
          const qty = Math.max(1, Number(acc.qty) || 1);
          const result = await validateRentAccessoryQty({
            accessoryId: acc.accessory_id,
            from: cartLine.from,
            to: cartLine.to,
            qty,
            label: acc.name_snapshot || 'Accessory',
          });
          if (!result.ok) {
            toast.warning(result.message || `${acc.name_snapshot || 'Accessory'} is not available`);
            return;
          }
        }
      }
    }
    setPendingRecommendedSelections((prev) => ({ ...prev, [lineId]: checked }));
  };

  const selectAllRecommended = () => {
    const next = { ...pendingRecommendedSelections };
    for (const a of accessoryLines) {
      const pickType = resolveAccessoryPickerType(a, a.type);
      if (isAccessoryPickerOutOfStock(a, { type: pickType })) continue;
      next[a.line_id] = true;
    }
    setPendingRecommendedSelections(next);
  };

  const clearPendingRecommended = () => {
    const next = { ...pendingRecommendedSelections };
    for (const a of accessoryLines) next[a.line_id] = false;
    setPendingRecommendedSelections(next);
  };

  const togglePendingPick = async (row, checked) => {
    if (isAccessoryOnLine(row.id)) return;
    if (checked) {
      const pickType = accessoryDefaultType(row);
      if (isAccessoryPickerOutOfStock(row, { type: pickType })) {
        toast.warning(`${row.name || 'Accessory'} is not available for selected dates`);
        return;
      }
      if (
        pickType !== 'sell' &&
        cartLine?.from &&
        cartLine?.to &&
        row.id
      ) {
        const result = await validateRentAccessoryQty({
          accessoryId: row.id,
          from: cartLine.from,
          to: cartLine.to,
          qty: 1,
          label: row.name || 'Accessory',
        });
        if (!result.ok) {
          toast.warning(result.message || `${row.name || 'Accessory'} is not available`);
          return;
        }
      }
    }
    setPendingAccessoryPicks((prev) => {
      const next = { ...prev };
      if (checked) next[row.id] = row;
      else delete next[row.id];
      return next;
    });
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const validatedSelections = { ...pendingRecommendedSelections };
      let failedCount = 0;

      for (const a of accessoryLines) {
        const wantSelected =
          pendingRecommendedSelections[a.line_id] !== undefined
            ? !!pendingRecommendedSelections[a.line_id]
            : !!a.selected;
        if (!wantSelected) continue;

        const pickType = resolveAccessoryPickerType(a, a.type);
        if (pickType === 'sell') {
          if (isAccessoryPickerOutOfStock(a, { type: pickType })) {
            validatedSelections[a.line_id] = false;
            failedCount += 1;
          }
          continue;
        }

        if (cartLine?.from && cartLine?.to && a.accessory_id) {
          const qty = Math.max(1, Number(a.qty) || 1);
          const result = await validateRentAccessoryQty({
            accessoryId: a.accessory_id,
            from: cartLine.from,
            to: cartLine.to,
            qty,
            label: a.name_snapshot || 'Accessory',
          });
          if (!result.ok) {
            validatedSelections[a.line_id] = false;
            failedCount += 1;
            toast.warning(result.message || `${a.name_snapshot || 'Accessory'} is not available`);
          }
        }
      }

      let next = accessoryLines.map((a) => ({
        ...a,
        selected:
          validatedSelections[a.line_id] !== undefined
            ? !!validatedSelections[a.line_id]
            : !!a.selected,
      }));

      const labelMap = categoryLabelById;
      for (const row of Object.values(pendingAccessoryPicks)) {
        if (!row?.id || isAccessoryOnLine(row.id)) continue;
        const pickType = accessoryDefaultType(row);
        if (isAccessoryPickerOutOfStock(row, { type: pickType })) {
          failedCount += 1;
          continue;
        }
        if (pickType !== 'sell' && cartLine?.from && cartLine?.to) {
          const result = await validateRentAccessoryQty({
            accessoryId: row.id,
            from: cartLine.from,
            to: cartLine.to,
            qty: 1,
            label: row.name || 'Accessory',
          });
          if (!result.ok) {
            failedCount += 1;
            toast.warning(result.message || `${row.name || 'Accessory'} is not available`);
            continue;
          }
        }
        const exists = next.some((a) => String(a.accessory_id) === String(row.id));
        if (exists) {
          next = next.map((a) =>
            String(a.accessory_id) === String(row.id) ? { ...a, selected: true } : a
          );
        } else {
          next.push(catalogAccessoryToLine(row, labelMap));
        }
      }

      if (failedCount > 0 && !next.some((a) => a.selected)) {
        toast.warning('No accessories could be saved (check availability)');
        return;
      }

      onSave(selectedAccessoriesForCartDraft(next));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const productLabel = cartLine?.name || cartLine?.code || 'Product';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size={modalSize}
      title={`Accessories · ${productLabel}`}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void handleSave()} disabled={saving}>
            Save{pendingSaveCount > 0 ? ` (${pendingSaveCount})` : ''}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 text-xs">
        <p className="text-[11px] text-gray-500 leading-snug">
          Choose recommended and extra accessories for this cart line. They will carry over when you
          use Quick Bill to open Create Booking.
        </p>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
              Recommended Accessories
            </div>
            {accessoryLines.length > 0 ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-[11px] text-brand hover:underline"
                  onClick={selectAllRecommended}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-[11px] text-gray-600 hover:underline"
                  onClick={clearPendingRecommended}
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
          {loadingRec ? (
            <div className="text-[11px] text-gray-500 border border-gray-200 rounded-md px-2 py-3 text-center">
              Loading recommendations…
            </div>
          ) : accessoryLines.length === 0 ? (
            <div className="text-[11px] text-gray-500 border border-gray-200 rounded-md px-2 py-1.5">
              No mapped accessories for this product. Use the catalog below.
            </div>
          ) : recommendedAccessoryGroups.length === 0 ? (
            <div className="text-[11px] text-gray-500 border border-gray-200 rounded-md px-2 py-1.5 mb-2">
              No categorized recommendations — pick from the catalog below.
            </div>
          ) : (
            <div
              ref={recommendedDropdownWrapRef}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-2"
            >
              {recommendedAccessoryGroups.map((group) => {
                const isOpenGroup = openRecommendedCategoryKey === group.key;
                const selectedNames = group.items
                  .filter((a) => !!pendingRecommendedSelections[a.line_id])
                  .map((a) => String(a.name_snapshot || '').trim())
                  .filter(Boolean);
                const selectedPreview = selectedNames.length
                  ? selectedNames.length <= 2
                    ? selectedNames.join(', ')
                    : `${selectedNames.slice(0, 2).join(', ')} +${selectedNames.length - 2}`
                  : 'Select accessories';
                const groupHasSelected = group.items.some(
                  (x) => !!pendingRecommendedSelections[x.line_id]
                );
                return (
                  <div key={group.key} className="relative">
                    <div className="mb-0.5 text-xs font-medium text-gray-800 truncate">{group.label}</div>
                    <button
                      type="button"
                      className={`w-full h-7 rounded border bg-white hover:bg-gray-50 ${
                        groupHasSelected
                          ? 'border-brand-700 bg-brand-100 text-gray-900 font-medium'
                          : 'border-gray-300 text-gray-700'
                      }`}
                      onClick={() =>
                        setOpenRecommendedCategoryKey((prev) => (prev === group.key ? '' : group.key))
                      }
                    >
                      <span className="block w-full px-2 text-left text-[11px] text-inherit truncate">
                        {selectedPreview}
                      </span>
                    </button>
                    {isOpenGroup ? (
                      <div
                        className={`absolute left-0 right-0 z-20 mt-1 border rounded bg-white shadow-sm max-h-44 overflow-hidden flex flex-col ${
                          groupHasSelected ? 'border-brand-200' : 'border-gray-200'
                        }`}
                      >
                        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white p-1">
                          <div className="relative">
                            <Search
                              size={12}
                              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                            />
                            <input
                              type="search"
                              className="input h-7 w-full text-[11px] pl-7"
                              placeholder="Search by name"
                              value={recommendedCategorySearch[group.key] || ''}
                              onChange={(e) =>
                                setRecommendedCategorySearch((prev) => ({
                                  ...prev,
                                  [group.key]: e.target.value,
                                }))
                              }
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        <div className="overflow-auto p-1 space-y-0.5 max-h-32">
                          {filterRecommendedGroupItems(
                            group.items,
                            recommendedCategorySearch[group.key]
                          ).map((a) => {
                            const pickType = resolveAccessoryPickerType(a, a.type);
                            const outOfStock = isAccessoryPickerOutOfStock(a, {
                              type: pickType,
                            });
                            const isChecked = !!pendingRecommendedSelections[a.line_id];
                            return (
                            <label
                              key={a.line_id}
                              aria-label={`Select ${a.name_snapshot || 'accessory'}`}
                              className={`flex items-start gap-1.5 rounded px-1 py-0.5 text-[11px] ${
                                outOfStock
                                  ? 'border border-transparent text-gray-500 opacity-60 cursor-not-allowed'
                                  : isChecked
                                    ? 'border border-brand bg-brand-100 font-medium text-gray-900 cursor-pointer'
                                    : 'border border-transparent text-gray-700 hover:bg-gray-50 cursor-pointer'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={outOfStock}
                                onChange={(e) =>
                                  void togglePendingRecommended(a.line_id, e.target.checked)
                                }
                                className="mt-0.5 shrink-0 accent-brand"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="leading-4 flex items-center gap-1.5 flex-wrap">
                                  {a.name_snapshot}
                                  {outOfStock ? (
                                    <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 leading-none uppercase">
                                      Not available
                                    </span>
                                  ) : null}
                                </span>
                                <span className="text-[10px] text-gray-500 font-normal block mt-0.5">
                                  {formatAccessoryDateAvailability(a, {
                                    type: pickType,
                                    from: cartLine?.from,
                                    to: cartLine?.to,
                                  })}
                                </span>
                              </span>
                            </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-2">
          <div className="border border-gray-200 rounded-md overflow-hidden h-[40vh] min-h-[10rem]">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-gray-700 bg-gray-50 border-b border-gray-200">
              Categories
            </div>
            <div className="max-h-[36vh] overflow-auto">
              <button
                type="button"
                onClick={() => setAccessoryCategoryId('all')}
                className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                  accessoryCategoryId === 'all'
                    ? 'bg-brand-light text-brand font-semibold'
                    : 'hover:bg-gray-50'
                }`}
              >
                All ({categoryCountsQuery.data?.total || 0})
              </button>
              {(categoryCountsQuery.data?.by_category || []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setAccessoryCategoryId(c.id)}
                  className={`w-full text-left px-2 py-1.5 text-xs border-b border-gray-100 ${
                    accessoryCategoryId === c.id
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
                value={accessorySearch}
                onChange={(e) => setAccessorySearch(e.target.value)}
              />
            </div>
            <div className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">
              Add extra accessories
            </div>
            <div className="max-h-[36vh] min-h-[8rem] overflow-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {accessorySearchQuery.isLoading ? (
                <div className="px-2 py-6 text-center text-xs text-gray-500">Loading…</div>
              ) : (accessorySearchQuery.data?.data || []).length === 0 ? (
                <div className="px-2 py-6 text-center text-xs text-gray-500">No accessories found.</div>
              ) : (
                (accessorySearchQuery.data?.data || []).map((a) => {
                  const alreadyAdded = isAccessoryOnLine(a.id);
                  const isPending = Boolean(pendingAccessoryPicks[a.id]);
                  const pickType = accessoryDefaultType(a);
                  const outOfStock =
                    !alreadyAdded && isAccessoryPickerOutOfStock(a, { type: pickType });
                  const availabilityLabel = formatAccessoryDateAvailability(a, {
                    type: pickType,
                    from: cartLine?.from,
                    to: cartLine?.to,
                  });
                  const isChecked = alreadyAdded || isPending;
                  const isDisabled = alreadyAdded || outOfStock;
                  return (
                    <label
                      key={a.id}
                      className={`px-2 py-1.5 flex items-center gap-2 ${
                        outOfStock
                          ? 'bg-gray-50 opacity-60 cursor-not-allowed'
                          : alreadyAdded
                            ? 'bg-brand-light/80 ring-1 ring-inset ring-brand/30 cursor-default'
                            : isPending
                              ? 'bg-brand-light/40 cursor-pointer'
                              : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={(e) => void togglePendingPick(a, e.target.checked)}
                      />
                      <SmartImage
                        src={a.image_url}
                        alt={a.name}
                        className="w-8 h-8 rounded border border-gray-200 bg-white object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-gray-800 flex items-center gap-1.5">
                          {a.name}
                          {outOfStock ? (
                            <span className="text-[9px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5 leading-none uppercase">
                              Not available
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-500">
                          {availabilityLabel} · rent {formatCurrency(a.price_rent)} · sell{' '}
                          {formatCurrency(a.price_sell)}
                          {alreadyAdded ? ' · on line' : ''}
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

AvailabilityCartAccessoriesModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  cartLine: PropTypes.shape({
    product_id: PropTypes.string,
    category_id: PropTypes.string,
    name: PropTypes.string,
    code: PropTypes.string,
    from: PropTypes.string,
    to: PropTypes.string,
    accessories: PropTypes.arrayOf(PropTypes.object),
  }),
};

AvailabilityCartAccessoriesModal.defaultProps = {
  cartLine: null,
};
