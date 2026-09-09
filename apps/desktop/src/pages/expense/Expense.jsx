import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createExpenseEntryBodySchema, formatCurrency, formatDate, isIndianPhone, normalizeSqlDateToIso, todayIndiaISODate } from '@wrs/shared';
import { Download, Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import PaymentAccountFormModal, {
  createPaymentAccountLocalId,
  emptyPaymentAccountDraft,
} from '../../components/accounts/PaymentAccountFormModal.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import MultiImageUploader from '../../components/ui/MultiImageUploader.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { expenseEntriesApi } from '../../lib/api/expenseEntries.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';
import {
  clearFieldError,
  fieldShellClass,
  rejectSubmit,
  zodIssuesToFieldMap,
} from '../../lib/formValidation.js';
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

function normGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

const emptyForm = () => ({
  expense_account_id: '',
  payment_account_id: '',
  name: '',
  entry_date: todayStr(),
  amount: '',
  details: '',
  contact_no: '',
  image_urls: [],
});

function entryDateForInput(value) {
  if (value == null || value === '') return todayStr();
  const iso = normalizeSqlDateToIso(value);
  if (iso) return iso;
  return todayStr();
}

function rowToForm(row) {
  return {
    expense_account_id: row.expense_account_id || '',
    payment_account_id: row.payment_account_id || '',
    name: row.name || '',
    entry_date: entryDateForInput(row.entry_date),
    amount: row.amount != null && row.amount !== '' ? String(row.amount) : '',
    details: row.details || '',
    contact_no: row.contact_no || '',
    image_urls: Array.isArray(row.image_urls) ? row.image_urls : [],
  };
}

const Expense = () => {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editingExpenseNumber, setEditingExpenseNumber] = useState(null);
  const [createAccOpen, setCreateAccOpen] = useState(false);
  const [createAccDraft, setCreateAccDraft] = useState(() => emptyPaymentAccountDraft({ account_group: 'Expenses' }));
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const err = (key) => fieldErrors[key];
  const [exportBusy, setExportBusy] = useState(false);
  const queryClient = useQueryClient();
  const shopName = useSelectedShopName();

  const adminDelete = useAdminDelete({
    deleteFn: (row, admin_password) => expenseEntriesApi.remove(row.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Expense entry removed');
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
    () => ({ sort: '-entry_date', search: search || undefined }),
    [search]
  );

  const listQuery = useQuery({
    queryKey: ['expense-entries', { page, perPage, listFilterParams }],
    queryFn: () => expenseEntriesApi.list({ ...listFilterParams, page, per_page: perPage }),
    keepPreviousData: true,
  });

  const accounts = accountsQuery.data?.data || [];

  const expenseAccounts = useMemo(
    () => accounts.filter((a) => normGroup(a.account_group) === 'expenses'),
    [accounts]
  );
  const bankAccounts = useMemo(
    () => accounts.filter((a) => normGroup(a.account_group) === 'bank accounts'),
    [accounts]
  );
  const cashAccounts = useMemo(
    () => accounts.filter((a) => normGroup(a.account_group) === 'cash accounts'),
    [accounts]
  );

  const accountNameById = useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const saveExpenseMut = useMutation({
    mutationFn: ({ id, body }) =>
      id ? expenseEntriesApi.update(id, body) : expenseEntriesApi.create(body),
    onSuccess: async (_, variables) => {
      toast.success(variables.id ? 'Expense updated' : 'Expense saved');
      await invalidateAccountingDomain(queryClient);
      setAddOpen(false);
      setEditingEntryId(null);
      setForm(emptyForm());
      setFieldErrors({});
    },
    onError: (e) => {
      const msg =
        e?.response?.data?.error?.message || e?.message || 'Failed to save';
      toast.error(msg);
    },
  });

  const createAccountMut = useMutation({
    mutationFn: async () => {
      const name = String(createAccDraft.name || '').trim();
      const contactNo = String(createAccDraft.contact_no || '').trim();
      const accountGroup = 'Expenses';
      if (!name) throw new Error('Name is required');
      if (!contactNo) throw new Error('Contact No is required');
      if (!isIndianPhone(contactNo)) throw new Error('Enter a valid 10-digit mobile number');
      const payload = {
        name,
        contact_no: contactNo,
        account_group: accountGroup,
        opening_balance: Number(createAccDraft.opening_balance || 0),
        date: createAccDraft.date || '',
        email: String(createAccDraft.email || '').trim(),
        address: String(createAccDraft.address || '').trim(),
        remarks: String(createAccDraft.remarks || '').trim(),
      };
      return paymentAccountsApi.create({ id: createPaymentAccountLocalId(), ...payload });
    },
    onSuccess: async (res) => {
      const row = res?.data;
      toast.success('Account created');
      await invalidateAccountingDomain(queryClient);
      if (row?.id) setForm((f) => ({ ...f, expense_account_id: row.id }));
      setCreateAccDraft(emptyPaymentAccountDraft({ account_group: 'Expenses' }));
      setCreateAccOpen(false);
    },
    onError: (e) => toast.error(e?.message || 'Failed to create account'),
  });

  const openAdd = () => {
    setEditingEntryId(null);
    setEditingExpenseNumber(null);
    setForm(emptyForm());
    setFieldErrors({});
    setAddOpen(true);
  };

  const openEdit = useCallback((row) => {
    setEditingEntryId(row.id);
    setEditingExpenseNumber(row.expense_number || null);
    setForm(rowToForm(row));
    setFieldErrors({});
    setAddOpen(true);
  }, []);

  const closeExpenseModal = () => {
    setAddOpen(false);
    setEditingEntryId(null);
    setEditingExpenseNumber(null);
    setForm(emptyForm());
    setFieldErrors({});
  };

  const submitExpense = () => {
    if (saveExpenseMut.isPending) return;
    const contactDigits = String(form.contact_no || '').replace(/\D/g, '');
    const payload = {
      expense_account_id: form.expense_account_id,
      payment_account_id: form.payment_account_id,
      name: String(form.name || '').trim(),
      entry_date: form.entry_date,
      amount: Number(form.amount),
      details: String(form.details || '').trim(),
      contact_no: contactDigits || null,
      image_urls: form.image_urls || [],
    };
    const parsed = createExpenseEntryBodySchema.safeParse(payload);
    if (!parsed.success) {
      const errors = zodIssuesToFieldMap(parsed.error.errors);
      rejectSubmit({ errors, setErrors: setFieldErrors, toast });
      return;
    }
    setFieldErrors({});
    saveExpenseMut.mutate({ id: editingEntryId, body: parsed.data });
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'expense_number',
        header: 'Bill No',
        columnPickerLabel: 'Bill No',
        render: (r) => (
          <span className="font-mono text-xs text-brand">{r.expense_number || '—'}</span>
        ),
      },
      {
        key: 'entry_date',
        header: 'Date & Time',
        columnPickerLabel: 'Date & time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => formatFinancialRecordDateTime(r),
      },
      { key: 'name', header: 'Name', columnPickerLabel: 'Name' },
      {
        key: 'contact_no',
        header: 'Mobile',
        columnPickerLabel: 'Mobile',
        render: (r) => r.contact_no || '—',
      },
      {
        key: 'amount',
        header: 'Amount',
        columnPickerLabel: 'Amount',
        align: 'right',
        render: (r) => formatCurrency(r.amount),
      },
      {
        key: 'expense_account_name',
        header: 'Expense account',
        columnPickerLabel: 'Expense account',
        render: (r) => r.expense_account_name || accountNameById.get(r.expense_account_id) || r.expense_account_id,
      },
      {
        key: 'payment_account_name',
        header: 'Payment account',
        columnPickerLabel: 'Payment account',
        render: (r) => r.payment_account_name || accountNameById.get(r.payment_account_id) || r.payment_account_id,
      },
      {
        key: 'details',
        header: 'Details',
        columnPickerLabel: 'Details',
        render: (r) => {
          const t = String(r.details || '');
          return t.length > 60 ? `${t.slice(0, 60)}…` : t || '—';
        },
      },
      {
        key: 'actions',
        header: '',
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
              aria-label="Edit expense"
              title="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              type="button"
              onClick={() => adminDelete.requestDelete(r)}
              className="p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
              aria-label="Delete expense"
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

  const { visibleColumns, pickerProps } = useDataTableColumns('expense-entries', allColumns, {
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
            if (c.key === 'entry_date') return formatFinancialRecordDateTime(r);
            if (c.key === 'amount') return formatCurrency(r.amount);
            if (c.key === 'expense_account_name') {
              return r.expense_account_name || accountNameById.get(r.expense_account_id) || '';
            }
            if (c.key === 'payment_account_name') {
              return r.payment_account_name || accountNameById.get(r.payment_account_id) || '';
            }
            if (c.key === 'details') return r.details ?? '';
            return r[c.key] ?? '';
          },
        })),
    [visibleColumns, accountNameById]
  );

  const listPdfOpts = {
    listFn: expenseEntriesApi.list,
    listParams: listFilterParams,
    title: 'Expense',
    subtitle: 'All expense entries',
    columns: exportColumns,
  };

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      await exportFilteredListPdf({
        ...listPdfOpts,
        filename: 'expense_entries.pdf',
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
        title="Expense"
        description="Record miscellaneous expenses against your ledger accounts"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListPdfToolbarButtons
              busy={exportBusy}
              disabled={listQuery.isLoading}
              onPrint={printPdf}
              onExport={exportPdf}
            />
            <Button icon={Plus} onClick={openAdd}>
              Add Expense
            </Button>
          </div>
        }
      />

      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5 justify-between">
        <div className="relative min-w-[12rem] flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            className="input w-full pl-8 h-8 text-sm"
            placeholder="Search bill no, name, details…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            aria-label="Search expense entries"
          />
        </div>
        <TableColumnPicker {...pickerProps} />
      </div>

      <DataTable
        columns={visibleColumns}
        rows={listQuery.data?.data}
        loading={listQuery.isLoading}
        emptyTitle="No expense entries"
        emptyMessage="Use Add Expense to record a transaction."
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
        isOpen={addOpen}
        onClose={closeExpenseModal}
        title={editingEntryId ? 'Edit Expense' : 'Add Expense'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeExpenseModal}>
              Cancel
            </Button>
            <Button onClick={submitExpense} loading={saveExpenseMut.isPending}>
              {editingEntryId ? 'Update' : 'Submit'}
            </Button>
          </div>
        }
      >
        {editingExpenseNumber ? (
          <div className="mb-3">
            <span className="inline-block font-mono text-xs px-2 py-0.5 rounded border border-brand/25 bg-brand-light text-brand">
              {editingExpenseNumber}
            </span>
          </div>
        ) : null}
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <label className="label" htmlFor="expense-modal-expense-account">
                Expense Acc.
              </label>
              <select
                id="expense-modal-expense-account"
                className={fieldShellClass(err('expense_account_id'), 'input w-full')}
                value={form.expense_account_id}
                onChange={(e) => {
                  setForm((f) => ({ ...f, expense_account_id: e.target.value }));
                  clearFieldError(setFieldErrors, 'expense_account_id');
                }}
              >
                <option value="">Select expense account</option>
                {expenseAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {err('expense_account_id') ? (
                <p className="text-xs text-red-600 mt-1">{err('expense_account_id')}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setCreateAccDraft(emptyPaymentAccountDraft({ account_group: 'Expenses' }));
                setCreateAccOpen(true);
              }}
            >
              Create Acc.
            </Button>
          </div>

          <div>
            <label className="label" htmlFor="expense-modal-payment-account">
              Payment
            </label>
            <AccountSelectWithQr
              accountId={form.payment_account_id}
              accounts={accounts}
              accountKind="payment"
              size="md"
            >
              <select
                id="expense-modal-payment-account"
                className={fieldShellClass(err('payment_account_id'), 'input w-full')}
                value={form.payment_account_id}
                onChange={(e) => {
                  setForm((f) => ({ ...f, payment_account_id: e.target.value }));
                  clearFieldError(setFieldErrors, 'payment_account_id');
                }}
              >
                <option value="">Select Account</option>
                {bankAccounts.length ? (
                  <optgroup label="Bank Accounts">
                    {bankAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {cashAccounts.length ? (
                  <optgroup label="Cash Accounts">
                    {cashAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </AccountSelectWithQr>
            {err('payment_account_id') ? (
              <p className="text-xs text-red-600 mt-1">{err('payment_account_id')}</p>
            ) : null}
          </div>

          <Input
            label="Name"
            required
            value={form.name}
            error={err('name')}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              clearFieldError(setFieldErrors, 'name');
            }}
            placeholder="Name"
          />

          <Input
            label="Mobile"
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={form.contact_no}
            error={err('contact_no')}
            onChange={(e) => {
              setForm((f) => ({ ...f, contact_no: e.target.value.replace(/\D/g, '').slice(0, 10) }));
              clearFieldError(setFieldErrors, 'contact_no');
            }}
            placeholder="10-digit mobile (optional)"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              id="expense-modal-entry-date"
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
            <Input
              label="Amount"
              required
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              error={err('amount')}
              onChange={(e) => {
                setForm((f) => ({ ...f, amount: e.target.value }));
                clearFieldError(setFieldErrors, 'amount');
              }}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="label" htmlFor="expense-modal-details">
              Details <span className="text-red-600">*</span>
            </label>
            <textarea
              id="expense-modal-details"
              className={fieldShellClass(err('details'), 'input w-full min-h-[100px]')}
              value={form.details}
              onChange={(e) => {
                setForm((f) => ({ ...f, details: e.target.value }));
                clearFieldError(setFieldErrors, 'details');
              }}
              placeholder="type your Details here"
            />
            {err('details') ? <p className="text-xs text-red-600 mt-1">{err('details')}</p> : null}
          </div>

          <MultiImageUploader
            label="Bill photos"
            hint="Attach photos of the expense bill. You can select multiple images at once."
            folder="expenses"
            value={form.image_urls}
            onChange={(urls) => setForm((f) => ({ ...f, image_urls: urls }))}
          />
        </div>
      </Modal>

      <PaymentAccountFormModal
        isOpen={createAccOpen}
        onClose={() => {
          setCreateAccOpen(false);
          setCreateAccDraft(emptyPaymentAccountDraft({ account_group: 'Expenses' }));
        }}
        draft={createAccDraft}
        setDraft={setCreateAccDraft}
        editingId={null}
        fixedAccountGroup="Expenses"
        onSave={() => createAccountMut.mutate()}
        saveLoading={createAccountMut.isPending}
      />

      <AdminDeleteModal
        isOpen={!!adminDelete.target}
        onClose={adminDelete.close}
        onConfirm={adminDelete.confirmDelete}
        title="Delete expense entry?"
        description="This cannot be undone."
        itemLabel={
          adminDelete.target
            ? `${String(adminDelete.target.name || '').trim() || 'this entry'} (${formatFinancialRecordDateTime(adminDelete.target)})`
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

export default Expense;
