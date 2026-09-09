import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createJournalVoucherBodySchema, formatCurrency, formatDate, todayIndiaISODate, toLocalISODate } from '@wrs/shared';
import { Download, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { journalVouchersApi } from '../../lib/api/journalVouchers.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
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
import { toast } from '../../stores/uiStore.js';

const todayStr = () => todayIndiaISODate();

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
    remarks: row.remarks || '',
  };
}

function toNonNegativeNumber(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

function groupAccountsByLabel(accounts) {
  const m = new Map();
  for (const a of accounts) {
    if (a.is_active === false) continue;
    const label = String(a.account_group || 'Other').trim() || 'Other';
    if (!m.has(label)) m.set(label, []);
    m.get(label).push(a);
  }
  return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0]));
}

const JournalVouchers = () => {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [exportBusy, setExportBusy] = useState(false);
  const queryClient = useQueryClient();
  const shopName = useSelectedShopName();

  const adminDelete = useAdminDelete({
    deleteFn: (row, admin_password) => journalVouchersApi.remove(row.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Journal voucher removed');
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
    }),
    [search]
  );

  const listQuery = useQuery({
    queryKey: ['journal-vouchers', { page, perPage, listFilterParams }],
    queryFn: () =>
      journalVouchersApi.list({
        ...listFilterParams,
        page,
        per_page: perPage,
      }),
    keepPreviousData: true,
  });

  const accounts = accountsQuery.data?.data || [];
  const accountGroups = useMemo(() => groupAccountsByLabel(accounts), [accounts]);

  const accountNameById = useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const saveMut = useMutation({
    mutationFn: ({ id, body }) =>
      id ? journalVouchersApi.update(id, body) : journalVouchersApi.create(body),
    onSuccess: async (_, variables) => {
      toast.success(variables.id ? 'Journal voucher updated' : 'Journal voucher saved');
      await invalidateAccountingDomain(queryClient);
      setModalOpen(false);
      setEditingId(null);
      setEditSnapshot(null);
      setForm(emptyForm());
    },
    onError: (e) => {
      const msg =
        e?.response?.data?.error?.message || e?.message || 'Failed to save';
      toast.error(msg);
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setEditSnapshot(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = useCallback((row) => {
    const f = rowToForm(row);
    setEditingId(row.id);
    setEditSnapshot(f);
    setForm(f);
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setEditSnapshot(null);
    setForm(emptyForm());
  };

  const resetForm = () => {
    if (editingId && editSnapshot) {
      setForm({ ...editSnapshot });
      return;
    }
    setForm(emptyForm());
  };

  const submitForm = () => {
    if (saveMut.isPending) return;
    const payload = {
      debit_account_id: String(form.debit_account_id || '').trim(),
      credit_account_id: String(form.credit_account_id || '').trim(),
      entry_date: form.entry_date,
      amount: Number(form.amount),
      remarks: String(form.remarks || '').trim(),
    };
    const parsed = createJournalVoucherBodySchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      toast.error(first?.message || 'Check the form');
      return;
    }
    saveMut.mutate({ id: editingId, body: parsed.data });
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'entry_date',
        header: 'Date & Time',
        columnPickerLabel: 'Date & time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => formatFinancialRecordDateTime(r),
      },
      {
        key: 'debit_account_name',
        header: 'Dr. Account',
        columnPickerLabel: 'Dr. Account',
        render: (r) =>
          r.debit_account_name || accountNameById.get(r.debit_account_id) || r.debit_account_id || '—',
      },
      {
        key: 'credit_account_name',
        header: 'Cr. Account',
        columnPickerLabel: 'Cr. Account',
        render: (r) =>
          r.credit_account_name || accountNameById.get(r.credit_account_id) || r.credit_account_id || '—',
      },
      {
        key: 'amount',
        header: 'Amount',
        columnPickerLabel: 'Amount',
        align: 'right',
        render: (r) => formatCurrency(r.amount),
      },
      {
        key: 'remarks',
        header: 'Remarks',
        columnPickerLabel: 'Remarks',
        render: (r) => {
          const t = String(r.remarks || '');
          return t.length > 80 ? `${t.slice(0, 80)}…` : t || '—';
        },
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
              aria-label="Edit journal voucher"
              title="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => adminDelete.requestDelete(r)}
              className="p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
              aria-label="Delete journal voucher"
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
    'journal-vouchers',
    allColumns
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
            if (c.key === 'remarks') return r.remarks ?? '';
            return r[c.key] ?? '';
          },
        })),
    [exportColumns, accountNameById]
  );

  const listPdfOpts = {
    listFn: journalVouchersApi.list,
    listParams: listFilterParams,
    title: 'Journal Vouchers',
    subtitle: search.trim() ? `Search: ${search.trim()}` : 'All journal vouchers',
    columns: pdfColumns,
  };

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      await exportFilteredListPdf({
        ...listPdfOpts,
        filename: 'journal_vouchers.pdf',
      });
    });
  };

  const printPdf = () => {
    withListPdfBusy(setExportBusy, async () => {
      await exportFilteredListPrint(listPdfOpts);
    });
  };

  const meta = listQuery.data?.meta;

  return (
    <>
      <PageHeader
        title="Journal Vouchers"
        description="Record journal entries between ledger accounts"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListPdfToolbarButtons
              busy={exportBusy}
              disabled={listQuery.isLoading}
              onPrint={printPdf}
              onExport={exportPdf}
            />
            <Button icon={Plus} onClick={openCreate}>
              Create Voucher
            </Button>
          </div>
        }
      />

      <div className="card p-3 mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 max-w-md">
            <label className="label" htmlFor="jv-search">
              Search
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                aria-hidden
              />
              <input
                id="jv-search"
                type="search"
                className="input w-full pl-9"
                placeholder="Search…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
          </div>
          <TableColumnPicker {...pickerProps} />
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={listQuery.data?.data}
        loading={listQuery.isLoading}
        emptyTitle="No Record Found"
        emptyMessage="Create a voucher to add your first journal entry."
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
        title={editingId ? 'Edit Journal Voucher' : 'Create Journal Voucher'}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="jv-modal-date"
              label="Date"
              type="date"
              required
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
            />
            <div>
              <label className="label" htmlFor="jv-modal-amount">
                Amount <span className="text-red-600">*</span>
              </label>
              <input
                id="jv-modal-amount"
                type="number"
                min="0"
                step="0.01"
                className="input w-full"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    amount: e.target.value === '' ? '' : String(toNonNegativeNumber(e.target.value)),
                  }))
                }
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="jv-modal-dr">
                Dr. Account
              </label>
              <AccountSelectWithQr
                accountId={form.debit_account_id}
                accounts={accounts}
                accountKind="payment"
                size="md"
              >
                <select
                  id="jv-modal-dr"
                  className="input w-full bg-surface pr-8"
                  value={form.debit_account_id}
                  onChange={(e) => setForm((f) => ({ ...f, debit_account_id: e.target.value }))}
                >
                  <option value="">Select Account</option>
                  {accountGroups.map(([groupLabel, rows]) => (
                    <optgroup key={groupLabel} label={groupLabel}>
                      {rows.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </AccountSelectWithQr>
            </div>
            <div>
              <label className="label" htmlFor="jv-modal-cr">
                Cr. Account
              </label>
              <AccountSelectWithQr
                accountId={form.credit_account_id}
                accounts={accounts}
                accountKind="payment"
                size="md"
              >
                <select
                  id="jv-modal-cr"
                  className="input w-full bg-surface pr-8"
                  value={form.credit_account_id}
                  onChange={(e) => setForm((f) => ({ ...f, credit_account_id: e.target.value }))}
                >
                  <option value="">Select Account</option>
                  {accountGroups.map(([groupLabel, rows]) => (
                    <optgroup key={`cr-${groupLabel}`} label={groupLabel}>
                      {rows.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </AccountSelectWithQr>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="jv-modal-remarks">
              Remark <span className="text-red-600">*</span>
            </label>
            <textarea
              id="jv-modal-remarks"
              className="input w-full min-h-[100px]"
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="Remark"
            />
          </div>
        </div>
      </Modal>

      <AdminDeleteModal
        isOpen={!!adminDelete.target}
        onClose={adminDelete.close}
        onConfirm={adminDelete.confirmDelete}
        title="Delete journal voucher?"
        description="This cannot be undone."
        itemLabel={
          adminDelete.target?.entry_date ? formatFinancialRecordDateTime(adminDelete.target) : undefined
        }
        shopName={shopName}
        errorMessage={adminDelete.error}
        onClearError={adminDelete.clearError}
        loading={adminDelete.loading}
      />
    </>
  );
};

JournalVouchers.propTypes = {};

export default JournalVouchers;
