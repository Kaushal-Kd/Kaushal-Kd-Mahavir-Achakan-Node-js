import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPaymentVoucherBodySchema,
  formatCurrency,
  formatDate,
  formatDateTime,
  todayIndiaISODate,
} from '@wrs/shared';
import { Download, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import AccountSelectWithQr from '../../components/accounts/AccountSelectWithQr.jsx';
import TransactionBillLink from '../../components/booking/TransactionBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { laundryApi } from '../../lib/api/laundry.js';
import { paymentAccountsApi } from '../../lib/api/paymentAccounts.js';
import { purchasesApi } from '../../lib/api/purchases.js';
import { paymentVouchersApi } from '../../lib/api/paymentVouchers.js';
import { formatFinancialRecordDateTime } from '../../lib/listTimestampColumns.js';
import { downloadPaymentVoucher, printPaymentVoucher } from '../../lib/paymentVoucherSlip.js';
import { restorePaymentVoucherBillAllocation } from '../../lib/paymentVoucherEditBalance.js';
import ListPdfToolbarButtons from '../../components/reports/ListPdfToolbarButtons.jsx';
import {
  exportFilteredListPdf,
  exportFilteredListPrint,
  withExportPdfBusy,
  withListPdfBusy,
} from '../../lib/reportPdfExport.js';
import {
  invalidateAccountingDomain,
  invalidateLaundryDomain,
} from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import {
  clearFieldError,
  fieldShellClass,
  rejectSubmit,
  zodIssuesToFieldMap,
} from '../../lib/formValidation.js';
import { toast } from '../../stores/uiStore.js';
import PaymentVoucherBillPickerModal from './PaymentVoucherBillPickerModal.jsx';

const todayStr = () => todayIndiaISODate();

function normGroup(g) {
  return String(g || '')
    .trim()
    .toLowerCase();
}

function normText(v) {
  return String(v || '')
    .trim()
    .toLowerCase();
}

const emptyForm = () => ({
  credit_account_id: '',
  debit_account_id: '',
  entry_date: todayStr(),
  amount: '',
  remarks: '',
  bill_kind: 'purchase',
  bill_ids: [],
});

function purchasePending(purchase) {
  return Math.max(0, Number(purchase?.total_amount || 0) - Number(purchase?.advance || 0));
}

function billBalance(bill, billKind) {
  if (billKind === 'washing') return Number(bill?.washing_balance ?? 0);
  return purchasePending(bill);
}

function sumBillBalances(bills, billKind) {
  return bills.reduce((sum, bill) => sum + billBalance(bill, billKind), 0);
}

function billRowLabel(bill, billKind) {
  if (billKind === 'washing') {
    return `${bill.job_no}${bill.vendor_name ? ` · ${bill.vendor_name}` : ''} · ${formatDate(bill.laundry_date)}`;
  }
  return `${bill.purchase_number}${bill.vendor_account_name ? ` · ${bill.vendor_account_name}` : ''} · ${formatDate(bill.purchase_date)}`;
}

function billKindLabel(kind) {
  if (kind === 'purchase') return 'Purchase';
  if (kind === 'washing') return 'Washing';
  return '—';
}

function billKindDisplay(row) {
  if (row.bill_kind === 'purchase' && row.purchase_bill_number) {
    return `Purchase · ${row.purchase_bill_number}`;
  }
  if (row.bill_kind === 'washing' && row.washing_bill_number) {
    return `Washing · ${row.washing_bill_number}`;
  }
  return billKindLabel(row.bill_kind);
}

function toNonNegativeNumber(v) {
  const n = Number(v);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

const EMPTY_ACCOUNTS = [];
const EMPTY_JOBS = [];
const EMPTY_PURCHASES = [];

/** Payment vouchers linked to purchase or washing bills. */
const PaymentVoucherList = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filterEntryDate, setFilterEntryDate] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingVoucher, setEditingVoucher] = useState(null);
  const [editingBillLabel, setEditingBillLabel] = useState('');
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const err = (key) => fieldErrors[key];
  const [exportBusy, setExportBusy] = useState(false);
  const [slipBusyId, setSlipBusyId] = useState(null);
  const queryClient = useQueryClient();
  const shopName = useSelectedShopName();

  const adminDelete = useAdminDelete({
    deleteFn: (row, admin_password) => paymentVouchersApi.remove(row.id, { admin_password }),
    onSuccess: async (_data, row) => {
      toast.success('Payment voucher removed');
      await invalidateAccountingDomain(queryClient);
      await invalidateLaundryDomain(queryClient);
      if (row?.bill_kind === 'purchase') {
        await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      }
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

  const unpaidJobsQuery = useQuery({
    queryKey: ['laundry-jobs', 'unpaid-washing'],
    queryFn: () =>
      laundryApi.list({
        unpaid_washing: 1,
        per_page: 200,
        sort: '-laundry_date',
      }),
    enabled: modalOpen,
  });

  const unpaidPurchasesQuery = useQuery({
    queryKey: ['purchases', 'pending-payment-voucher'],
    queryFn: () =>
      purchasesApi.list({
        pending_only: true,
        per_page: 200,
        sort: '-purchase_date',
      }),
    enabled: modalOpen,
  });

  const editingBillQuery = useQuery({
    queryKey: [
      'payment-voucher-edit-bill',
      editingVoucher?.bill_kind,
      editingVoucher?.bill_id,
      editingVoucher?.amount,
    ],
    queryFn: async () => {
      if (editingVoucher.bill_kind === 'washing') {
        const response = await laundryApi.get(editingVoucher.bill_id);
        const job = response.data;
        return restorePaymentVoucherBillAllocation(
          {
            id: job.id,
            job_no: job.jobNo,
            vendor_name: job.vendorName,
            vendor_account_id: job.vendorAccountId,
            laundry_date: job.laundryDate,
            washing_balance: Number(job.washingBalance || 0),
          },
          'washing',
          editingVoucher.amount
        );
      }
      const response = await purchasesApi.get(editingVoucher.bill_id);
      const purchase = response.data;
      return restorePaymentVoucherBillAllocation(purchase, 'purchase', editingVoucher.amount);
    },
    enabled: Boolean(modalOpen && editingVoucher?.bill_id),
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
    queryKey: ['payment-vouchers', { page, perPage, listFilterParams }],
    queryFn: () =>
      paymentVouchersApi.list({
        ...listFilterParams,
        page,
        per_page: perPage,
      }),
    placeholderData: (prev) => prev,
  });

  const accountsRaw = accountsQuery.data?.data;
  const accounts = Array.isArray(accountsRaw) ? accountsRaw : EMPTY_ACCOUNTS;
  const jobsRaw = unpaidJobsQuery.data?.data;
  const unpaidJobs = Array.isArray(jobsRaw) ? jobsRaw : EMPTY_JOBS;
  const purchasesRaw = unpaidPurchasesQuery.data?.data;
  const unpaidPurchases = Array.isArray(purchasesRaw) ? purchasesRaw : EMPTY_PURCHASES;

  const bankCashAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (a.is_active === false) return false;
        const g = normGroup(a.account_group);
        return g === 'bank accounts' || g === 'cash accounts';
      }),
    [accounts]
  );

  const vendorDebitAccounts = useMemo(
    () =>
      accounts.filter((a) => {
        if (a.is_active === false) return false;
        const g = normGroup(a.account_group);
        return g === 'parties' || g === 'vendors' || g === 'laundry vendor';
      }),
    [accounts]
  );

  const accountNameById = useMemo(() => {
    const m = new Map();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const selectedDebitAccountName = useMemo(() => {
    if (!form.debit_account_id) return '';
    return accountNameById.get(form.debit_account_id) || '';
  }, [accountNameById, form.debit_account_id]);

  const pendingPurchases = useMemo(() => {
    const source = [...unpaidPurchases];
    const current = editingVoucher?.bill_kind === 'purchase' ? editingBillQuery.data : null;
    if (current?.id) {
      const index = source.findIndex((row) => row.id === current.id);
      if (index >= 0) source[index] = current;
      else source.push(current);
    }
    const pending = source.filter((p) => p.status !== 'cancelled' && purchasePending(p) > 1e-6);
    if (!form.debit_account_id) return pending;
    return pending.filter((p) => p.vendor_account_id === form.debit_account_id);
  }, [editingBillQuery.data, editingVoucher?.bill_kind, form.debit_account_id, unpaidPurchases]);

  const pendingWashingJobs = useMemo(() => {
    const source = [...unpaidJobs];
    const current = editingVoucher?.bill_kind === 'washing' ? editingBillQuery.data : null;
    if (current?.id) {
      const index = source.findIndex((row) => row.id === current.id);
      if (index >= 0) source[index] = current;
      else source.push(current);
    }
    const pending = source.filter((j) => Number(j.washing_balance ?? 0) > 1e-6);
    const vendor = normText(selectedDebitAccountName);
    if (!vendor) return pending;
    return pending.filter((j) => normText(j.vendor_name) === vendor);
  }, [editingBillQuery.data, editingVoucher?.bill_kind, selectedDebitAccountName, unpaidJobs]);

  const pendingBills = form.bill_kind === 'washing' ? pendingWashingJobs : pendingPurchases;

  const selectedBills = useMemo(
    () => pendingBills.filter((bill) => form.bill_ids.includes(bill.id)),
    [form.bill_ids, pendingBills]
  );

  const selectedBillsTotal = useMemo(
    () => sumBillBalances(selectedBills, form.bill_kind),
    [form.bill_kind, selectedBills]
  );

  const selectedWashingJob = useMemo(() => {
    if (form.bill_kind !== 'washing' || form.bill_ids.length !== 1) return null;
    return pendingWashingJobs.find((r) => r.id === form.bill_ids[0]) || null;
  }, [form.bill_ids, form.bill_kind, pendingWashingJobs]);

  const selectedPurchase = useMemo(() => {
    if (form.bill_kind !== 'purchase' || form.bill_ids.length !== 1) return null;
    return pendingPurchases.find((r) => r.id === form.bill_ids[0]) || null;
  }, [form.bill_ids, form.bill_kind, pendingPurchases]);

  const selectedBillPreview = useMemo(() => {
    if (selectedBills.length) {
      return selectedBills.slice(0, 2).map((bill) => ({
        id: bill.id,
        label: billRowLabel(bill, form.bill_kind),
      }));
    }
    if (editingId && form.bill_ids.length && editingBillLabel) {
      return [{ id: form.bill_ids[0], label: editingBillLabel }];
    }
    return [];
  }, [editingBillLabel, editingId, form.bill_ids, form.bill_kind, selectedBills]);

  const prevDebitAccountRef = useRef('');
  const prevBillKindRef = useRef('purchase');

  useEffect(() => {
    if (!modalOpen || !form.debit_account_id || pendingBills.length === 0) {
      prevDebitAccountRef.current = form.debit_account_id;
      prevBillKindRef.current = form.bill_kind;
      return;
    }

    const vendorChanged = prevDebitAccountRef.current !== form.debit_account_id;
    const kindChanged = prevBillKindRef.current !== form.bill_kind;
    if (vendorChanged || kindChanged) {
      setBillPickerOpen(true);
    }

    prevDebitAccountRef.current = form.debit_account_id;
    prevBillKindRef.current = form.bill_kind;
  }, [modalOpen, form.debit_account_id, form.bill_kind, pendingBills.length]);

  const handleBillPickerConfirm = (draftBillIds) => {
    const nextSelected = pendingBills.filter((bill) => draftBillIds.includes(bill.id));
    const total = sumBillBalances(nextSelected, form.bill_kind);
    setForm((f) => ({
      ...f,
      bill_ids: draftBillIds,
      amount: draftBillIds.length ? String(total) : '',
    }));
    clearFieldError(setFieldErrors, 'bill_ids');
    clearFieldError(setFieldErrors, 'amount');
    setBillPickerOpen(false);
  };

  const saveMut = useMutation({
    mutationFn: (body) =>
      editingId ? paymentVouchersApi.update(editingId, body) : paymentVouchersApi.create(body),
    onSuccess: async (response, variables) => {
      const count = response?.meta?.count ?? 1;
      toast.success(
        editingId
          ? 'Payment voucher updated'
          : count > 1
            ? `${count} payment vouchers saved`
            : 'Payment voucher saved'
      );
      await invalidateAccountingDomain(queryClient);
      await invalidateLaundryDomain(queryClient);
      if (variables?.bill_kind === 'purchase') {
        await queryClient.invalidateQueries({ queryKey: ['purchases'] });
      }
      setModalOpen(false);
      setBillPickerOpen(false);
      setEditingId(null);
      setEditingVoucher(null);
      setEditingBillLabel('');
      setForm(emptyForm());
      setFieldErrors({});
      prevDebitAccountRef.current = '';
      prevBillKindRef.current = 'purchase';
    },
    onError: (e) => {
      const msg = e?.response?.data?.error?.message || e?.message || 'Failed to save';
      toast.error(msg);
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setEditingVoucher(null);
    setEditingBillLabel('');
    setForm(emptyForm());
    setFieldErrors({});
    setBillPickerOpen(false);
    prevDebitAccountRef.current = '';
    prevBillKindRef.current = 'purchase';
    setModalOpen(true);
  };

  const openEdit = (row) => {
    const billKind = row.bill_kind === 'washing' ? 'washing' : 'purchase';
    setEditingId(row.id);
    setEditingVoucher(row);
    setEditingBillLabel(billKindDisplay(row));
    setForm({
      credit_account_id: row.credit_account_id || '',
      debit_account_id: row.debit_account_id || '',
      entry_date: String(row.entry_date || '').slice(0, 10) || todayStr(),
      amount: String(row.amount ?? ''),
      remarks: row.remarks || '',
      bill_kind: billKind,
      bill_ids: row.bill_id ? [row.bill_id] : [],
    });
    setFieldErrors({});
    setBillPickerOpen(false);
    prevDebitAccountRef.current = row.debit_account_id || '';
    prevBillKindRef.current = billKind;
    setModalOpen(true);
  };

  useEffect(() => {
    const voucherId = searchParams.get('edit');
    if (!voucherId) return undefined;
    let cancelled = false;
    paymentVouchersApi
      .get(voucherId)
      .then((response) => {
        if (!cancelled) openEdit(response.data);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error?.response?.data?.error?.message || 'Could not open payment voucher');
        }
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
    };
  }, [searchParams, setSearchParams]);

  const closeModal = () => {
    setModalOpen(false);
    setBillPickerOpen(false);
    setEditingId(null);
    setEditingVoucher(null);
    setEditingBillLabel('');
    setForm(emptyForm());
    setFieldErrors({});
    prevDebitAccountRef.current = '';
    prevBillKindRef.current = 'purchase';
  };

  const submitForm = () => {
    if (saveMut.isPending) return;
    const errors = {};
    let firstMessage = null;
    const add = (key, msg) => {
      if (!errors[key]) errors[key] = msg;
      if (!firstMessage) firstMessage = msg;
    };

    if (!form.credit_account_id) add('credit_account_id', 'Credited account is required');
    if (!form.debit_account_id) add('debit_account_id', 'Debited account is required');

    const amt = Number(form.amount);
    if (Number.isNaN(amt) || amt <= 0) add('amount', 'Enter a valid amount');
    if (!form.bill_ids.length) {
      add(
        'bill_ids',
        form.bill_kind === 'washing'
          ? 'Select at least one washing bill'
          : 'Select at least one purchase bill'
      );
    }
    if (
      editingId &&
      editingBillQuery.isLoading &&
      form.bill_ids.includes(editingVoucher?.bill_id)
    ) {
      add('bill_ids', 'Wait for the linked bill balance to load');
    }
    if (form.bill_ids.length > 1 && Math.abs(amt - selectedBillsTotal) > 1e-6) {
      add('amount', 'Amount must equal total of selected bills');
    }
    if (
      form.bill_ids.length === 1 &&
      selectedBills.length === 1 &&
      amt > selectedBillsTotal + 1e-6
    ) {
      add(
        'amount',
        form.bill_kind === 'washing'
          ? 'Amount cannot exceed remaining washing balance'
          : 'Amount cannot exceed remaining purchase balance'
      );
    }

    const remarksTrim = String(form.remarks || '').trim();
    const payload = {
      credit_account_id: String(form.credit_account_id || '').trim(),
      debit_account_id: String(form.debit_account_id || '').trim(),
      entry_date: form.entry_date,
      amount: amt,
      bill_kind: form.bill_kind,
      ...(form.bill_ids.length > 1 ? { bill_ids: form.bill_ids } : { bill_id: form.bill_ids[0] }),
      ...(remarksTrim ? { remarks: remarksTrim } : {}),
    };

    const parsed = createPaymentVoucherBodySchema.safeParse(payload);
    if (!parsed.success) {
      Object.assign(errors, zodIssuesToFieldMap(parsed.error.errors));
    }

    if (Object.keys(errors).length) {
      rejectSubmit({ errors, setErrors: setFieldErrors, toast, message: firstMessage });
      return;
    }
    setFieldErrors({});
    saveMut.mutate(parsed.data);
  };

  const allColumns = useMemo(
    () => [
      { key: 'voucher_number', header: 'Voucher No.', columnPickerLabel: 'Voucher No.' },
      {
        key: 'entry_date',
        header: 'Date & Time',
        columnPickerLabel: 'Date & time',
        className: 'text-xs whitespace-nowrap tabular-nums',
        render: (r) => formatFinancialRecordDateTime(r),
      },
      {
        key: 'credit_account_name',
        header: 'Credited Account',
        columnPickerLabel: 'Credited Account',
        render: (r) =>
          r.credit_account_name ||
          accountNameById.get(r.credit_account_id) ||
          r.credit_account_id ||
          '—',
      },
      {
        key: 'debit_account_name',
        header: 'Debited Account',
        columnPickerLabel: 'Debited Account',
        render: (r) =>
          r.debit_account_name ||
          accountNameById.get(r.debit_account_id) ||
          r.debit_account_id ||
          '—',
      },
      {
        key: 'bill_kind',
        header: 'Bill',
        columnPickerLabel: 'Linked bill',
        render: (r) => (
          <TransactionBillLink voucherId={r.id} billKind={r.bill_kind} linkedBillId={r.bill_id}>
            {billKindDisplay(r)}
          </TransactionBillLink>
        ),
      },
      {
        key: 'remarks',
        header: 'Remarks',
        columnPickerLabel: 'Remarks',
        render: (r) => {
          const text = String(r.remarks || '').trim();
          if (!text) return '—';
          const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
          return (
            <span className="block max-w-[12rem] truncate" title={text}>
              {short}
            </span>
          );
        },
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
        width: 132,
        render: (r) => {
          const slipBusy = slipBusyId === r.id;
          return (
            <div
              className="flex justify-end gap-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              role="presentation"
            >
              <button
                type="button"
                onClick={() => openEdit(r)}
                className="p-0 text-gray-500 hover:text-brand hover:bg-brand/10 rounded"
                aria-label="Edit payment voucher"
                title="Edit"
              >
                <Pencil size={15} />
              </button>
              <button
                type="button"
                disabled={slipBusy}
                onClick={async () => {
                  setSlipBusyId(r.id);
                  try {
                    await printPaymentVoucher(r);
                  } catch (err) {
                    toast.error(err?.message || 'Could not print voucher');
                  } finally {
                    setSlipBusyId(null);
                  }
                }}
                className="p-0 text-gray-500 hover:text-brand hover:bg-brand/10 rounded disabled:opacity-50"
                aria-label="Print payment voucher"
                title="Print"
              >
                <Printer size={15} />
              </button>
              <button
                type="button"
                disabled={slipBusy}
                onClick={async () => {
                  setSlipBusyId(r.id);
                  try {
                    await downloadPaymentVoucher(r);
                  } catch (err) {
                    toast.error(err?.message || 'Could not download voucher');
                  } finally {
                    setSlipBusyId(null);
                  }
                }}
                className="p-0 text-gray-500 hover:text-brand hover:bg-brand/10 rounded disabled:opacity-50"
                aria-label="Download payment voucher"
                title="Download"
              >
                <Download size={15} />
              </button>
              <button
                type="button"
                onClick={() => adminDelete.requestDelete(r)}
                className="p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                aria-label="Delete payment voucher"
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        },
      },
    ],
    [accountNameById, adminDelete, slipBusyId]
  );

  const { visibleColumns, pickerProps, exportColumns } = useDataTableColumns(
    'payment-vouchers',
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
            if (c.key === 'credit_account_name') {
              return r.credit_account_name || accountNameById.get(r.credit_account_id) || '';
            }
            if (c.key === 'debit_account_name') {
              return r.debit_account_name || accountNameById.get(r.debit_account_id) || '';
            }
            if (c.key === 'bill_kind') return billKindDisplay(r);
            if (c.key === 'remarks') return r.remarks || '';
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
      listFn: paymentVouchersApi.list,
      listParams: listFilterParams,
      title: 'Payment Vouchers',
      subtitle: subtitleParts.length ? subtitleParts.join(' · ') : 'All payment vouchers',
      columns: pdfColumns,
    };
  };

  const exportPdf = () => {
    withExportPdfBusy(setExportBusy, async () => {
      await exportFilteredListPdf({
        ...listPdfOpts(),
        filename: 'payment_vouchers.pdf',
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
        title="Payment Voucher"
        description="Pay vendors from bank or cash; links to purchase bills or washing bills"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListPdfToolbarButtons
              busy={exportBusy}
              disabled={listQuery.isLoading}
              onPrint={printPdf}
              onExport={exportPdf}
            />
            <Button icon={Plus} onClick={openCreate}>
              Payment Voucher
            </Button>
          </div>
        }
      />

      <div className="card p-3 mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 max-w-md">
            <label className="label" htmlFor="pv-search">
              Search
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                aria-hidden
              />
              <input
                id="pv-search"
                type="search"
                className="input w-full pl-9"
                placeholder="Search…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
          </div>
          <Input
            id="pv-filter-date"
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
        emptyMessage="Use Payment Voucher to add your first entry."
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
        title={editingId ? 'Edit Payment Voucher' : 'Create Payment Voucher'}
        size="2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={submitForm} loading={saveMut.isPending}>
              {editingId ? 'Save changes' : 'Submit'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              id="pv-modal-date"
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
              <label className="label" htmlFor="pv-modal-credit">
                Credited Account <span className="text-red-600">*</span>
              </label>
              <AccountSelectWithQr
                accountId={form.credit_account_id}
                accounts={bankCashAccounts}
                accountKind="payment"
                size="md"
              >
                <select
                  id="pv-modal-credit"
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
              {err('credit_account_id') ? (
                <p className="text-xs text-red-600 mt-1">{err('credit_account_id')}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_1.6fr_0.85fr] gap-3 items-start">
            <div className="min-w-0">
              <label className="label" htmlFor="pv-modal-debit">
                Debited Account <span className="text-red-600">*</span>
              </label>
              <select
                id="pv-modal-debit"
                className={fieldShellClass(err('debit_account_id'), 'input w-full bg-surface pr-8')}
                value={form.debit_account_id}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setForm((f) => ({
                    ...f,
                    debit_account_id: nextId,
                    bill_ids: [],
                    amount: '',
                  }));
                  clearFieldError(setFieldErrors, 'debit_account_id');
                  clearFieldError(setFieldErrors, 'bill_ids');
                  clearFieldError(setFieldErrors, 'amount');
                }}
              >
                <option value="">Select Account</option>
                {vendorDebitAccounts.some((a) => normGroup(a.account_group) === 'vendors') ? (
                  <optgroup label="Vendors">
                    {vendorDebitAccounts
                      .filter((a) => normGroup(a.account_group) === 'vendors')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {vendorDebitAccounts.some(
                  (a) => normGroup(a.account_group) === 'laundry vendor'
                ) ? (
                  <optgroup label="Laundry vendor">
                    {vendorDebitAccounts
                      .filter((a) => normGroup(a.account_group) === 'laundry vendor')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                {vendorDebitAccounts.some((a) => normGroup(a.account_group) === 'parties') ? (
                  <optgroup label="Parties">
                    {vendorDebitAccounts
                      .filter((a) => normGroup(a.account_group) === 'parties')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
              </select>
              {err('debit_account_id') ? (
                <p className="text-xs text-red-600 mt-1">{err('debit_account_id')}</p>
              ) : null}
            </div>

            <div className="min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="label mb-0">
                  Bill {form.debit_account_id ? <span className="text-red-600">*</span> : null}
                </label>
              </div>
              <div className="flex flex-nowrap items-center gap-4 min-w-0 mb-1">
                <label className="inline-flex shrink-0 items-center gap-1 cursor-pointer whitespace-nowrap">
                  <input
                    type="radio"
                    name="pv-bill-kind"
                    checked={form.bill_kind === 'purchase'}
                    onChange={() => {
                      setForm((f) => ({ ...f, bill_kind: 'purchase', bill_ids: [], amount: '' }));
                      clearFieldError(setFieldErrors, 'bill_ids');
                      clearFieldError(setFieldErrors, 'amount');
                    }}
                  />
                  <span>Purchase Bill</span>
                </label>
                <label className="inline-flex shrink-0 items-center gap-1 cursor-pointer whitespace-nowrap">
                  <input
                    type="radio"
                    name="pv-bill-kind"
                    checked={form.bill_kind === 'washing'}
                    onChange={() => {
                      setForm((f) => ({ ...f, bill_kind: 'washing', bill_ids: [], amount: '' }));
                      clearFieldError(setFieldErrors, 'bill_ids');
                      clearFieldError(setFieldErrors, 'amount');
                    }}
                  />
                  <span>Washing Bill</span>
                </label>
                <div className="ml-auto shrink-0 text-right">
                  <span className="tabular-nums text-sm font-semibold text-gray-900">
                    {formatCurrency(selectedBillsTotal)}
                  </span>
                  {form.bill_ids.length > 0 ? (
                    <p className="text-[10px] text-gray-500 whitespace-nowrap">
                      {form.bill_ids.length} bill(s) selected
                    </p>
                  ) : null}
                </div>
              </div>
              {!form.debit_account_id ? (
                <p className="text-[11px] text-gray-500 py-2">Select Debited Account first</p>
              ) : pendingBills.length === 0 && !(editingId && form.bill_ids.length) ? (
                <p className="text-[11px] text-gray-500 py-2">
                  {form.bill_kind === 'washing'
                    ? 'No pending washing bills for selected vendor.'
                    : 'No pending purchase bills for selected vendor.'}
                </p>
              ) : (
                <div
                  className={fieldShellClass(
                    err('bill_ids'),
                    'border border-gray-200 rounded-lg bg-surface px-3 py-2 space-y-2'
                  )}
                >
                  {form.bill_ids.length === 0 ? (
                    <p className="text-[11px] text-gray-500">No bills selected</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-800">
                        {form.bill_ids.length} bill(s) selected ·{' '}
                        <span className="font-semibold tabular-nums">
                          {formatCurrency(selectedBillsTotal)}
                        </span>
                      </p>
                      {selectedBillPreview.map((item) => (
                        <p key={item.id} className="text-[11px] text-gray-600 truncate">
                          {item.label}
                        </p>
                      ))}
                      {form.bill_ids.length > 2 ? (
                        <p className="text-[11px] text-gray-500">
                          +{form.bill_ids.length - 2} more
                        </p>
                      ) : null}
                    </div>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setBillPickerOpen(true)}
                  >
                    {form.bill_ids.length > 0 ? 'Change bills' : 'Select bills'}
                  </Button>
                </div>
              )}
              {err('bill_ids') ? (
                <p className="text-xs text-red-600 mt-1">{err('bill_ids')}</p>
              ) : null}
              {selectedWashingJob ? (
                <div className="mt-1 text-[11px] text-gray-500 flex flex-nowrap items-center gap-x-4 overflow-x-auto">
                  <span className="whitespace-nowrap">
                    Payable:{' '}
                    <span className="text-gray-800">
                      {formatCurrency(Number(selectedWashingJob.payable_amount ?? 0))}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    Paid:{' '}
                    <span className="text-gray-800">
                      {formatCurrency(Number(selectedWashingJob.paid_to_washing_amount ?? 0))}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    Remaining:{' '}
                    <span className="text-gray-800">
                      {formatCurrency(Number(selectedWashingJob.washing_balance ?? 0))}
                    </span>
                  </span>
                </div>
              ) : null}
              {selectedPurchase ? (
                <div className="mt-1 text-[11px] text-gray-500 flex flex-nowrap items-center gap-x-4 overflow-x-auto">
                  <span className="whitespace-nowrap">
                    Bill:{' '}
                    <span className="text-gray-800">
                      {formatCurrency(Number(selectedPurchase.total_amount ?? 0))}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    Paid:{' '}
                    <span className="text-gray-800">
                      {formatCurrency(Number(selectedPurchase.advance ?? 0))}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    Remaining:{' '}
                    <span className="text-gray-800">
                      {formatCurrency(purchasePending(selectedPurchase))}
                    </span>
                  </span>
                </div>
              ) : null}
            </div>

            <div className="min-w-0">
              <label className="label" htmlFor="pv-modal-amount">
                Amount <span className="text-red-600">*</span>
              </label>
              <input
                id="pv-modal-amount"
                type="number"
                min="0"
                step="0.01"
                readOnly={form.bill_ids.length > 1}
                className={fieldShellClass(
                  err('amount'),
                  `input w-full tabular-nums${form.bill_ids.length > 1 ? ' bg-gray-100' : ''}`
                )}
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

          <div>
            <label className="label" htmlFor="pv-modal-remarks">
              Remarks
            </label>
            <textarea
              id="pv-modal-remarks"
              className="input w-full min-h-[100px]"
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="type your Remarks here"
            />
          </div>
        </div>
      </Modal>

      <PaymentVoucherBillPickerModal
        isOpen={billPickerOpen}
        onClose={() => setBillPickerOpen(false)}
        onConfirm={handleBillPickerConfirm}
        billKind={form.bill_kind}
        bills={pendingBills}
        initialSelectedIds={form.bill_ids}
        vendorName={selectedDebitAccountName}
      />

      <AdminDeleteModal
        isOpen={!!adminDelete.target}
        onClose={adminDelete.close}
        onConfirm={adminDelete.confirmDelete}
        title="Delete payment voucher?"
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

export default PaymentVoucherList;
