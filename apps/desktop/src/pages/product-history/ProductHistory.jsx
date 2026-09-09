import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatDate, ORDER_STATUS_LABELS } from '@wrs/shared';
import cn from 'clsx';
import { Camera, FileSpreadsheet, Search } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useState } from 'react';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import BarcodeScannerModal from '../../components/ui/BarcodeScannerModal.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { productsApi } from '../../lib/api/products.js';
import { reportsApi } from '../../lib/api/reports.js';
import { toast } from '../../stores/uiStore.js';
import { downloadCsv } from '../../utils/csv.js';

function naText(v) {
  if (v == null || v === '') return 'N/A';
  return String(v);
}

function Field({ label, value, valueClassName }) {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm">
      <span className="font-semibold text-gray-800 shrink-0">{label}:</span>
      <span className={cn('text-gray-700', valueClassName)}>{value}</span>
    </div>
  );
}

Field.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  valueClassName: PropTypes.string,
};

Field.defaultProps = { valueClassName: undefined };

const SEARCH_INPUT_ID = 'product-history-search';

const PRODUCT_HISTORY_LINES_DEFAULT_HIDDEN = ['qty'];

const ProductHistory = () => {
  const [draft, setDraft] = useState('');
  const [params, setParams] = useState(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);

  const draftTrim = draft.trim();
  /** Dropdown row 0 is the camera / scan action; rows 1..n are `productMatches`. */
  const scanRowCount = 1;

  const productSearchQuery = useQuery({
    queryKey: ['product-history-autocomplete', draftTrim],
    queryFn: () =>
      productsApi.list({ search: draftTrim, per_page: 20, page: 1 }).then((r) => r.data || []),
    enabled: draftTrim.length >= 1,
    keepPreviousData: true,
  });

  const productMatches = useMemo(() => {
    const d = productSearchQuery.data;
    return Array.isArray(d) ? d : [];
  }, [productSearchQuery.data]);

  useEffect(() => {
    const maxIdx = Math.max(0, scanRowCount + productMatches.length - 1);
    setHighlightIdx((h) => Math.min(Math.max(0, h), maxIdx));
  }, [draftTrim, productMatches.length]);

  const {
    data: res,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['reports', 'product-history', params],
    queryFn: () => reportsApi.productHistory(params),
    enabled: Boolean(params && (params.q || params.product_id)),
    keepPreviousData: true,
  });

  const payload = res?.data;
  const productIdForHistory = payload?.found && payload?.product?.id ? payload.product.id : null;

  const { data: histRes, isLoading: histLoading } = useQuery({
    queryKey: ['products', productIdForHistory, 'rental-history', { show_all: true }],
    queryFn: () => productsApi.rentalHistory(productIdForHistory, { show_all: true }),
    enabled: Boolean(productIdForHistory),
  });

  const histRows = histRes?.data?.rows ?? [];

  const allHistoryColumns = useMemo(
    () => [
      {
        key: 'bill_no',
        header: 'Bill No.',
        columnPickerLabel: 'Bill No.',
        render: (r) => <BookingBillLink orderId={r.order_id}>{r.bill_no ?? '—'}</BookingBillLink>,
      },
      {
        key: 'customer_name',
        header: 'Customer',
        columnPickerLabel: 'Customer',
        render: (r) => naText(r.customer_name),
      },
      {
        key: 'customer_address',
        header: 'Address',
        columnPickerLabel: 'Address',
        render: (r) => naText(r.customer_address),
      },
      {
        key: 'pickup_date',
        header: 'Pickup',
        columnPickerLabel: 'Pickup date',
        render: (r) => (r.pickup_date ? formatDate(r.pickup_date) : '—'),
      },
      {
        key: 'return_date',
        header: 'Return',
        columnPickerLabel: 'Return date',
        render: (r) => (r.return_date ? formatDate(r.return_date) : '—'),
      },
      {
        key: 'qty',
        header: 'Qty',
        columnPickerLabel: 'Quantity',
        align: 'right',
        render: (r) => r.qty,
      },
      {
        key: 'rent',
        header: 'Rent',
        columnPickerLabel: 'Rent',
        align: 'right',
        render: (r) => formatCurrency(r.rent),
      },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        render: (r) => ORDER_STATUS_LABELS[r.status] || r.status || '—',
      },
    ],
    []
  );

  const { visibleColumns: historyVisibleColumns, pickerProps: historyPickerProps } =
    useDataTableColumns('product-history-lines', allHistoryColumns, {
      defaultHidden: PRODUCT_HISTORY_LINES_DEFAULT_HIDDEN,
    });

  const historyExportColumns = useMemo(
    () =>
      historyVisibleColumns.map((column) => ({
        key: column.key,
        header: column.columnPickerLabel || column.key,
        get: (row) => {
          if (column.key === 'pickup_date' || column.key === 'return_date') {
            return row[column.key] ? formatDate(row[column.key]) : '';
          }
          if (column.key === 'rent') return formatCurrency(row.rent);
          if (column.key === 'status') return ORDER_STATUS_LABELS[row.status] || row.status || '';
          return row[column.key] ?? '';
        },
      })),
    [historyVisibleColumns]
  );

  const openScanner = useCallback(() => {
    setSuggestOpen(false);
    setScannerOpen(true);
  }, []);

  const applyPickedProduct = useCallback((row) => {
    setDraft(row.code || row.name || '');
    setParams({ product_id: row.id });
    setSuggestOpen(false);
  }, []);

  const onSearch = useCallback(() => {
    const q = draft.trim();
    if (!q) {
      setParams(null);
      return;
    }
    setParams({ q });
    setSuggestOpen(false);
  }, [draft]);

  const onPickMatch = useCallback((id) => {
    setParams({ product_id: id });
  }, []);

  const onScannedCode = useCallback((scanned) => {
    const code = String(scanned || '').trim();
    if (!code) return;
    setScannerOpen(false);
    setDraft(code);
    setSuggestOpen(true);
    setHighlightIdx(0);
    setParams({ q: code });
    toast.success(`Scanned ${code}`);
  }, []);

  const onSearchKeyDown = useCallback(
    (e) => {
      const rowCount = scanRowCount + productMatches.length;
      if (!suggestOpen || draftTrim.length < 1) {
        if (e.key === 'Enter') onSearch();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestOpen(true);
        setHighlightIdx((h) => Math.min(h + 1, Math.max(0, rowCount - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIdx === 0) {
          openScanner();
        } else {
          const p = productMatches[highlightIdx - 1];
          if (p) applyPickedProduct(p);
        }
      } else if (e.key === 'Escape') {
        setSuggestOpen(false);
      }
    },
    [
      suggestOpen,
      draftTrim.length,
      productMatches,
      highlightIdx,
      onSearch,
      openScanner,
      applyPickedProduct,
    ]
  );

  const banner = useMemo(() => {
    if (!params) return { text: 'Search by product name or code', tone: 'muted' };
    if (isLoading || isFetching) return { text: 'Loading…', tone: 'muted' };
    if (!payload) return { text: 'No Record Found', tone: 'warn' };
    if (payload.ambiguous) return { text: 'Multiple matches — select a product', tone: 'warn' };
    if (!payload.found) return { text: 'No Record Found', tone: 'warn' };
    return { text: payload.product?.name || 'Record found', tone: 'ok' };
  }, [params, isLoading, isFetching, payload]);

  const p = payload?.found ? payload.product : null;
  const s = payload?.found ? payload.stats : null;

  const showSuggestPanel = suggestOpen && draftTrim.length >= 1;

  return (
    <>
      <PageHeader
        title="Product History"
        description="Search a product by name or code for totals and booking lines."
      />

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1 max-w-md relative">
          <label htmlFor={SEARCH_INPUT_ID} className="label">
            Name or code
          </label>
          <input
            id={SEARCH_INPUT_ID}
            className="input pr-11"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSuggestOpen(true);
              setHighlightIdx(0);
            }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setSuggestOpen(false), 140);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Type name or code, or scan"
            autoComplete="off"
          />
          <div className="absolute right-2 bottom-1.5 flex items-center gap-0.5">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={openScanner}
              className="p-0 rounded-md text-gray-500 hover:text-brand hover:bg-brand-light/60"
              title="Scan barcode / QR"
              aria-label="Scan barcode or QR code"
            >
              <Camera size={16} />
            </button>
          </div>

          {showSuggestPanel ? (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-72 overflow-y-auto">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={openScanner}
                className={cn(
                  'w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 border-b border-gray-100',
                  highlightIdx === 0 ? 'bg-brand-light' : 'hover:bg-gray-50'
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-brand">
                  <Camera size={18} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-gray-800">Scan barcode / QR</div>
                  <div className="text-[11px] text-gray-500">Use camera to read product code</div>
                </div>
              </button>

              {productSearchQuery.isLoading && productMatches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
              ) : productMatches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500">No matching products</div>
              ) : (
                productMatches.map((row, idx) => {
                  const listIdx = idx + 1;
                  return (
                    <button
                      type="button"
                      key={row.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyPickedProduct(row)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm flex items-center gap-3 border-b border-gray-50 last:border-0',
                        highlightIdx === listIdx ? 'bg-brand-light' : 'hover:bg-gray-50'
                      )}
                    >
                      <SmartImage
                        src={row.main_image}
                        alt={row.name}
                        className="w-8 h-8 rounded border border-gray-100 bg-gray-50 object-contain shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-800 truncate">{row.name}</div>
                        <div className="text-[11px] text-gray-500 font-mono">
                          {row.code}
                          {row.color ? ` · ${row.color}` : ''}
                          {row.size ? ` · ${row.size}` : ''}
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">qty {row.qty ?? 0}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
        <Button type="button" variant="primary" onClick={onSearch} className="shrink-0">
          <Search size={16} className="mr-1.5 inline-block align-middle" />
          Search
        </Button>
      </div>

      {payload?.ambiguous && Array.isArray(payload.matches) ? (
        <div className="card p-4 mb-4">
          <p className="text-sm text-gray-600 mb-3">Choose one product:</p>
          <ul className="space-y-2">
            {payload.matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="text-left w-full px-3 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-sm"
                  onClick={() => onPickMatch(m.id)}
                >
                  <span className="font-mono text-brand">{m.code}</span>
                  <span className="mx-2 text-gray-400">·</span>
                  <span className="font-medium text-gray-900">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="card overflow-hidden border border-gray-200">
        <div
          className={cn(
            'px-4 py-2 text-center text-sm font-medium border-b border-gray-200',
            banner.tone === 'ok' && 'bg-brand-light text-brand',
            banner.tone === 'warn' && 'bg-yellow-50 text-yellow-900',
            banner.tone === 'muted' && 'bg-gray-50 text-gray-600'
          )}
        >
          {banner.text}
        </div>

        <div className="p-4 flex flex-col sm:flex-row gap-6">
          <div className="shrink-0 flex justify-center sm:block">
            <SmartImage
              src={p?.main_image}
              alt={p?.name || 'Product'}
              className="w-36 h-36 rounded-md bg-gray-50 object-contain border border-gray-100"
            />
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            <div className="space-y-1.5">
              <Field label="Name" value={p ? p.name : 'N/A'} />
              <Field label="Code" value={p ? <span className="font-mono">{p.code}</span> : 'N/A'} />
              <Field label="Qty" value={p ? String(p.qty) : '0'} />
              <Field label="Color" value={p ? naText(p.color) : 'N/A'} />
              <Field label="Size" value={p ? naText(p.size) : 'N/A'} />
              <Field label="Remarks" value={p ? naText(p.remarks) : 'N/A'} />
            </div>
            <div className="space-y-1.5">
              <Field label="MRP" value={p ? formatCurrency(p.mrp) : formatCurrency(0)} />
              <Field
                label="Purchase Price"
                value={p ? formatCurrency(p.purchase_price) : formatCurrency(0)}
              />
              <Field
                label="Total Rent"
                value={s ? formatCurrency(s.total_rent) : formatCurrency(0)}
                valueClassName="text-green-700 font-medium"
              />
              <Field
                label="Total Discount"
                value={s ? formatCurrency(s.total_discount) : formatCurrency(0)}
                valueClassName="text-red-600 font-medium"
              />
              <Field
                label="Total Earning"
                value={s ? formatCurrency(s.total_earning) : formatCurrency(0)}
                valueClassName="text-green-700 font-medium"
              />
              <Field label="Total book count" value={s ? String(s.book_count) : '0'} />
            </div>
          </div>
        </div>
      </div>

      {productIdForHistory ? (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gray-800">Booking lines</h2>
            <div className="flex items-center gap-2">
              <TableColumnPicker {...historyPickerProps} />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={FileSpreadsheet}
                onClick={() =>
                  downloadCsv(
                    `product_history_${p?.code || productIdForHistory}.csv`,
                    historyExportColumns,
                    histRows
                  )
                }
                disabled={histLoading || histRows.length === 0}
              >
                Export
              </Button>
            </div>
          </div>
          <DataTable
            columns={historyVisibleColumns}
            rows={histRows}
            loading={histLoading}
            emptyTitle="No booking lines for this product"
            visibleCount={histRows.length}
            totalCount={histRows.length}
            countLabel="lines"
          />
        </div>
      ) : null}

      <BarcodeScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={onScannedCode}
        title="Scan product barcode / QR"
      />
    </>
  );
};

ProductHistory.propTypes = {};

export default ProductHistory;
