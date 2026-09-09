import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, round2, todayIndiaISODate } from '@wrs/shared';
import {
  Ban,
  Download,
  FileText,
  IndianRupee,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import SaleBillLink from '../../components/booking/SaleBillLink.jsx';
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
import { salesApi } from '../../lib/api/sales.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';
import { invalidateSalesDomain } from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';
import { downloadSale, printSale } from '../../utils/printBill.js';
import SalePaymentModal from './SalePaymentModal.jsx';
import SaleTransactionsModal from './SaleTransactionsModal.jsx';

const todayStr = () => todayIndiaISODate();

const EXPORT_PER_PAGE = 500;

const SaleList = () => {
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
    deleteFn: (row, admin_password) => salesApi.remove(row.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Sale deleted');
      await invalidateSalesDomain(queryClient);
    },
  });

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(todayStr());
  const [pendingOnly, setPendingOnly] = useState(false);
  const [paymentSaleId, setPaymentSaleId] = useState(null);
  const [transactionsSaleId, setTransactionsSaleId] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [billActionLoading, setBillActionLoading] = useState(null);

  const listQuery = useQuery({
    queryKey: ['sales', { page, perPage, search, dateFrom, dateTo, pendingOnly }],
    queryFn: () =>
      salesApi.list({
        page,
        per_page: perPage,
        search: search || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        pending_only: pendingOnly || undefined,
        sort: '-s.sale_date',
      }),
    keepPreviousData: true,
  });

  const rows = listQuery.data?.data || [];
  const meta = listQuery.data?.meta || {};

  const cancelMut = useMutation({
    mutationFn: (id) => salesApi.cancel(id),
    onSuccess: async () => {
      toast.success('Sale cancelled');
      setCancelTarget(null);
      await invalidateSalesDomain(queryClient);
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Could not cancel sale');
    },
  });

  const fetchAllFilteredSales = useCallback(async () => {
    const baseParams = {
      search: search || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      pending_only: pendingOnly || undefined,
      sort: '-s.sale_date',
    };
    let p = 1;
    const acc = [];
    let totalPages = 1;
    do {
      const res = await salesApi.list({ ...baseParams, page: p, per_page: EXPORT_PER_PAGE });
      acc.push(...(res?.data || []));
      totalPages = Number(res?.meta?.total_pages) || 1;
      p += 1;
    } while (p <= totalPages);
    return acc;
  }, [search, dateFrom, dateTo, pendingOnly]);

  const runListPdf = async (mode) => {
    setExportBusy(true);
    try {
      const exportRows = await fetchAllFilteredSales();
      if (!exportRows.length) {
        toast.warning(mode === 'print' ? 'No sales to print' : 'No sales to export');
        return;
      }
      const stamp = `${dateFrom || 'all'}_${dateTo || 'all'}`;
      const subtitleParts = [`Date ${dateFrom || '—'} to ${dateTo || '—'}`];
      if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
      if (pendingOnly) subtitleParts.push('Pending bills only');
      subtitleParts.push(`${exportRows.length} record(s)`);
      const pdfOptions = { title: 'Sales', subtitle: subtitleParts.join(' · ') };

      if (mode === 'print') {
        const { printTablePdf } = await import('../../utils/tablePdf.js');
        printTablePdf(exportColumns, exportRows, pdfOptions);
      } else {
        const { downloadTablePdf } = await import('../../utils/tablePdf.js');
        downloadTablePdf(`sales_${stamp}.pdf`, exportColumns, exportRows, pdfOptions);
        toast.success('PDF downloaded');
      }
    } catch (err) {
      toast.error(err?.message || (mode === 'print' ? 'Could not print' : 'Could not export PDF'));
    } finally {
      setExportBusy(false);
    }
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'sale_number',
        header: 'Bill No',
        columnPickerLabel: 'Bill No',
        className: 'text-xs whitespace-nowrap',
        render: (r) => <SaleBillLink saleId={r.id}>{r.sale_number}</SaleBillLink>,
      },
      {
        key: 'sale_date',
        header: 'Date & Time',
        columnPickerLabel: 'Date & Time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => formatFinancialRecordDateTime(r, 'sale_date'),
      },
      {
        key: 'customer_name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => <span className="font-medium">{r.customer_name}</span>,
      },
      {
        key: 'contact_no',
        header: 'Contact No',
        columnPickerLabel: 'Contact No',
      },
      {
        key: 'sales_person_name',
        header: 'Salesman',
        columnPickerLabel: 'Salesman',
        render: (r) => r.sales_person_name || '—',
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
        key: 'pending_amount',
        header: 'Pending Amt.',
        columnPickerLabel: 'Pending Amount',
        align: 'right',
        render: (r) =>
          formatCurrency(round2(Math.max(0, Number(r.total_amount || 0) - Number(r.advance || 0)))),
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
          <span
            title={
              r.status === 'cancelled'
                ? 'Cancelled — bill voided, stock restored, payments blocked'
                : 'Active — valid bill, payments allowed'
            }
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
        className: 'whitespace-nowrap',
        render: (r) => {
          const printBusy =
            billActionLoading?.saleId === r.id && billActionLoading?.action === 'print';
          const downloadBusy =
            billActionLoading?.saleId === r.id && billActionLoading?.action === 'download';
          const billActionBusy = billActionLoading !== null;
          return (
            <div
              className="inline-flex items-stretch gap-0 whitespace-nowrap [&>*]:m-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Pencil}
                iconOnly
                className="rounded-none bg-brand-light/60 text-brand hover:bg-brand-light"
                title="Edit"
                aria-label="Edit sale"
                onClick={() => navigate(`/sales/${r.id}/edit`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Printer}
                iconOnly
                className="rounded-none bg-green-50 text-green-700 hover:bg-green-100"
                title="Print bill"
                aria-label="Print bill"
                loading={printBusy}
                disabled={billActionBusy}
                onClick={async () => {
                  setBillActionLoading({ saleId: r.id, action: 'print' });
                  try {
                    const { data } = await salesApi.get(r.id);
                    await printSale(data);
                  } catch (err) {
                    toast.error(
                      err?.response?.data?.message || err?.message || 'Could not print bill'
                    );
                  } finally {
                    setBillActionLoading(null);
                  }
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Download}
                iconOnly
                className="rounded-none bg-gray-100 text-gray-700 hover:bg-gray-200"
                title="Download bill"
                aria-label="Download bill"
                loading={downloadBusy}
                disabled={billActionBusy}
                onClick={async () => {
                  setBillActionLoading({ saleId: r.id, action: 'download' });
                  try {
                    const { data } = await salesApi.get(r.id);
                    await downloadSale(data);
                    toast.success('Bill downloaded as PDF');
                  } catch (err) {
                    toast.error(
                      err?.response?.data?.message || err?.message || 'Could not download bill'
                    );
                  } finally {
                    setBillActionLoading(null);
                  }
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={FileText}
                iconOnly
                className="rounded-none bg-gray-50 text-gray-700 hover:bg-gray-100"
                title="Transactions"
                aria-label="Transactions"
                onClick={() => setTransactionsSaleId(r.id)}
              />
              {r.status !== 'cancelled' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={IndianRupee}
                  iconOnly
                  className="rounded-none bg-brand-light/40 text-brand hover:bg-brand-light"
                  title="Payment"
                  aria-label="Payment"
                  onClick={() => setPaymentSaleId(r.id)}
                />
              ) : null}
              {r.status !== 'cancelled' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Ban}
                  iconOnly
                  className="rounded-none bg-amber-50 text-amber-700 hover:bg-amber-100"
                  title="Cancel bill"
                  aria-label="Cancel sale"
                  onClick={() => setCancelTarget(r)}
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={Trash2}
                iconOnly
                className="rounded-none bg-red-50 text-red-600 hover:bg-red-100"
                title="Delete"
                aria-label="Delete sale"
                onClick={() => requestDelete(r)}
              />
            </div>
          );
        },
      },
    ],
    [billActionLoading, navigate, requestDelete]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('sales', allColumns, {
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
            if (c.key === 'sale_date') return formatFinancialRecordDateTime(r, 'sale_date') || '';
            if (c.key === 'sales_person_name') return r.sales_person_name || '';
            if (c.key === 'total_qty') return String(r.total_qty ?? '');
            if (c.key === 'pending_amount') {
              return formatCurrency(
                round2(Math.max(0, Number(r.total_amount || 0) - Number(r.advance || 0))),
                { showSymbol: false }
              );
            }
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
        title="Sales"
        breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: 'Sales' }]}
        actions={
          <Link to="/sales/new">
            <Button size="sm">
              <Plus size={14} className="mr-1" />
              Add Sale
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search bill, customer, product name or code…"
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
        emptyTitle="No sales found"
        emptyMessage="Create your first sale to get started."
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

      <SaleTransactionsModal
        isOpen={!!transactionsSaleId}
        saleId={transactionsSaleId}
        onClose={() => setTransactionsSaleId(null)}
        onAddPayment={(id) => {
          setTransactionsSaleId(null);
          setPaymentSaleId(id);
        }}
      />

      <SalePaymentModal
        isOpen={!!paymentSaleId}
        saleId={paymentSaleId}
        onClose={() => setPaymentSaleId(null)}
      />

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={close}
        onConfirm={confirmDelete}
        title="Delete Sale"
        description="Are you sure you want to permanently delete this sale?"
        itemLabel={deleting?.sale_number}
        shopName={selectedShopName}
        errorMessage={error}
        onClearError={clearError}
        loading={loading}
      />

      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => cancelMut.mutate(cancelTarget.id)}
        title="Cancel Sale"
        description="This will void the bill, restore stock, and block further payments. This cannot be undone."
        confirmLabel="Cancel bill"
        confirmVariant="danger"
        loading={cancelMut.isPending}
      />
    </div>
  );
};

export default SaleList;
