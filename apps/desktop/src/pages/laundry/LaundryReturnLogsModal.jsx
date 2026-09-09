import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@wrs/shared';
import { FilterX, History, Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { laundryApi } from '../../lib/api/laundry.js';

const ITEM_TYPE_OPTIONS = [
  { value: 'all', label: 'All items' },
  { value: 'product', label: 'Products only' },
  { value: 'accessory', label: 'Accessories only' },
];

function sumSentPieces(job) {
  if (!job) return 0;
  const productPieces = (job.productRows || []).reduce(
    (sum, row) => sum + Math.max(1, Number(row.qty) || 1),
    0
  );
  const accessoryPieces = (job.accessoryRows || []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.qty) || 0),
    0
  );
  return productPieces + accessoryPieces;
}

function formatLineLabel(line) {
  const code = line.itemCode ? String(line.itemCode).trim() : '';
  const name = line.itemName ? String(line.itemName).trim() : '-';
  const category = line.categoryLabel ? String(line.categoryLabel).trim() : '';
  const parts = [code || null, category && category !== name ? category : null, name].filter(Boolean);
  const label = parts.join(' · ') || name;
  const qty = Number(line.qty) || 1;
  return qty > 1 ? `${label} · qty ${qty}` : label;
}

function lineSearchHaystack(line, batch) {
  const returnedAt = formatDateTime(batch?.returnedAt) || '';
  return [
    line.itemCode,
    line.itemName,
    line.categoryLabel,
    line.itemType,
    line.itemType === 'product' ? 'product' : '',
    line.itemType === 'accessory' ? 'accessory' : '',
    formatLineLabel(line),
    String(line.qty ?? ''),
    returnedAt,
    batch?.batchId,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function lineMatchesFilters(line, batch, searchTerm, itemTypeFilter) {
  if (itemTypeFilter !== 'all' && String(line.itemType || '') !== itemTypeFilter) {
    return false;
  }
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return true;
  return lineSearchHaystack(line, batch).includes(term);
}

function filterReturnLogBatches(batches, searchTerm, itemTypeFilter) {
  const term = String(searchTerm || '').trim();
  const hasFilter = Boolean(term) || itemTypeFilter !== 'all';
  if (!hasFilter) return batches;

  return batches
    .map((batch) => {
      const lines = (batch.lines || []).filter((line) =>
        lineMatchesFilters(line, batch, term, itemTypeFilter)
      );
      if (lines.length === 0) return null;
      const pieceCount = lines.reduce((sum, line) => sum + Number(line.qty || 0), 0);
      return { ...batch, lines, pieceCount };
    })
    .filter(Boolean);
}

const LaundryReturnLogsModal = ({ jobId, jobNo, onClose }) => {
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState('all');

  useEffect(() => {
    setSearchDraft('');
    setSearch('');
    setItemTypeFilter('all');
  }, [jobId]);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [searchDraft]);

  const { data: jobResp, isLoading: jobLoading } = useQuery({
    queryKey: ['laundry-job', jobId],
    queryFn: () => laundryApi.get(jobId),
    enabled: Boolean(jobId),
  });

  const { data: logsResp, isLoading: logsLoading } = useQuery({
    queryKey: ['laundry-return-logs', jobId],
    queryFn: () => laundryApi.getReturnLogs(jobId),
    enabled: Boolean(jobId),
  });

  const job = jobResp?.data;
  const batches = logsResp?.data || [];
  const isLoading = jobLoading || logsLoading;

  const filteredBatches = useMemo(
    () => filterReturnLogBatches(batches, search, itemTypeFilter),
    [batches, search, itemTypeFilter]
  );

  const totalSent = useMemo(() => sumSentPieces(job), [job]);
  const totalReturned = useMemo(
    () => batches.reduce((sum, batch) => sum + Number(batch.pieceCount || 0), 0),
    [batches]
  );
  const filteredLineCount = useMemo(
    () => filteredBatches.reduce((sum, batch) => sum + (batch.lines?.length || 0), 0),
    [filteredBatches]
  );
  const filteredPieceCount = useMemo(
    () => filteredBatches.reduce((sum, batch) => sum + Number(batch.pieceCount || 0), 0),
    [filteredBatches]
  );

  const filtersActive = Boolean(search) || itemTypeFilter !== 'all';

  const clearFilters = () => {
    setSearchDraft('');
    setSearch('');
    setItemTypeFilter('all');
  };

  if (!jobId) return null;

  return (
    <Modal
      isOpen={Boolean(jobId)}
      onClose={onClose}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <History size={15} className="shrink-0" />
          <span className="truncate">Return Logs — {jobNo || job?.jobNo || 'Loading...'}</span>
        </span>
      }
      size="xl"
      closeOnBackdrop={false}
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
    >
      <div className="border-b border-gray-200 px-4 py-2.5">
        {job ? (
          <p className="mb-2 text-[11px] text-gray-500">
            Sent {totalSent} piece{totalSent === 1 ? '' : 's'} · Returned {totalReturned} piece
            {totalReturned === 1 ? '' : 's'}
            {filtersActive && batches.length > 0
              ? ` · Showing ${filteredLineCount} line${filteredLineCount === 1 ? '' : 's'} (${filteredPieceCount} piece${filteredPieceCount === 1 ? '' : 's'})`
              : ''}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1 max-w-md">
            <label className="label text-[11px]" htmlFor="return-logs-search">
              Search
            </label>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                aria-hidden
              />
              <input
                id="return-logs-search"
                type="search"
                className="input w-full pl-8 text-xs h-8"
                placeholder="Code, name, category, type, qty, date…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
          </div>
          <div className="w-full sm:w-40">
            <label className="label text-[11px]" htmlFor="return-logs-type">
              Item type
            </label>
            <select
              id="return-logs-type"
              className="input w-full text-xs h-8 bg-surface"
              value={itemTypeFilter}
              onChange={(e) => setItemTypeFilter(e.target.value)}
            >
              {ITEM_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {filtersActive ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={FilterX}
              className="shrink-0"
              onClick={clearFilters}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
          {isLoading ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading return logs...</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No returns recorded yet.</p>
          ) : filteredBatches.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">
              No return lines match your search. Try another code, name, or clear filters.
            </p>
          ) : (
            <div className="space-y-4">
              {filteredBatches.map((batch) => (
                <section
                  key={batch.batchId}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <p className="text-xs font-semibold text-gray-900">
                      {formatDateTime(batch.returnedAt) || '—'} — {Number(batch.pieceCount || 0)} piece
                      {Number(batch.pieceCount || 0) === 1 ? '' : 's'}
                    </p>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {(batch.lines || []).map((line) => (
                      <li
                        key={`${batch.batchId}-${line.lineId}-${line.itemCode || line.itemName}`}
                        className="px-3 py-1.5 text-[11px] text-gray-700 flex items-start gap-2"
                      >
                        <span
                          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase ${
                            line.itemType === 'accessory'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {line.itemType === 'accessory' ? 'Accessory' : 'Product'}
                        </span>
                        <span className="font-mono min-w-0 break-words">{formatLineLabel(line)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
      </div>
    </Modal>
  );
};

LaundryReturnLogsModal.propTypes = {
  jobId: PropTypes.string,
  jobNo: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

export default LaundryReturnLogsModal;
