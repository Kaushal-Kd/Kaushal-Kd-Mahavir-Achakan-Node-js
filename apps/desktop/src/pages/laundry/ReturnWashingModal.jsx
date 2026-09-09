import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import UpcomingPickupDates from '../../components/booking/UpcomingPickupDates.jsx';
import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { laundryApi } from '../../lib/api/laundry.js';
import { toast } from '../../stores/uiStore.js';
import {
  accessoryPendingQty,
  filterLaundryJobProducts,
  getDaysLeft,
  PRIORITY_TONE,
  resolveNextBookingLink,
  sortLaundryJobProductsByPriority,
} from './laundryQueueUtils.js';

const STATUS_BADGE = {
  in_washing: 'bg-brand-light text-brand',
  returned: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL = {
  in_washing: 'In Washing',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

function formatDaysLeft(row) {
  if (row.daysLeft != null && row.daysLeft !== '') return String(row.daysLeft);
  const computed = getDaysLeft(row.nextPickupDate);
  return computed == null ? '—' : String(computed);
}

const ReturnWashingModal = ({ jobId, onClose }) => {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState(() => new Set());
  const [selectedAccessories, setSelectedAccessories] = useState(() => new Set());
  const [accessoryReturnQty, setAccessoryReturnQty] = useState({});
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data: jobResp, isLoading } = useQuery({
    queryKey: ['laundry-job', jobId],
    queryFn: () => laundryApi.get(jobId),
    enabled: Boolean(jobId),
  });

  const job = jobResp?.data;
  const productRows = job?.productRows || [];
  const accessoryRows = job?.accessoryRows || [];

  useEffect(() => {
    setCategoryFilter('');
    setSearch('');
    setSelectedProducts(new Set());
    setSelectedAccessories(new Set());
    setAccessoryReturnQty({});
  }, [jobId]);

  const categoryOptions = useMemo(() => {
    const map = new Map();
    productRows.forEach((row) => {
      const key = row.categoryId || 'uncategorized';
      const label = row.categoryLabel || 'Uncategorized';
      if (!map.has(key)) map.set(key, label);
    });
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [productRows]);

  const filteredProductRows = useMemo(() => {
    const filtered = filterLaundryJobProducts(productRows, { categoryId: categoryFilter, search });
    return sortLaundryJobProductsByPriority(filtered);
  }, [productRows, categoryFilter, search]);

  const filteredReturnableProducts = useMemo(
    () => filteredProductRows.filter((row) => row.status === 'in_washing'),
    [filteredProductRows]
  );

  const returnableAccessories = useMemo(
    () => accessoryRows.filter((row) => accessoryPendingQty(row) > 0 && row.status !== 'cancelled'),
    [accessoryRows]
  );

  const allReturnableProductsSelected =
    filteredReturnableProducts.length > 0 &&
    filteredReturnableProducts.every((row) => selectedProducts.has(row.rowId));

  const allReturnableAccessoriesSelected =
    returnableAccessories.length > 0 &&
    returnableAccessories.every((row) => selectedAccessories.has(row.rowId));

  const totalSelected =
    selectedProducts.size + selectedAccessories.size;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['laundry-job', jobId] });
    queryClient.invalidateQueries({ queryKey: ['laundry-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['laundry-return-logs', jobId] });
  };

  const toggleProduct = (rowId) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleAccessory = (rowId) => {
    setSelectedAccessories((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleAllReturnableProducts = (checked) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      filteredReturnableProducts.forEach((row) => {
        if (checked) next.add(row.rowId);
        else next.delete(row.rowId);
      });
      return next;
    });
  };

  const toggleAllReturnableAccessories = (checked) => {
    setSelectedAccessories((prev) => {
      const next = new Set(prev);
      returnableAccessories.forEach((row) => {
        if (checked) next.add(row.rowId);
        else next.delete(row.rowId);
      });
      return next;
    });
  };

  const getAccessoryReturnQty = (row) => {
    const pending = accessoryPendingQty(row);
    const raw = accessoryReturnQty[row.rowId];
    if (raw == null || raw === '') return pending;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return pending;
    return Math.min(pending, Math.floor(n));
  };

  const handleReturnSelected = async () => {
    if (busy) return;

    const productLineIds = productRows
      .filter((row) => selectedProducts.has(row.rowId) && row.status === 'in_washing')
      .map((row) => row.rowId);

    const accessoryLines = accessoryRows.filter(
      (row) => selectedAccessories.has(row.rowId) && accessoryPendingQty(row) > 0
    );

    if (productLineIds.length === 0 && accessoryLines.length === 0) {
      toast.warning('Select at least one product or accessory to return');
      return;
    }

    setBusy(true);
    try {
      const result = await laundryApi.returnSelected(jobId, {
        productLineIds,
        accessories: accessoryLines.map((row) => ({
          lineId: row.rowId,
          returnQty: getAccessoryReturnQty(row),
        })),
      });
      const pieceCount = Number(result?.data?.pieceCount || 0);
      const lineCount = Number(result?.data?.lineCount || productLineIds.length + accessoryLines.length);
      toast.success(
        pieceCount > 0
          ? `Returned ${pieceCount} piece${pieceCount === 1 ? '' : 's'} (${lineCount} line${lineCount === 1 ? '' : 's'})`
          : lineCount === 1
            ? 'Marked as returned'
            : `${lineCount} line(s) marked as returned`
      );
      setSelectedProducts((prev) => {
        const next = new Set(prev);
        productLineIds.forEach((lineId) => next.delete(lineId));
        return next;
      });
      setSelectedAccessories((prev) => {
        const next = new Set(prev);
        accessoryLines.forEach((row) => next.delete(row.rowId));
        return next;
      });
      setAccessoryReturnQty({});
      invalidate();
    } catch (e) {
      toast.error(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (!jobId) return null;

  const hasFilters = Boolean(categoryFilter || search.trim());

  return (
    <Modal
      isOpen={Boolean(jobId)}
      onClose={onClose}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">Return Washing — {job?.jobNo || 'Loading...'}</span>
          {job ? (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                job.status === 'completed'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-brand-light text-brand'
              }`}
            >
              {job.status === 'completed' ? 'Completed' : 'Open'}
            </span>
          ) : null}
        </span>
      }
      size="full"
      closeOnBackdrop={false}
      bodyClassName="flex min-h-0 flex-1 overflow-hidden p-0"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[10px] text-gray-500">
            {filteredProductRows.length} of {productRows.length} products shown
            {filteredReturnableProducts.length > 0
              ? ` · ${filteredReturnableProducts.length} returnable`
              : ''}
            {accessoryRows.length > 0
              ? ` · ${returnableAccessories.length} accessory line(s) pending`
              : ''}
          </span>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button
              size="sm"
              icon={RotateCcw}
              onClick={handleReturnSelected}
              disabled={busy || totalSelected === 0}
            >
              Return{totalSelected > 0 ? ` (${totalSelected})` : ''}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid min-h-0 flex-1 grid-rows-2 divide-y divide-gray-200 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:grid-rows-1 md:divide-x md:divide-y-0">
          <div className="flex flex-col min-h-0 min-w-0">
            <div className="border-b border-gray-100 px-3 py-2 grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-2 shrink-0">
          <select
            className="input h-8 text-xs w-full min-w-0"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="min-w-0 flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="search"
                className="input h-8 w-full text-xs pl-7"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code or name"
                aria-label="Search by code or name"
              />
            </div>
            {hasFilters ? (
              <button
                type="button"
                className="shrink-0 text-[11px] text-brand hover:underline whitespace-nowrap"
                onClick={() => {
                  setCategoryFilter('');
                  setSearch('');
                }}
              >
                Clear
              </button>
            ) : null}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
              {isLoading ? (
                <p className="text-xs text-gray-500 py-6 text-center">Loading...</p>
              ) : (
                <section>
                  <h4 className="text-[11px] font-semibold text-gray-700 mb-1.5 sticky top-0 bg-white z-[1] pb-1">
                    Products
                    <span className="font-normal text-gray-500 ml-1">(sorted by priority)</span>
                  </h4>
                {productRows.length === 0 ? (
                  <p className="text-xs text-gray-500 py-3 text-center">No product lines in this job.</p>
                ) : filteredProductRows.length === 0 ? (
                  <p className="text-xs text-gray-500 py-3 text-center">No products match your filters.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table w-full text-[11px] min-w-[52rem]">
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-[1]">
                        <tr className="h-7">
                          <th className="px-1.5 w-8 text-center">
                            <input
                              type="checkbox"
                              checked={allReturnableProductsSelected}
                              disabled={filteredReturnableProducts.length === 0 || busy}
                              onChange={(e) => toggleAllReturnableProducts(e.target.checked)}
                              aria-label="Select all returnable products"
                            />
                          </th>
                          <th className="px-1.5 text-left"><TableHeaderLabel align="left">Code</TableHeaderLabel></th>
                          <th className="px-1.5 text-left"><TableHeaderLabel align="left">Name</TableHeaderLabel></th>
                          {!categoryFilter ? <th className="px-1.5 text-left"><TableHeaderLabel align="left">Category</TableHeaderLabel></th> : null}
                          <th className="px-1.5 text-center w-10"><TableHeaderLabel align="center">Qty</TableHeaderLabel></th>
                          <th className="px-1.5 text-left"><TableHeaderLabel align="left">Next Booking</TableHeaderLabel></th>
                          <th className="px-1.5 text-left"><TableHeaderLabel align="left">Next Pickup</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Days Left</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Priority</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Status</TableHeaderLabel></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProductRows.map((row) => {
                          const canReturn = row.status === 'in_washing';
                          const priority = row.priority || 'No Schedule';
                          return (
                            <tr key={row.rowId} className="border-b border-gray-100 h-9">
                              <td className="px-1.5 text-center">
                                {canReturn ? (
                                  <input
                                    type="checkbox"
                                    checked={selectedProducts.has(row.rowId)}
                                    disabled={busy}
                                    onChange={() => toggleProduct(row.rowId)}
                                  />
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                              <td className="px-1.5 font-mono">{row.code || '—'}</td>
                              <td className="px-1.5">{row.name}</td>
                              {!categoryFilter ? (
                                <td className="px-1.5 text-gray-600">{row.categoryLabel || 'Uncategorized'}</td>
                              ) : null}
                              <td className="px-1.5 text-center">{row.qty}</td>
                              <td className="px-1.5 text-gray-700">
                                {(() => {
                                  const next = resolveNextBookingLink(row);
                                  return (
                                    <BookingBillLink orderId={next.orderId}>
                                      {next.label || '—'}
                                    </BookingBillLink>
                                  );
                                })()}
                              </td>
                              <td className="px-1.5 text-gray-700">
                                <UpcomingPickupDates bookings={row.upcomingBookings} />
                              </td>
                              <td className="px-1.5 text-center">{formatDaysLeft(row)}</td>
                              <td className="px-1.5 text-center">
                                <span
                                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    PRIORITY_TONE[priority] || PRIORITY_TONE['No Schedule']
                                  }`}
                                >
                                  {priority}
                                </span>
                              </td>
                              <td className="px-1.5 text-center">
                                <span
                                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    STATUS_BADGE[row.status] || STATUS_BADGE.in_washing
                                  }`}
                                >
                                  {STATUS_LABEL[row.status] || row.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                </section>
              )}
            </div>
          </div>

          <div className="flex flex-col min-h-0 min-w-0">
            <div className="border-b border-gray-100 px-3 py-2 shrink-0">
              <h4 className="text-[11px] font-semibold text-gray-700">Accessories</h4>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
              {isLoading ? (
                <p className="text-xs text-gray-500 py-6 text-center">Loading...</p>
              ) : accessoryRows.length === 0 ? (
                <p className="text-xs text-gray-500 py-3 text-center">No accessories in this job.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table w-full text-[11px]">
                      <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                        <tr className="h-7">
                          <th className="px-1.5 w-8 text-center">
                            <input
                              type="checkbox"
                              checked={allReturnableAccessoriesSelected}
                              disabled={returnableAccessories.length === 0 || busy}
                              onChange={(e) => toggleAllReturnableAccessories(e.target.checked)}
                              aria-label="Select all returnable accessories"
                            />
                          </th>
                          <th className="px-1.5 text-left"><TableHeaderLabel align="left">Category</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Given</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Returned</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Qty</TableHeaderLabel></th>
                          <th className="px-1.5 text-center"><TableHeaderLabel align="center">Status</TableHeaderLabel></th>
                        </tr>
                      </thead>
                      <tbody>
                        {accessoryRows.map((row) => {
                          const pending = accessoryPendingQty(row);
                          const canReturn = pending > 0 && row.status !== 'cancelled';
                          const returned = Number(row.qtyReturned || 0);
                          const given = Number(row.qty || 0);
                          return (
                            <tr key={row.rowId} className="border-b border-gray-100 h-9">
                              <td className="px-1.5 text-center">
                                {canReturn ? (
                                  <input
                                    type="checkbox"
                                    checked={selectedAccessories.has(row.rowId)}
                                    disabled={busy}
                                    onChange={() => toggleAccessory(row.rowId)}
                                  />
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                              <td className="px-1.5">{row.categoryLabel || row.name}</td>
                              <td className="px-1.5 text-center">{given}</td>
                              <td className="px-1.5 text-center font-medium">
                                {returned} / {given}
                              </td>
                              <td className="px-1.5 text-center">
                                {canReturn ? (
                                  <input
                                    type="number"
                                    min={1}
                                    max={pending}
                                    className="input h-7 w-14 text-center text-xs mx-auto"
                                    value={accessoryReturnQty[row.rowId] ?? pending}
                                    disabled={busy}
                                    onChange={(e) =>
                                      setAccessoryReturnQty((prev) => ({
                                        ...prev,
                                        [row.rowId]: e.target.value,
                                      }))
                                    }
                                    aria-label={`Return quantity for ${row.categoryLabel}`}
                                  />
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="px-1.5 text-center">
                                <span
                                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    STATUS_BADGE[row.status] || STATUS_BADGE.in_washing
                                  }`}
                                >
                                  {returned >= given && given > 0
                                    ? STATUS_LABEL.returned
                                    : STATUS_LABEL[row.status] || row.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                </div>
              )}
            </div>
          </div>
      </div>
    </Modal>
  );
};

ReturnWashingModal.propTypes = {
  jobId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

export default ReturnWashingModal;
