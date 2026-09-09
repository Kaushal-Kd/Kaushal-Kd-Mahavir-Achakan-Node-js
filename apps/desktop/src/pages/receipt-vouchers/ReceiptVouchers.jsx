import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createReceiptVoucherBodySchema,
  formatCurrency,
  formatDate,
  formatDateTime,
  todayIndiaISODate,
  toLocalISODate,
} from '@wrs/shared';
import { Download, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { receiptVouchersApi } from '../../lib/api/receiptVouchers.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';
import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import {
  exportFilteredListPdf,
  exportFilteredListPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';
import { invalidateAccountingDomain } from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { createVoucherLoadGuard } from '../../lib/voucherLoadGuard.js';
import {
  clearFieldError,
  fieldShellClass,
  rejectSubmit,
  zodIssuesToFieldMap,
} from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';

const todayStr = () => todayIndiaISODate();

function currentVoucherScope() {
  const user = useAuthStore.getState().user;
  return `${user?.id || ''}:${useShopStore.getState().selectedShopId || user?.shop_id || ''}`;
}

function normGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const emptyForm = () => ({
  debit_account_id: '',
  credit_account_id: '',
  entry_date: todayStr(),
  amount: '',
  remarks: '',
});

function entryDateForInput(value) {
  if (value == null || value === '') return todayStr();
  if (typeof value === 'string') return value.slice(0, 10);
  try {
    return toLocalISODate(value);
  } catch {
    return todayStr();
  }
}

function rowToForm(row) {
  return {
    debit_account_id: row.debit_account_id || '',
    credit_account_id: row.credit_account_id || '',
    entry_date: entryDateForInput(row.entry_date),
    amount: row.amount != null && row.amount !== '' ? String(row.amount) : '',
    remarks: row.remarks != null ? String(row.remarks) : '',
  };
}

function toNonNegativeNumber(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

const ReceiptVouchers = () => {
  const linkGuard = useMemo(() => createVoucherLoadGuard(currentVoucherScope), []);
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filterEntryDate, setFilterEntryDate] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const err = (key) => fieldErrors[key];
  const [exportBusy, setExportBusy] = useState(false);
  const queryClient = useQueryClient();
  const shopName = useSelectedShopName();

  const adminDelete = useAdminDelete({
    deleteFn: (row, admin_password) => receiptVouchersApi.remove(row.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Receipt voucher removed');
      await invalidateAccountingDomain(queryClient);
    },
    onError: (e) => {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to delete';
      toast.error(msg);
    },
  });

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const accountsQuery = useQuery({
    queryKey: ['payment-accounts'],
    queryFn: () => paymentAccountsApi.list(),
  });

  const listFilterParams = useMemo(
    () => ({
      sort: '-entry_date',
      ...(search ? { search } : {}),
      ...(filterEntryDate ? { entry_date: filterEntryDate } : {}),
    }),
    [search, filterEntryDate]
  );

  const listQuery = useQuery({
    queryKey: ['receipt-vouchers', { page, perPage, listFilterParams }],
    queryFn: () =>
      receiptVouchersApi.list({
        ...listFilterParams,
        page,
        per_page: perPage,
      }),
    keepPreviousData: true,
  });

  const accounts = accountsQuery.data?.data || [];

  const bankCashAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (a.is_active === false) return false;
        const g = normGroup(a.account_group);
        return g === 'bank accounts' || g === 'cash accounts';
      }),
    [accounts]
  );

  const partyVendorAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (a.is_active === false) return false;
        const g = normGroup(a.account_group);
        return g === 'parties' || g === 'vendors';
      }),
    [accounts]
  );

  const accountNameById = useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const saveMut = useMutation({
    mutationFn: ({ id, body }) =>
      id ? receiptVouchersApi.update(id, body) : receiptVouchersApi.create(body),
    onSuccess: async (_, variables) => {
      toast.success(variables.id ? 'Receipt voucher updated' : 'Receipt voucher saved');
      await invalidateAccountingDomain(queryClient);
      setModalOpen(false);
      setEditingId(null);
      setEditSnapshot(null);
      setForm(emptyForm());
      setFieldErrors({});
    },
    onError: (e) => {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to save';
      toast.error(msg);
    },
  });

  const openCreate = () => {
    linkGuard.cancel();
    setEditingId(null);
    setEditSnapshot(null);
    setForm(emptyForm());
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = useCallback(
    (row) => {
      linkGuard.cancel();
      const f = rowToForm(row);
      setEditingId(row.id);
      setEditSnapshot(f);
      setForm(f);
      setFieldErrors({});
      setModalOpen(true);
    },
    [linkGuard]
  );

  useEffect(() => {
    const id = searchParams.get('edit');
    if (!id) return undefined;
    let cancelled = false;
    const isCurrent = linkGuard.start();
    receiptVouchersApi
      .get(id)
      .then((response) => {
        if (!cancelled && isCurrent()) openEdit(response.data);
      })
      .catch((error) => {
        if (!cancelled && isCurrent())
          toast.error(error?.response?.data?.error?.message || 'Could not open receipt voucher');
      })
      .finally(() => {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete('edit');
          setSearchParams(next, { replace: true });
        }
      });
    return () => {
      cancelled = true;
      linkGuard.cancel();
    };
  }, [searchParams, setSearchParams, openEdit, linkGuard]);

  const closeModal = () => {
    linkGuard.cancel();
    setModalOpen(false);
    setEditingId(null);
    setEditSnapshot(null);
    setForm(emptyForm());
    setFieldErrors({});
  };

  const resetForm = () => {
    if (editingId && editSnapshot) {
      setForm({ ...editSnapshot });
      setFieldErrors({});
      return;
    }
    setForm(emptyForm());
    setFieldErrors({});
  };

  const submitForm = () => {
    if (saveMut.isPending) return;
    const remarksTrim = String(form.remarks || '').trim();
    const payload = {
      debit_account_id: String(form.debit_account_id || '').trim(),
      credit_account_id: String(form.credit_account_id || '').trim(),
      entry_date: form.entry_date,
      amount: Number(form.amount),
      ...(remarksTrim ? { remarks: remarksTrim } : {}),
    };
    const parsed = createReceiptVoucherBodySchema.safeParse(payload);
    if (!parsed.success) {
      const errors = zodIssuesToFieldMap(parsed.error.errors);
      if (!form.debit_account_id && !errors.debit_account_id) {
        errors.debit_account_id = 'The account is required';
      }
      if (!form.credit_account_id && !errors.credit_account_id) {
        errors.credit_account_id = 'Credited account is required';
      }
      rejectSubmit({ errors, setErrors: setFieldErrors, toast });
      return;
    }
    setFieldErrors({});
    saveMut.mutate({ id: editingId, body: parsed.data });
  };

  const openCreateWithFilterDate = () => {
    linkGuard.cancel();
    setEditingId(null);
    setEditSnapshot(null);
    setForm({ ...emptyForm(), entry_date: filterEntryDate || todayStr() });
    setFieldErrors({});
    setModalOpen(true);
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'voucher_number',
        header: 'Voucher No',
        columnPickerLabel: 'Voucher No',
        render: (row) => (
          <button
            type="button"
            className="font-mono text-xs text-brand hover:underline"
            onClick={() => openEdit(row)}
            title="Open receipt voucher"
          >
            {row.voucher_number}
          </button>
        ),
      },
      {
        key: 'entry_date',
        header: 'Date & Time',
        columnPickerLabel: 'Date & time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => formatFinancialRecordDateTime(r),
      },
      {
        key: 'debit_account_name',
        header: 'Received in',
        columnPickerLabel: 'Received in (bank/cash)',
        render: (r) =>
          r.debit_account_name ||
          accountNameById.get(r.debit_account_id) ||
          r.debit_account_id ||
          '—',
      },
      {
        key: 'credit_account_name',
        header: 'Received from',
        columnPickerLabel: 'Received from (party/vendor)',
        render: (r) =>
          r.credit_account_name ||
          accountNameById.get(r.credit_account_id) ||
          r.credit_account_id ||
          '—',
      },
      {
        key: 'amount',
        header: 'Amount',
        columnPickerLabel: 'Amount',
        align: 'right',
        render: (r) => formatCurrency(r.amount),
      },
      {
        key: 'created_at',
        header: 'Created On',
        columnPickerLabel: 'Created On',
        render: (r) => (r.created_at ? formatDateTime(r.created_at) : '—'),
      },
      {
        key: 'actions',
        header: 'Action',
        locked: true,
        align: 'right',
        width: 88,
        render: (r) => (
          <div
            className="flex justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <button
              type="button"
              onClick={() => openEdit(r)}
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
              aria-label="Edit receipt voucher"
              title="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => adminDelete.requestDelete(r)}
              className="p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
              aria-label="Delete receipt voucher"
              title="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
      },
    ],
    [accountNameById, openEdit]
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns(
    'receipt-vouchers',
    allColumns,
    { defaultHidden: ['created_at'] }
  );

  const pdfColumns = useMemo(
    () =>
      exportColumns
        .filter((c) => c.key !== 'actions')
        .map((c) => ({
          key: c.key,
          header: c.columnPickerLabel || String(c.header || c.key),
          get: (r) => {
            if (c.key === 'entry_date') return formatFinancialRecordDateTime(r);
            if (c.key === 'debit_account_name') {
              return r.debit_account_name || accountNameById.get(r.debit_account_id) || '';
            }
            if (c.key === 'credit_account_name') {
              return r.credit_account_name || accountNameById.get(r.credit_account_id) || '';
            }
            if (c.key === 'amount') return formatCurrency(r.amount);
            if (c.key === 'created_at') return r.created_at ? formatDateTime(r.created_at) : '';
            return r[c.key] ?? '';
          },
        })),
    [exportColumns, accountNameById]
  );

  const listPdfOpts = () => {
    const subtitleParts = [];
    if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
    if (filterEntryDate) subtitleParts.push(`Date: ${formatDate(filterEntryDate)}`);
    return {
      listFn: receiptVouchersApi.list,
      listParams: listFilterParams,
      title: 'Receipt Vouchers',
      subtitle: subtitleParts.length ? subtitleParts.join(' · ') : 'All receipt vouchers',
      columns: pdfColumns,
    };
  };

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      await exportFilteredListPdf({
        ...listPdfOpts(),
        filename: 'receipt_vouchers.pdf',
      });
    });
  };

  const printPdf = () => {
    withListPdfBusy(setExportBusy, async () => {
      await exportFilteredListPrint(listPdfOpts());
    });
  };

  const meta = listQuery.data?.meta;

  return (
    <>
      <PageHeader
        title="Receipt Voucher"
        description="Record receipts against bank, cash, party, and vendor accounts"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListPdfToolbarButtons
              busy={exportBusy}
              disabled={listQuery.isLoading}
              onPrint={printPdf}
              onExport={exportPdf}
            />
            <Button icon={Plus} onClick={openCreateWithFilterDate}>
              Receipt Voucher
            </Button>
          </div>
        }
      />

      <div className="card p-3 mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 max-w-md">
            <label className="label" htmlFor="rv-search">
              Search
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                aria-hidden
              />
              <input
                id="rv-search"
                type="search"
                className="input w-full pl-9"
                placeholder="Search…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
          </div>
          <Input
            id="rv-filter-date"
            label="Date"
            type="date"
            className="w-full sm:w-auto min-w-[10.5rem]"
            value={filterEntryDate}
            onChange={(e) => {
              setFilterEntryDate(e.target.value);
              setPage(1);
            }}
          />
          <TableColumnPicker {...pickerProps} />
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={listQuery.data?.data}
        loading={listQuery.isLoading}
        emptyTitle="No Record Found"
        emptyMessage="Use Receipt Voucher to add your first entry."
        visibleCount={listQuery.data?.data?.length ?? 0}
        totalCount={meta?.total ?? 0}
        page={meta?.page ?? page}
        totalPages={meta?.total_pages ?? 1}
        countLabel="entries"
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

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editingId ? 'Edit Receipt Voucher' : 'Create Receipt Voucher'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetForm}>
              Reset
            </Button>
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={submitForm} loading={saveMut.isPending}>
              {editingId ? 'Update' : 'Submit'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-xs text-gray-600 leading-snug border border-gray-200 rounded-md bg-surface px-3 py-2">
            Records money <strong>received into</strong> your bank or cash account from a party or
            vendor. It appears in <strong>Incomes &amp; Expenses → Income</strong>. To pay a vendor
            (money going out), use <strong>Payment Voucher</strong> instead — that shows under
            Expense.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="rv-modal-date"
              label="Date"
              type="date"
              required
              value={form.entry_date}
              error={err('entry_date')}
              onChange={(e) => {
                setForm((f) => ({ ...f, entry_date: e.target.value }));
                clearFieldError(setFieldErrors, 'entry_date');
              }}
            />
            <div>
              <label className="label" htmlFor="rv-modal-amount">
                Amount <span className="text-red-600">*</span>
              </label>
              <input
                id="rv-modal-amount"
                type="number"
                min="0"
                step="0.01"
                className={fieldShellClass(err('amount'), 'input w-full')}
                value={form.amount}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    amount:
                      e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value)),
                  }));
                  clearFieldError(setFieldErrors, 'amount');
                }}
                placeholder="0.00"
              />
              {err('amount') ? <p className="text-xs text-red-600 mt-1">{err('amount')}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="rv-modal-debit">
                Received in (bank/cash) <span className="text-red-600">*</span>
              </label>
              <AccountSelectWithQr
                accountId={form.debit_account_id}
                accounts={bankCashAccounts}
                accountKind="payment"
                size="md"
              >
                <select
                  id="rv-modal-debit"
                  className={fieldShellClass(
                    err('debit_account_id'),
                    'input w-full bg-surface pr-8'
                  )}
                  value={form.debit_account_id}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, debit_account_id: e.target.value }));
                    clearFieldError(setFieldErrors, 'debit_account_id');
                  }}
                >
                  <option value="">Select Account</option>
                  {bankCashAccounts.some((a) => normGroup(a.account_group) === 'bank accounts') ? (
                    <optgroup label="Bank Accounts">
                      {bankCashAccounts
                        .filter((a) => normGroup(a.account_group) === 'bank accounts')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                  {bankCashAccounts.some((a) => normGroup(a.account_group) === 'cash accounts') ? (
                    <optgroup label="Cash Accounts">
                      {bankCashAccounts
                        .filter((a) => normGroup(a.account_group) === 'cash accounts')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </optgroup>
                  ) : null}
                </select>
              </AccountSelectWithQr>
              {err('debit_account_id') ? (
                <p className="text-xs text-red-600 mt-1">{err('debit_account_id')}</p>
              ) : null}
            </div>
            <div>
              <label className="label" htmlFor="rv-modal-credit">
                Received from (party/vendor) <span className="text-red-600">*</span>
              </label>
              <select
                id="rv-modal-credit"
                className={fieldShellClass(
                  err('credit_account_id'),
                  'input w-full bg-surface pr-8'
                )}
                value={form.credit_account_id}
                onChange={(e) => {
                  setForm((f) => ({ ...f, credit_account_id: e.target.value }));
                  clearFieldError(setFieldErrors, 'credit_account_id');
                }}
              >
                <option value="">Select Account</option>
                {partyVendorAccounts.some((a) => normGroup(a.account_group) === 'parties') ? (
                  <optgroup label="Parties">
                    {partyVendorAccounts
                      .filter((a) => normGroup(a.account_group) === 'parties')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {partyVendorAccounts.some((a) => normGroup(a.account_group) === 'vendors') ? (
                  <optgroup label="Vendors">
                    {partyVendorAccounts
                      .filter((a) => normGroup(a.account_group) === 'vendors')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </select>
              {err('credit_account_id') ? (
                <p className="text-xs text-red-600 mt-1">{err('credit_account_id')}</p>
              ) : null}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="rv-modal-remarks">
              Remarks
            </label>
            <textarea
              id="rv-modal-remarks"
              className="input w-full min-h-[100px]"
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="type your Remarks here"
            />
          </div>
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={!!adminDelete.target}
        onClose={adminDelete.close}
        onConfirm={adminDelete.confirmDelete}
        title="Delete receipt voucher?"
        description="This cannot be undone."
        itemLabel={
          adminDelete.target
            ? `Voucher ${adminDelete.target.voucher_number || adminDelete.target.id}`
            : undefined
        }
        shopName={shopName}
        errorMessage={adminDelete.error}
        onClearError={adminDelete.clearError}
        loading={adminDelete.loading}
      />
    </>
  );
};

ReceiptVouchers.propTypes = {};

export default ReceiptVouchers;
