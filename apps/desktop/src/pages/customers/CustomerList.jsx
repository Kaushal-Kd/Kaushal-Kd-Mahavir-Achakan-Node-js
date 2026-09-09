import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate } from '@wrs/shared';
import { Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import CompactDateRangeFilter from '../../components/list/CompactDateRangeFilter.jsx';
import AdminDeleteModal from '../../components/ui/AdminDeleteModal.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SmartImage from '../../components/ui/SmartImage.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useAdminDelete } from '../../hooks/useAdminDelete.js';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { useSelectedShopName } from '../../hooks/useSelectedShopName.js';
import { customersApi } from '../../lib/api/customers.js';
import { customerListMobileCard } from '../../lib/listMobileCards.jsx';
import { invalidateCustomersDomain } from '../../lib/queryInvalidation.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';

const trunc = (s, n) => {
  const t = String(s ?? '');
  if (!t) return '—';
  return t.length <= n ? t : `${t.slice(0, n)}…`;
};
const yn = (v) => (v ? 'Yes' : 'No');

/** Columns hidden until the user turns them on. Address stays visible for report verification. */
const CUSTOMER_LIST_DEFAULT_HIDDEN = [
  'phone1_name',
  'phone2',
  'phone2_name',
  'whatsapp',
  'email',
  'anniversary',
  'is_repeat',
  'notes',
  'created_at',
  'updated_at',
];

const CustomerList = () => {
  const [search, setSearch] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
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
    deleteFn: (row, admin_password) => customersApi.remove(row.id, { admin_password }),
    onSuccess: async () => {
      toast.success('Customer deleted');
      await invalidateCustomersDomain(queryClient);
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['customers', { search, page, perPage, createdFrom, createdTo }],
    queryFn: () =>
      customersApi.list({
        search,
        page,
        per_page: perPage,
        ...(createdFrom ? { created_from: createdFrom } : {}),
        ...(createdTo ? { created_to: createdTo } : {}),
      }),
    keepPreviousData: true,
  });

  const dateClear = !createdFrom && !createdTo;
  const clearDates = () => {
    setCreatedFrom('');
    setCreatedTo('');
    setPage(1);
  };

  const allColumns = useMemo(
    () => [
      {
        key: 'photo',
        header: '',
        columnPickerLabel: 'Photo',
        width: 56,
        render: (r) => (
          <SmartImage
            src={r.photo_url}
            alt={r.name}
            className="w-10 h-10 rounded bg-gray-50 object-contain border border-gray-100"
          />
        ),
      },
      {
        key: 'name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => <span className="font-medium">{r.name}</span>,
      },
      { key: 'phone1', header: 'Phone 1', columnPickerLabel: 'Phone 1' },
      { key: 'phone1_name', header: 'Phone 1 label', columnPickerLabel: 'Phone 1 label' },
      { key: 'phone2', header: 'Phone 2', columnPickerLabel: 'Phone 2' },
      { key: 'phone2_name', header: 'Phone 2 label', columnPickerLabel: 'Phone 2 label' },
      { key: 'whatsapp', header: 'WhatsApp', columnPickerLabel: 'WhatsApp' },
      { key: 'email', header: 'Email', columnPickerLabel: 'Email' },
      {
        key: 'address',
        header: 'Address',
        columnPickerLabel: 'Address',
        render: (r) => (
          <span className="max-w-[200px] inline-block align-top">{trunc(r.address, 80)}</span>
        ),
      },
      {
        key: 'total_bill_amount',
        header: 'Total Bill Amount',
        columnPickerLabel: 'Total Bill Amount',
        align: 'right',
        className: 'text-xs tabular-nums',
        render: (r) => formatCurrency(Number(r.total_bill_amount || 0)),
      },
      {
        key: 'anniversary',
        header: 'Anniversary',
        columnPickerLabel: 'Anniversary',
        render: (r) => (r.anniversary ? formatDate(r.anniversary) : '—'),
      },
      {
        key: 'tags',
        header: 'Tags',
        columnPickerLabel: 'Tags (repeat)',
        render: (r) => (
          <div className="flex gap-1 flex-wrap">
            {r.is_repeat ? <span className="chip">Repeat</span> : null}
            {!r.is_repeat ? <span className="text-gray-400">—</span> : null}
          </div>
        ),
      },
      {
        key: 'is_repeat',
        header: 'Repeat',
        columnPickerLabel: 'Repeat customer',
        render: (r) => yn(r.is_repeat),
      },
      {
        key: 'notes',
        header: 'Notes',
        columnPickerLabel: 'Notes',
        render: (r) => trunc(r.notes, 60),
      },
      {
        key: 'created_at',
        header: 'Created',
        columnPickerLabel: 'Created at',
        render: (r) => (r.created_at ? formatDate(r.created_at) : '—'),
      },
      {
        key: 'updated_at',
        header: 'Updated',
        columnPickerLabel: 'Updated at',
        render: (r) => (r.updated_at ? formatDate(r.updated_at) : '—'),
      },
      {
        key: 'actions',
        header: '',
        locked: true,
        align: 'right',
        width: 120,
        render: (r) => (
          <div className="flex justify-end gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/customers/${r.id}/edit`);
              }}
              className="p-0 text-gray-500 hover:text-brand hover:bg-brand-light rounded"
              aria-label="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                requestDelete(r);
              }}
              className="p-0 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
              aria-label="Delete"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
      },
    ],
    [navigate, requestDelete]
  );

  const { visibleColumns, pickerProps } = useDataTableColumns('customers', allColumns, {
    defaultHidden: CUSTOMER_LIST_DEFAULT_HIDDEN,
    prefsRevision: 2,
  });

  return (
    <>
      <PageHeader
        title="Customers"
        description="All customers for the selected shop"
        actions={
          <Button icon={Plus} onClick={() => navigate('/customers/new')}>
            New customer
          </Button>
        }
      />

      <div className="card p-1.5 mb-2 flex flex-wrap items-center gap-1.5">
        <Search size={14} className="text-gray-400 shrink-0" />
        <input
          className="flex-1 min-w-[8rem] outline-none text-xs"
          placeholder="Search name, phone, email, address…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <TableColumnPicker {...pickerProps} />
      </div>

      <CompactDateRangeFilter
        label="Joined"
        from={createdFrom}
        to={createdTo}
        onFromChange={(v) => {
          setPage(1);
          setCreatedFrom(v);
        }}
        onToChange={(v) => {
          setPage(1);
          setCreatedTo(v);
        }}
        onClear={clearDates}
        disabledClear={dateClear}
      />

      <DataTable
        columns={visibleColumns}
        rows={data?.data}
        loading={isLoading}
        emptyTitle="No customers yet"
        emptyMessage="Start by adding your first customer."
        mobileCardRender={customerListMobileCard}
        visibleCount={data?.data?.length ?? 0}
        totalCount={data?.meta?.total ?? 0}
        page={data?.meta?.page ?? page}
        totalPages={data?.meta?.total_pages ?? 1}
        countLabel="records"
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        disablePrevious={page <= 1}
        disableNext={page >= (data?.meta?.total_pages ?? 1)}
        perPage={perPage}
        onPerPageChange={(n) => {
          setPage(1);
          setPerPage(n);
        }}
      />

      <AdminDeleteModal
        isOpen={Boolean(deleting)}
        onClose={close}
        onConfirm={confirmDelete}
        title="Delete customer?"
        description="This can be restored later from the recycle bin."
        itemLabel={deleting?.name}
        shopName={selectedShopName}
        errorMessage={error}
        onClearError={clearError}
        loading={loading}
      />
    </>
  );
};

export default CustomerList;
