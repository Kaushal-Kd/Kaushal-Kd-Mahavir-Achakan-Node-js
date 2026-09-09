import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDaysIso, formatCurrency, formatDate, todayIndiaISODate } from '@wrs/shared';
import { Ban, Download, FileText, IndianRupee, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { purchasesApi } from '../../lib/api/purchases.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';
import PurchasePaymentModal from './PurchasePaymentModal.jsx';
import PurchaseTransactionsModal from './PurchaseTransactionsModal.jsx';

const todayStr = () => todayIndiaISODate();

const EXPORT_PER_PAGE = 500;

const PurchaseList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedShopName = useSelectedShopName();
  const {
    target: deleting,
    requestDelete,
    confirmDelete,
    error,
    clearError,
    loading,
    close,
  } = useAdminDelete({
    deleteFn: (row, admin_password) => purchasesApi.remove(row.id, { admin_password }),
    onSuccess: () => {
      toast.success('Purchase deleted');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
  });

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(todayStr());
  const [pendingOnly, setPendingOnly] = useState(false);
  const [paymentPurchaseId, setPaymentPurchaseId] = useState(null);
  const [transactionsPurchaseId, setTransactionsPurchaseId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);

  const listQuery = useQuery({
    queryKey: ['purchases', { page, perPage, search, dateFrom, dateTo, pendingOnly }],
    queryFn: () =>
      purchasesApi.list({
        page,
        per_page: perPage,
        search: search || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        pending_only: pendingOnly || undefined,
        sort: '-p.purchase_date',
      }),
    keepPreviousData: true,
  });

  const rows = listQuery.data?.data || [];
  const meta = listQuery.data?.meta || {};

  const cancelMut = useMutation({
    mutationFn: (id) => purchasesApi.cancel(id),
    onSuccess: async () => {
      toast.success('Purchase cancelled');
      setCancelTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Could not cancel purchase');
    },
  });

  const fetchAllFilteredPurchases = useCallback(async () => {
    const baseParams = {
      search: search || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      pending_only: pendingOnly || undefined,
      sort: '-p.purchase_date',
    };
    let p = 1;
    const acc = [];
    let totalPages = 1;
    do {
      const res = await purchasesApi.list({ ...baseParams, page: p, per_page: EXPORT_PER_PAGE });
      acc.push(...(res?.data || []));
      totalPages = Number(res?.meta?.total_pages) || 1;
      p += 1;
    } while (p <= totalPages);
    return acc;
  }, [search, dateFrom, dateTo, pendingOnly]);

  const runListPdf = async (mode) => {
    setExportBusy(true);
    try {
      const exportRows = await fetchAllFilteredPurchases();
      if (!exportRows.length) {
        toast.warning(mode === 'print' ? 'No purchases to print' : 'No purchases to export');
        return;
      }
      const stamp = `${dateFrom || 'all'}_${dateTo || 'all'}`;
      const subtitleParts = [`Date ${dateFrom || '—'} to ${dateTo || '—'}`];
      if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
      if (pendingOnly) subtitleParts.push('Pending bills only');
      subtitleParts.push(`${exportRows.length} record(s)`);
      const pdfOptions = { title: 'Purchases', subtitle: subtitleParts.join(' · ') };

      if (mode === 'print') {
        const { printTablePdf } = await import('../../utils/tablePdf.js');
        printTablePdf(exportColumns, exportRows, pdfOptions);
      } else {
        const { downloadTablePdf } = await import('../../utils/tablePdf.js');
        downloadTablePdf(`purchases_${stamp}.pdf`, exportColumns, exportRows, pdfOptions);
        toast.success('PDF downloaded');
      }
    } catch (err) {
      toast.error(
        err?.message || (mode === 'print' ? 'Could not print' : 'Could not export PDF')
      );
    } finally {
      setExportBusy(false);
    }
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'purchase_number',
        header: 'Bill No',
        columnPickerLabel: 'Bill No',
        render: (r) => (
          <Link to={`/purchases/${r.id}/edit`} className="text-brand font-medium hover:underline">
            {r.purchase_number}
          </Link>
        ),
      },
      {
        key: 'purchase_date',
        header: 'Date & Time',
        columnPickerLabel: 'Date & Time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => formatFinancialRecordDateTime(r, 'purchase_date'),
      },
      {
        key: 'vendor_account_name',
        header: 'Vendor',
        columnPickerLabel: 'Vendor',
        render: (r) => <span className="font-medium">{r.vendor_account_name || '—'}</span>,
      },
      {
        key: 'purchase_account_name',
        header: 'Purchase Acc.',
        columnPickerLabel: 'Purchase Acc.',
        render: (r) => r.purchase_account_name || '—',
      },
      {
        key: 'terms_days',
        header: 'Terms',
        columnPickerLabel: 'Terms',
        render: (r) => (r.terms_days != null ? String(r.terms_days) : '—'),
      },
      {
        key: 'due_date',
        header: 'Due Date',
        columnPickerLabel: 'Due Date',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => {
          const base = String(r.purchase_date || '').slice(0, 10);
          if (!base) return '—';
          const days = Math.max(0, Number(r.terms_days) || 0);
          const due = days ? addDaysIso(base, days) : base;
          return formatDate(due) || '—';
        },
      },
      {
        key: 'total_qty',
        header: 'Total Qty',
        columnPickerLabel: 'Total Qty',
        align: 'right',
        render: (r) => r.total_qty ?? '-',
      },
      {
        key: 'total_amount',
        header: 'Bill Amt.',
        columnPickerLabel: 'Bill Amt.',
        align: 'right',
        render: (r) => formatCurrency(r.total_amount),
      },
      {
        key: 'advance',
        header: 'Advance',
        columnPickerLabel: 'Advance',
        align: 'right',
        render: (r) => formatCurrency(r.advance),
      },
      {
        key: 'discount_amount',
        header: 'Discount',
        columnPickerLabel: 'Discount',
        align: 'right',
        render: (r) => formatCurrency(r.discount_amount),
      },
      {
        key: 'tax_total',
        header: 'GST Amt.',
        columnPickerLabel: 'GST Amt.',
        align: 'right',
        render: (r) => formatCurrency(r.tax_total),
      },
      {
        key: 'status',
        header: 'Status',
        columnPickerLabel: 'Status',
        render: (r) => (
          <span title={r.status === 'cancelled'
            ? 'Cancelled — bill voided, stock reversed, payments blocked'
            : 'Active — valid bill, payments allowed'}
          >
            <Badge tone={r.status === 'cancelled' ? 'red' : 'green'}>
              {r.status === 'cancelled' ? 'Cancelled' : 'Active'}
            </Badge>
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Action',
        locked: true,
        render: (r) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Edit"
            className="p-1 rounded hover:bg-gray-100 text-brand"
            onClick={() => navigate(`/purchases/${r.id}/edit`)}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            title="Transactions"
            className="p-1 rounded hover:bg-gray-100 text-gray-700"
            onClick={() => setTransactionsPurchaseId(r.id)}
          >
            <FileText size={14} />
          </button>
          {r.status !== 'cancelled' ? (
            <button
              type="button"
              title="Payment"
              className="p-1 rounded hover:bg-gray-100 text-brand"
              onClick={() => setPaymentPurchaseId(r.id)}
            >
              <IndianRupee size={14} />
            </button>
          ) : null}
          {r.status !== 'cancelled' ? (
            <button
              type="button"
              title="Cancel bill"
              className="p-1 rounded hover:bg-amber-50 text-amber-700"
              onClick={() => setCancelTarget(r)}
            >
              <Ban size={14} />
            </button>
          ) : null}
          <button
            type="button"
            title="Delete"
            className="p-1 rounded hover:bg-gray-100 text-red-500"
            onClick={() => requestDelete(r)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
    ],
    [navigate, requestDelete]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('purchases', allColumns, {
    defaultHidden: [],
  });

  const exportColumns = useMemo(
    () =>
      visibleColumns
        .filter((c) => c.key !== 'actions')
        .map((c) => ({
          key: c.key,
          header: c.columnPickerLabel || String(c.header || c.key),
          get: (r) => {
            if (c.key === 'purchase_date') return formatFinancialRecordDateTime(r, 'purchase_date') || '';
            if (c.key === 'due_date') {
              const base = String(r.purchase_date || '').slice(0, 10);
              if (!base) return '';
              const days = Math.max(0, Number(r.terms_days) || 0);
              return formatDate(days ? addDaysIso(base, days) : base) || '';
            }
            if (c.key === 'terms_days') return String(r.terms_days ?? '');
            if (c.key === 'total_qty') return String(r.total_qty ?? '');
            if (c.key === 'total_amount') {
              return formatCurrency(r.total_amount, { showSymbol: false });
            }
            if (c.key === 'advance') {
              return formatCurrency(r.advance, { showSymbol: false });
            }
            if (c.key === 'discount_amount') {
              return formatCurrency(r.discount_amount, { showSymbol: false });
            }
            if (c.key === 'tax_total') {
              return formatCurrency(r.tax_total, { showSymbol: false });
            }
            if (c.key === 'status') {
              return r.status === 'cancelled' ? 'Cancelled' : 'Active';
            }
            return r[c.key] ?? '';
          },
        })),
    [visibleColumns]
  );

  return (
    <div className="">
      <PageHeader
        title="Purchases"
        breadcrumbs={[
          { label: 'Dashboard', to: '/' },
          { label: 'Purchases' },
        ]}
        actions={
          <Link to="/purchases/new">
            <Button size="sm">
              <Plus size={14} className="mr-1" />
              Add Purchase
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            className="border border-gray-200 rounded-md pl-8 pr-3 py-1.5 text-sm w-48"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <input
          type="date"
          className="border border-gray-200 rounded-md px-2.5 py-1.5 text-sm"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
        />
        <span className="text-gray-400 text-xs">to</span>
        <input
          type="date"
          className="border border-gray-200 rounded-md px-2.5 py-1.5 text-sm"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
        />

        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => {
              setPendingOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300"
          />
          Pending Bills
        </label>

        <TableColumnPicker {...pickerProps} />

        <ListPdfToolbarButtons
          className="ml-auto"
          busy={exportBusy}
          disabled={listQuery.isLoading || listQuery.isFetching}
          onPrint={() => runListPdf('print')}
          onExport={() => runListPdf('download')}
        />
      </div>

      <DataTable
        columns={visibleColumns}
        rows={rows}
        loading={listQuery.isLoading}
        rowKey="id"
        emptyTitle="No purchases found"
        emptyMessage="Create your first purchase to get started."
        getRowClassName={(r) => (r.status === 'cancelled' ? 'opacity-50' : '')}
        visibleCount={rows.length}
        totalCount={meta?.total ?? 0}
        page={meta?.page ?? page}
        totalPages={meta?.total_pages ?? 1}
        countLabel="records"
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        disablePrevious={page <= 1}
        disableNext={page >= (meta?.total_pages ?? 1)}
        perPage={perPage}
        onPerPageChange={(n) => {
          setPage(1);
          setPerPage(n);
        }}
      />

      <PurchaseTransactionsModal
        isOpen={!!transactionsPurchaseId}
        purchaseId={transactionsPurchaseId}
        onClose={() => setTransactionsPurchaseId(null)}
        onAddPayment={(id) => {
          setTransactionsPurchaseId(null);
          setPaymentPurchaseId(id);
        }}
      />

      <PurchasePaymentModal
        isOpen={!!paymentPurchaseId}
        purchaseId={paymentPurchaseId}
        onClose={() => setPaymentPurchaseId(null)}
      />

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={close}
        onConfirm={confirmDelete}
        title="Delete Purchase"
        description="Are you sure you want to permanently delete this purchase?"
        itemLabel={deleting?.purchase_number}
        shopName={selectedShopName}
        errorMessage={error}
        onClearError={clearError}
        loading={loading}
      />

      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => cancelMut.mutate(cancelTarget.id)}
        title="Cancel Purchase"
        description="This will void the bill, restore stock, and block further payments. This cannot be undone."
        confirmLabel="Cancel bill"
        confirmVariant="danger"
        loading={cancelMut.isPending}
      />
    </div>
  );
};

export default PurchaseList;
