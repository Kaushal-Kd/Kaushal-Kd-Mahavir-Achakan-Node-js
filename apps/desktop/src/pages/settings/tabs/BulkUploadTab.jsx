import { formatDateTime } from '@wrs/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useMemo, useRef, useState } from 'react';

import AdminDeleteModal from '../../../components/ui/AdminDeleteModal.jsx';
import Button from '../../../components/ui/Button.jsx';
import DataTable from '../../../components/ui/DataTable.jsx';
import TableColumnPicker from '../../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../../hooks/useSelectedShopName.js';
import { getApiErrorMessage } from '../../../lib/apiError.js';
import { importsApi } from '../../../lib/api/imports.js';
import { invalidateCatalogDomain } from '../../../lib/queryInvalidation.js';
import { uploadToGCS } from '../../../services/gcsUpload.js';
import { toast } from '../../../stores/uiStore.js';

import Tab, { Section } from './_Tab.jsx';

const ENTITY_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'product', label: 'Products' },
  { value: 'accessory', label: 'Accessories' },
];

/** Compact default: type, file, date, status, action; hide uploader and row counts. */
const BULK_UPLOAD_HISTORY_DEFAULT_HIDDEN = [
  'created_by_name',
  'total_rows',
  'success_rows',
  'failed_rows',
  'error_count',
];

const IMAGE_MODE_OPTIONS = [
  { value: 'url', label: 'Image link', hint: 'Put full image URL in CSV column; ZIP not needed' },
  { value: 'zip', label: 'ZIP folder', hint: 'Upload ZIP; put file names in CSV column' },
  { value: 'none', label: 'No images', hint: 'Leave image column empty' },
];

const BulkUploadTab = () => {
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const [productFile, setProductFile] = useState(null);
  const [accessoryFile, setAccessoryFile] = useState(null);
  const [historyEntity, setHistoryEntity] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [productPreview, setProductPreview] = useState(null);
  const [accessoryPreview, setAccessoryPreview] = useState(null);
  const [productZipFile, setProductZipFile] = useState(null);
  const [accessoryZipFile, setAccessoryZipFile] = useState(null);
  const [productImageMode, setProductImageMode] = useState('url');
  const [accessoryImageMode, setAccessoryImageMode] = useState('url');
  const [deleteCodesText, setDeleteCodesText] = useState('');
  const [deleteCsvFile, setDeleteCsvFile] = useState(null);
  const [deletePreview, setDeletePreview] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState('');
  const pendingDeletePayloadRef = useRef(null);

  const historyQuery = useQuery({
    queryKey: ['imports-history', historyEntity, historyPage],
    queryFn: () => importsApi.listHistory({ entity: historyEntity || undefined, page: historyPage, per_page: 20 }),
    keepPreviousData: true,
    refetchInterval: (q) => {
      const rows = q.state.data?.data || [];
      const hasProcessing = rows.some((r) => r.status === 'processing');
      return hasProcessing ? 1500 : false;
    },
  });

  const downloadTemplate = async (kind) => {
    try {
      const res = kind === 'product' ? await importsApi.getProductTemplate() : await importsApi.getAccessoryTemplate();
      downloadRawCsv(res.data?.file_name || `${kind}_bulk_template.csv`, res.data?.csv || '');
    } catch (e) {
      toast.error(e?.response?.data?.error?.message || 'Could not download template');
    }
  };

  const uploadMut = useMutation({
    mutationFn: async ({ kind, file, confirm, images_zip_object_path }) => {
      const csvText = await file.text();
      const payload = {
        file_name: file.name,
        csv_text: csvText,
        allow_auto_create_missing: true,
        confirm_create_missing: !!confirm,
        auto_generate_missing_codes: true,
        images_zip_object_path: images_zip_object_path || null,
      };
      return kind === 'product' ? importsApi.uploadProducts(payload) : importsApi.uploadAccessories(payload);
    },
    onSuccess: (res, vars) => {
      const d = res?.data || {};
      if (d.mode === 'preview') {
        if (vars.kind === 'product') setProductPreview(d);
        if (vars.kind === 'accessory') setAccessoryPreview(d);
        toast.info('Review missing values and confirm creation to continue');
        return;
      }
      toast.success(
        `${vars.kind === 'product' ? 'Product' : 'Accessory'} import done. Success ${d.success_rows || 0}, Failed ${
          d.failed_rows || 0
        }`
      );
      if (vars.kind === 'product') setProductFile(null);
      if (vars.kind === 'accessory') setAccessoryFile(null);
      if (vars.kind === 'product') setProductPreview(null);
      if (vars.kind === 'accessory') setAccessoryPreview(null);
      historyQuery.refetch();
    },
    onError: (e) => toast.error(e?.response?.data?.error?.message || e?.message || 'Upload failed'),
  });

  const ensureZipUploaded = async (kind) => {
    const file = kind === 'product' ? productZipFile : accessoryZipFile;
    if (!file) return null;
    const mime = String(file.type || '').toLowerCase();
    if (mime && !['application/zip', 'application/x-zip-compressed'].includes(mime)) {
      toast.error('Please select a valid ZIP file for images');
      return null;
    }
    try {
      const uploaded = await uploadToGCS(file, {
        folder: `imports/${kind}-images`,
        contentType: 'application/zip',
        compress: false,
      });
      return uploaded.objectPath;
    } catch (e) {
      toast.error(e?.response?.data?.error?.message || e?.message || 'ZIP upload failed');
      return null;
    }
  };

  const buildBulkDeletePayload = useCallback(async () => {
    const payload = {};
    const codes = String(deleteCodesText || '')
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.length) payload.codes = codes;
    if (deleteCsvFile) payload.csv_text = await deleteCsvFile.text();
    if (!payload.codes?.length && !String(payload.csv_text || '').trim()) {
      throw new Error('Enter product codes or upload a CSV file');
    }
    return payload;
  }, [deleteCodesText, deleteCsvFile]);

  const previewDeleteMut = useMutation({
    mutationFn: async () => {
      const payload = await buildBulkDeletePayload();
      return importsApi.previewProductBulkDelete(payload);
    },
    onSuccess: (res) => {
      setDeletePreview(res?.data || null);
      toast.info('Review the summary and confirm permanent delete');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not preview delete')),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: async ({ payload, admin_password }) =>
      importsApi.bulkDeleteProducts({ ...payload, admin_password }),
    onSuccess: async (res) => {
      const d = res?.data || {};
      const n = Number(d.deleted || 0);
      setBulkDeleteOpen(false);
      setBulkDeleteError('');
      setDeletePreview(null);
      setDeleteCodesText('');
      setDeleteCsvFile(null);
      pendingDeletePayloadRef.current = null;
      toast.success(n === 1 ? '1 product permanently deleted' : `${n} products permanently deleted`);
      if (d.skipped_blocked) {
        toast.warning(`${d.skipped_blocked} product(s) skipped (active booking)`);
      }
      await invalidateCatalogDomain(queryClient);
    },
    onError: (e) => setBulkDeleteError(getApiErrorMessage(e, 'Could not delete products')),
  });

  const runDeletePreview = async () => {
    try {
      const payload = await buildBulkDeletePayload();
      pendingDeletePayloadRef.current = payload;
      await previewDeleteMut.mutateAsync();
    } catch (e) {
      toast.error(e?.message || 'Could not preview delete');
    }
  };

  const openBulkDeleteConfirm = async () => {
    if (!deletePreview?.summary?.deletable) {
      toast.error('No products eligible for permanent delete');
      return;
    }
    try {
      if (!pendingDeletePayloadRef.current) {
        pendingDeletePayloadRef.current = await buildBulkDeletePayload();
      }
      setBulkDeleteError('');
      setBulkDeleteOpen(true);
    } catch (e) {
      toast.error(e?.message || 'Could not prepare delete');
    }
  };

  const confirmBulkDelete = useCallback(
    (adminPassword) => {
      const payload = pendingDeletePayloadRef.current;
      if (!payload) {
        setBulkDeleteError('Preview expired. Run preview again.');
        return;
      }
      if (bulkDeleteMut.isPending) return;
      setBulkDeleteError('');
      bulkDeleteMut.mutate({ payload, admin_password: adminPassword });
    },
    [bulkDeleteMut]
  );

  const downloadDeleteTemplate = async () => {
    try {
      const res = await importsApi.getProductBulkDeleteTemplate();
      downloadRawCsv(res.data?.file_name || 'products_bulk_delete_template.csv', res.data?.csv || '');
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not download template'));
    }
  };

  const bulkDeleteLabel = useMemo(() => {
    const n = Number(deletePreview?.summary?.deletable || 0);
    if (!n) return '';
    return n === 1 ? '1 product' : `${n} products`;
  }, [deletePreview]);

  const runImport = async ({ kind, file, confirm }) => {
    const imageMode = kind === 'product' ? productImageMode : accessoryImageMode;
    let imagesZipObjectPath = null;
    if (imageMode === 'zip') {
      const zipFile = kind === 'product' ? productZipFile : accessoryZipFile;
      if (!zipFile) {
        toast.error('Select a ZIP file for image filenames');
        return;
      }
      imagesZipObjectPath = await ensureZipUploaded(kind);
      if (!imagesZipObjectPath) return;
    }
    await uploadMut.mutateAsync({ kind, file, confirm, images_zip_object_path: imagesZipObjectPath });
  };

  const historyColumns = useMemo(
    () => [
      {
        key: 'entity',
        header: 'Type',
        columnPickerLabel: 'Type',
        render: (r) => (r.entity === 'product' ? 'Products' : 'Accessories'),
      },
      { key: 'file_name', header: 'File', columnPickerLabel: 'File' },
      {
        key: 'created_by_name',
        header: 'Uploaded by',
        columnPickerLabel: 'Uploaded by',
        render: (r) => r.created_by_name || '—',
      },
      {
        key: 'created_at',
        header: 'Uploaded at',
        columnPickerLabel: 'Uploaded at',
        render: (r) => (r.created_at ? formatDateTime(r.created_at) : '—'),
      },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        render: (r) => (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              r.status === 'completed'
                ? 'bg-green-50 text-green-700'
                : r.status === 'failed'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-yellow-50 text-yellow-700'
            }`}
          >
            {r.status || '—'}
          </span>
        ),
      },
      { key: 'total_rows', header: 'Total', columnPickerLabel: 'Total', align: 'right' },
      { key: 'success_rows', header: 'Success', columnPickerLabel: 'Success', align: 'right' },
      { key: 'failed_rows', header: 'Failed', columnPickerLabel: 'Failed', align: 'right' },
      { key: 'error_count', header: 'Errors', columnPickerLabel: 'Errors', align: 'right' },
      {
        key: 'actions',
        header: 'Action',
        columnPickerLabel: 'Action',
        locked: true,
        render: (r) => (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={Download}
            disabled={Number(r.error_count || 0) <= 0}
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const out = await importsApi.getErrorExport(r.id);
                downloadRawCsv(out.data?.file_name || `import_errors_${r.id}.csv`, out.data?.csv || '');
              } catch (err) {
                toast.error(err?.response?.data?.error?.message || 'Could not download error report');
              }
            }}
          >
            Errors
          </Button>
        ),
      },
    ],
    []
  );

  const { visibleColumns: historyVisibleColumns, pickerProps: historyPickerProps } = useDataTableColumns(
    'settings-bulk-upload',
    historyColumns,
    { defaultHidden: BULK_UPLOAD_HISTORY_DEFAULT_HIDDEN }
  );

  const activeProcessingJob = useMemo(() => {
    const rows = historyQuery.data?.data || [];
    return rows.find((r) => r.status === 'processing') || null;
  }, [historyQuery.data]);

  return (
    <Tab
      title="Bulk Upload"
      description="Upload product and accessory data in CSV format. Images can be full URLs in CSV or file names from an optional ZIP. Existing codes are skipped (create-only mode)."
      actions={
        <Button variant="secondary" icon={RefreshCw} size="sm" onClick={() => historyQuery.refetch()}>
          Refresh history
        </Button>
      }
    >
      <Section
        title="Products CSV upload"
        description="Use Category Name (not category id). Put image URLs or ZIP file names in `main_image`. Missing categories/colors/sizes require confirmation before create."
      >
        <ImageModeSelector
          columnName="main_image"
          value={productImageMode}
          onChange={(mode) => {
            setProductImageMode(mode);
            if (mode !== 'zip') setProductZipFile(null);
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" icon={Download} onClick={() => downloadTemplate('product')}>
            Download sample CSV
          </Button>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setProductFile(e.target.files?.[0] || null)}
            className="input max-w-xs"
          />
          {productImageMode === 'zip' ? (
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(e) => setProductZipFile(e.target.files?.[0] || null)}
              className="input max-w-xs"
            />
          ) : null}
          <Button
            type="button"
            icon={FileUp}
            disabled={!productFile}
            loading={uploadMut.isPending}
            onClick={() => productFile && runImport({ kind: 'product', file: productFile, confirm: false })}
          >
            Preview & Upload products
          </Button>
          {productFile ? <span className="text-xs text-gray-500">{productFile.name}</span> : null}
          {productImageMode === 'zip' && productZipFile ? (
            <span className="text-xs text-gray-500">ZIP: {productZipFile.name}</span>
          ) : null}
        </div>
        {productPreview?.requires_confirmation ? (
          <PreviewBox
            preview={productPreview}
            onConfirm={() => productFile && runImport({ kind: 'product', file: productFile, confirm: true })}
            loading={uploadMut.isPending}
          />
        ) : null}
      </Section>

      <Section
        title="Accessories CSV upload"
        description="Use Category Name (not category id). Put image URLs or ZIP file names in `image_url`. Missing categories require confirmation before create."
      >
        <ImageModeSelector
          columnName="image_url"
          value={accessoryImageMode}
          onChange={(mode) => {
            setAccessoryImageMode(mode);
            if (mode !== 'zip') setAccessoryZipFile(null);
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" icon={Download} onClick={() => downloadTemplate('accessory')}>
            Download sample CSV
          </Button>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setAccessoryFile(e.target.files?.[0] || null)}
            className="input max-w-xs"
          />
          {accessoryImageMode === 'zip' ? (
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(e) => setAccessoryZipFile(e.target.files?.[0] || null)}
              className="input max-w-xs"
            />
          ) : null}
          <Button
            type="button"
            icon={FileUp}
            disabled={!accessoryFile}
            loading={uploadMut.isPending}
            onClick={() =>
              accessoryFile && runImport({ kind: 'accessory', file: accessoryFile, confirm: false })
            }
          >
            Preview & Upload accessories
          </Button>
          {accessoryFile ? <span className="text-xs text-gray-500">{accessoryFile.name}</span> : null}
          {accessoryImageMode === 'zip' && accessoryZipFile ? (
            <span className="text-xs text-gray-500">ZIP: {accessoryZipFile.name}</span>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          CSV includes `threshold` (low stock alert level; default 5 if omitted).
        </p>
        {accessoryPreview?.requires_confirmation ? (
          <PreviewBox
            preview={accessoryPreview}
            onConfirm={() =>
              accessoryFile && runImport({ kind: 'accessory', file: accessoryFile, confirm: true })
            }
            loading={uploadMut.isPending}
          />
        ) : null}
      </Section>

      <Section title="Upload history" description="Track total, success, failed, and error rows for each import.">
        {activeProcessingJob ? <ImportProgressCard job={activeProcessingJob} /> : null}
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="text-gray-500">Type</span>
          <select
            className="border border-gray-200 rounded px-2 py-1 bg-white"
            value={historyEntity}
            onChange={(e) => {
              setHistoryPage(1);
              setHistoryEntity(e.target.value);
            }}
          >
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value || '_'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <TableColumnPicker {...historyPickerProps} />
        </div>
        <DataTable
          columns={historyVisibleColumns}
          rows={historyQuery.data?.data || []}
          loading={historyQuery.isLoading}
          rowKey="id"
          emptyTitle="No uploads yet"
          emptyMessage="Upload a CSV to see history here."
          visibleCount={historyQuery.data?.data?.length ?? 0}
          totalCount={historyQuery.data?.meta?.total ?? 0}
          page={historyQuery.data?.meta?.page ?? historyPage}
          totalPages={historyQuery.data?.meta?.total_pages ?? 1}
          countLabel="uploads"
          onPreviousPage={() => setHistoryPage((p) => Math.max(1, p - 1))}
          onNextPage={() => setHistoryPage((p) => p + 1)}
          disablePrevious={historyPage <= 1}
          disableNext={historyPage >= (historyQuery.data?.meta?.total_pages ?? 1)}
        />
      </Section>

      <Section
        title="Bulk delete products by code"
        description="Permanently remove inactive products using catalog codes (include size suffix when applicable, e.g. S-0001[32]). Deactivate them in Products first, then preview and confirm with admin password."
      >
        <div className="space-y-3">
          <textarea
            className="input min-h-[100px] font-mono text-xs"
            placeholder="One product code per line (e.g. S-0001[32])"
            value={deleteCodesText}
            onChange={(e) => {
              setDeleteCodesText(e.target.value);
              setDeletePreview(null);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" icon={Download} onClick={downloadDeleteTemplate}>
              Download codes CSV template
            </Button>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setDeleteCsvFile(e.target.files?.[0] || null);
                setDeletePreview(null);
              }}
              className="input max-w-xs"
            />
            <Button
              type="button"
              variant="secondary"
              icon={Trash2}
              loading={previewDeleteMut.isPending}
              onClick={runDeletePreview}
            >
              Preview delete
            </Button>
            {deleteCsvFile ? <span className="text-xs text-gray-500">{deleteCsvFile.name}</span> : null}
          </div>
          <p className="text-xs text-red-600">
            Permanent delete cannot be undone. Active products and items on active bookings or in washing are blocked and will not be removed.
          </p>
        </div>
        {deletePreview ? (
          <BulkDeletePreviewBox
            preview={deletePreview}
            onConfirm={openBulkDeleteConfirm}
            loading={previewDeleteMut.isPending || bulkDeleteMut.isPending}
          />
        ) : null}
      </Section>

      <AdminDeleteModal
        isOpen={bulkDeleteOpen}
        onClose={() => {
          if (bulkDeleteMut.isPending) return;
          setBulkDeleteOpen(false);
          setBulkDeleteError('');
        }}
        onConfirm={confirmBulkDelete}
        title={
          Number(deletePreview?.summary?.deletable || 0) === 1
            ? 'Permanently delete 1 product?'
            : `Permanently delete ${deletePreview?.summary?.deletable || 0} products?`
        }
        description="These products will be removed from the database. Order line snapshots may remain but will lose the product link."
        itemLabel={bulkDeleteLabel}
        shopName={selectedShopName}
        errorMessage={bulkDeleteError}
        onClearError={() => setBulkDeleteError('')}
        loading={bulkDeleteMut.isPending}
        confirmLabel="Delete permanently"
      />
    </Tab>
  );
};

function downloadRawCsv(fileName, csvText) {
  const blob = new Blob(['\ufeff' + String(csvText || '')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'template.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export default BulkUploadTab;

const ImageModeSelector = ({ columnName, value, onChange }) => {
  const active = IMAGE_MODE_OPTIONS.find((o) => o.value === value) || IMAGE_MODE_OPTIONS[0];
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs font-medium text-gray-700 mb-2">How are images provided?</div>
      <div className="flex flex-wrap gap-3">
        {IMAGE_MODE_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
            <input
              type="radio"
              name={`image-mode-${columnName}`}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="text-brand focus:ring-brand"
            />
            {opt.label}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {active.hint}
        {value === 'url' ? ` Column: \`${columnName}\`.` : null}
        {value === 'zip' ? ` Column: \`${columnName}\` (file name only).` : null}
      </p>
    </div>
  );
};

ImageModeSelector.propTypes = {
  columnName: PropTypes.string.isRequired,
  value: PropTypes.oneOf(['url', 'zip', 'none']).isRequired,
  onChange: PropTypes.func.isRequired,
};

const BulkDeletePreviewBox = ({ preview, onConfirm, loading }) => {
  const rows = [
    ...(preview?.deletable || []).map((r) => ({ ...r, status: 'deletable' })),
    ...(preview?.blocked || []).map((r) => ({ ...r, status: 'blocked' })),
    ...(preview?.not_found || []).map((code) => ({ code, name: '—', status: 'not_found' })),
  ];

  return (
    <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900 space-y-2">
      <div className="font-medium">Delete preview</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Meta label="Requested" value={preview?.summary?.requested || 0} tone="red" />
        <Meta label="Will delete" value={preview?.summary?.deletable || 0} tone="red" />
        <Meta label="Blocked" value={preview?.summary?.blocked || 0} tone="red" />
        <Meta label="Not found" value={preview?.summary?.not_found || 0} tone="red" />
      </div>
      {rows.length ? (
        <div className="max-h-48 overflow-y-auto rounded border border-red-200 bg-white">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 font-medium">Code</th>
                <th className="px-2 py-1 font-medium">Name</th>
                <th className="px-2 py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.code}-${idx}`} className="border-t border-gray-100">
                  <td className="px-2 py-1 font-mono">{row.code}</td>
                  <td className="px-2 py-1">{row.name || '—'}</td>
                  <td className="px-2 py-1">
                    <DeleteStatusBadge status={row.status} reason={row.reason} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={onConfirm}
        loading={loading}
        disabled={!preview?.summary?.deletable}
      >
        OK — confirm permanent delete
      </Button>
    </div>
  );
};

BulkDeletePreviewBox.propTypes = {
  preview: PropTypes.object,
  onConfirm: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

const DeleteStatusBadge = ({ status, reason }) => {
  if (status === 'deletable') {
    return <span className="text-green-700 font-medium">Will delete</span>;
  }
  if (status === 'blocked') {
    return <span className="text-yellow-800" title={reason || ''}>Blocked</span>;
  }
  return <span className="text-gray-500">Not found</span>;
};

DeleteStatusBadge.propTypes = {
  status: PropTypes.string.isRequired,
  reason: PropTypes.string,
};

const PreviewBox = ({ preview, onConfirm, loading }) => (
  <div className="mt-3 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900 space-y-2">
    <div className="font-medium">Confirmation required before import</div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <Meta label="Rows" value={preview?.summary?.total_rows || 0} />
      <Meta label="Valid candidates" value={preview?.summary?.valid_candidate_rows || 0} />
      <Meta label="Failed rows" value={preview?.summary?.failed_rows || 0} />
      <Meta
        label="Missing masters"
        value={
          (preview?.missing_product_categories?.length || 0) +
          (preview?.missing_accessory_categories?.length || 0) +
          (preview?.missing_colors?.length || 0) +
          (preview?.missing_sizes?.length || 0)
        }
      />
    </div>
    {preview?.missing_product_categories?.length ? (
      <div>Missing product categories: {preview.missing_product_categories.join(', ')}</div>
    ) : null}
    {preview?.missing_accessory_categories?.length ? (
      <div>Missing accessory categories: {preview.missing_accessory_categories.join(', ')}</div>
    ) : null}
    {preview?.missing_colors?.length ? <div>Missing colors: {preview.missing_colors.join(', ')}</div> : null}
    {preview?.missing_sizes?.length ? <div>Missing sizes: {preview.missing_sizes.join(', ')}</div> : null}
    <Button type="button" size="sm" onClick={onConfirm} loading={loading}>
      Confirm create missing and import
    </Button>
  </div>
);

const Meta = ({ label, value, tone = 'yellow' }) => (
  <div
    className={`rounded border bg-white px-2 py-1 ${
      tone === 'red' ? 'border-red-200' : 'border-yellow-200'
    }`}
  >
    <div className={`text-[10px] ${tone === 'red' ? 'text-red-700' : 'text-yellow-700'}`}>{label}</div>
    <div className="font-semibold">{value}</div>
  </div>
);

Meta.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  tone: PropTypes.oneOf(['yellow', 'red']),
};

const ImportProgressCard = ({ job }) => {
  const total = Number(job?.total_rows || 0);
  const success = Number(job?.success_rows || 0);
  const failed = Number(job?.failed_rows || 0);
  const processed = Math.max(0, success + failed);
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  return (
    <div className="mb-3 rounded-md border border-brand/30 bg-brand/5 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-brand">
          Import in progress: {job?.entity === 'product' ? 'Products' : 'Accessories'}
        </span>
        <span className="text-gray-600">{percent}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200">
        <div className="h-full bg-brand transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-gray-600">
        Processed {processed}/{total || '...'} · Success {success} · Failed {failed}
      </div>
      {job?.summary_message ? <div className="mt-1 text-[11px] text-gray-500">{job.summary_message}</div> : null}
    </div>
  );
};
