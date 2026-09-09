import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDateTime, round2 } from '@wrs/shared';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import BookingBillLink from '../../components/booking/BookingBillLink.jsx';
import Button from '../../components/ui/Button.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import TableColumnPicker from '../../components/ui/TableColumnPicker.jsx';
import { useDataTableColumns } from '../../hooks/useDataTableColumns.js';
import { creditNotesApi } from '../../lib/api/creditNotes.js';
import { DEFAULT_TABLE_PER_PAGE } from '../../lib/tablePerPage.js';
import { toast } from '../../stores/uiStore.js';

function creditOpenBalance(r) {
  if (r.settled_at) return 0;
  return round2(
    Math.max(0, Number(r.open_remaining ?? r.remaining ?? Number(r.amount) - Number(r.amount_applied || 0)))
  );
}

const CreditNotes = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterSettled, setFilterSettled] = useState(false);
  const [settleRow, setSettleRow] = useState(null);
  const [settleRemarks, setSettleRemarks] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchDraft]);

  const listQuery = useQuery({
    queryKey: ['credit-notes', { page, perPage, search, filterDate, filterSettled }],
    queryFn: () =>
      creditNotesApi.list({
        page,
        per_page: perPage,
        sort: '-created_at',
        ...(search ? { search } : {}),
        ...(filterDate ? { entry_date: filterDate } : {}),
        ...(filterSettled ? { settled: true } : { settled: false }),
      }),
    keepPreviousData: true,
  });

  const settleMut = useMutation({
    mutationFn: ({ id, body }) => creditNotesApi.settle(id, body),
    onSuccess: () => {
      toast.success('Credit note settled');
      setSettleRow(null);
      setSettleRemarks('');
      queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
    },
    onError: (e) => {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Failed to settle');
    },
  });

  const allColumns = useMemo(() => {
    const amountCols = filterSettled
      ? [
          {
            key: 'amount',
            header: 'Issued',
            columnPickerLabel: 'Issued',
            align: 'right',
            render: (r) => formatCurrency(r.amount),
          },
          {
            key: 'amount_applied',
            header: 'Applied',
            columnPickerLabel: 'Applied',
            align: 'right',
            render: (r) => formatCurrency(r.amount_applied ?? 0),
          },
          {
            key: 'amount_settled',
            header: 'Settled',
            columnPickerLabel: 'Settled',
            align: 'right',
            render: (r) => {
              const settledAmt = round2(
                Number(
                  r.amount_settled ??
                    (r.settled_at ? Math.max(0, Number(r.amount) - Number(r.amount_applied || 0)) : 0)
                )
              );
              return (
                <span className={settledAmt > 0 ? 'font-medium tabular-nums' : 'tabular-nums text-gray-500'}>
                  {formatCurrency(settledAmt)}
                </span>
              );
            },
          },
          {
            key: 'remaining',
            header: 'Balance',
            columnPickerLabel: 'Balance',
            align: 'right',
            render: (r) => (
              <span className="tabular-nums text-gray-500">{formatCurrency(creditOpenBalance(r))}</span>
            ),
          },
          {
            key: 'settled_at',
            header: 'Settled on',
            columnPickerLabel: 'Settled on',
            render: (r) => (r.settled_at ? formatDateTime(r.settled_at) : '—'),
          },
        ]
      : [
          {
            key: 'amount',
            header: 'Issued',
            columnPickerLabel: 'Issued',
            align: 'right',
            render: (r) => formatCurrency(r.amount),
          },
          {
            key: 'amount_applied',
            header: 'Applied',
            columnPickerLabel: 'Applied',
            align: 'right',
            render: (r) => formatCurrency(r.amount_applied ?? 0),
          },
          {
            key: 'remaining',
            header: 'Balance',
            columnPickerLabel: 'Balance',
            align: 'right',
            render: (r) => {
              const remaining = creditOpenBalance(r);
              return (
                <span
                  className={
                    remaining > 0 ? 'font-medium text-brand tabular-nums' : 'tabular-nums text-gray-500'
                  }
                >
                  {formatCurrency(remaining)}
                </span>
              );
            },
          },
        ];

    return [
      { key: 'note_number', header: 'Note No.', columnPickerLabel: 'Note No.' },
      {
        key: 'order_number',
        header: 'Bill No.',
        columnPickerLabel: 'Bill No.',
        render: (r) => {
          const label = r.order_number || (r.bill_no != null && r.bill_no !== '' ? String(r.bill_no) : null);
          if (!label) return '—';
          return (
            <BookingBillLink orderId={r.source_order_id}>{label}</BookingBillLink>
          );
        },
      },
      {
        key: 'customer_name',
        header: 'Name',
        columnPickerLabel: 'Name',
        render: (r) => r.customer_name || '—',
      },
      {
        key: 'customer_phone',
        header: 'Customer No.',
        columnPickerLabel: 'Customer No.',
        render: (r) => r.customer_phone || '—',
      },
      {
        key: 'remarks',
        header: 'Remarks',
        columnPickerLabel: 'Remarks',
        render: (r) => (
          <span className="line-clamp-2" title={r.remarks || ''}>
            {r.remarks || '—'}
          </span>
        ),
      },
      {
        key: 'created_at',
        header: 'Date',
        columnPickerLabel: 'Date',
        render: (r) => (r.created_at ? formatDateTime(r.created_at) : '—'),
      },
      ...amountCols,
      ...(filterSettled
        ? []
        : [
            {
              key: 'actions',
              header: 'Action',
              locked: true,
              align: 'right',
              width: 96,
              render: (r) => {
                const remaining = creditOpenBalance(r);
                if (remaining <= 0) {
                  return <span className="text-[10px] text-gray-500">Fully applied</span>;
                }
                return (
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSettleRow(r);
                      setSettleRemarks('');
                    }}
                  >
                    Settle
                  </Button>
                );
              },
            },
          ]),
    ];
  }, [filterSettled]);

  const { visibleColumns, pickerProps } = useDataTableColumns(
    filterSettled ? 'credit-notes-settled' : 'credit-notes-open',
    allColumns
  );

  const meta = listQuery.data?.meta;

  const submitSettle = () => {
    if (!settleRow) return;
    settleMut.mutate({
      id: settleRow.id,
      body: { settle_remarks: String(settleRemarks || '').trim() || null },
    });
  };

  return (
    <>
      <PageHeader
        title="Credit Notes"
        description="Store credit from cancelled bookings — settle or apply on new bookings"
      />

      <div className="card p-3 mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 max-w-md">
            <label className="label" htmlFor="cn-search">
              Search
            </label>
            <div className="relative">
              <Search
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                aria-hidden
              />
              <input
                id="cn-search"
                type="search"
                className="input w-full pl-9"
                placeholder="Search…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
              />
            </div>
          </div>
          <Input
            id="cn-filter-date"
            label="Date"
            type="date"
            className="w-full sm:w-auto min-w-[10.5rem]"
            value={filterDate}
            onChange={(e) => {
              setFilterDate(e.target.value);
              setPage(1);
            }}
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 pb-2">
            <input
              type="checkbox"
              checked={filterSettled}
              onChange={(e) => {
                setFilterSettled(e.target.checked);
                setPage(1);
              }}
            />
            Settled
          </label>
          <TableColumnPicker {...pickerProps} />
        </div>
      </div>

      <DataTable
        columns={visibleColumns}
        rows={listQuery.data?.data}
        loading={listQuery.isLoading}
        emptyTitle="No Record Found"
        emptyMessage={
          filterSettled
            ? 'Settled and fully applied credit notes appear here (applied on bookings or closed via Settle).'
            : 'Open credit notes with a balance appear here — apply on new bookings or use Settle to close.'
        }
        visibleCount={listQuery.data?.data?.length ?? 0}
        totalCount={meta?.total ?? 0}
        page={meta?.page ?? page}
        totalPages={meta?.total_pages ?? 1}
        countLabel="credit notes"
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
        isOpen={Boolean(settleRow)}
        onClose={() => {
          setSettleRow(null);
          setSettleRemarks('');
        }}
        title={settleRow ? `Settle ${settleRow.note_number}` : 'Settle credit note'}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setSettleRow(null);
                setSettleRemarks('');
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitSettle} loading={settleMut.isPending}>
              Submit
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-gray-600">
            <p>
              Issued:{' '}
              <span className="font-semibold tabular-nums block">{formatCurrency(settleRow?.amount)}</span>
            </p>
            <p>
              Applied:{' '}
              <span className="font-semibold tabular-nums block">
                {formatCurrency(settleRow?.amount_applied ?? 0)}
              </span>
            </p>
            <p>
              To settle:{' '}
              <span className="font-semibold tabular-nums block text-brand">
                {formatCurrency(creditOpenBalance(settleRow || {}))}
              </span>
            </p>
          </div>
          <div>
            <label className="label" htmlFor="cn-settle-remarks">
              Remarks
            </label>
            <textarea
              id="cn-settle-remarks"
              className="input w-full min-h-[5rem]"
              value={settleRemarks}
              onChange={(e) => setSettleRemarks(e.target.value)}
              placeholder="Settlement remarks…"
            />
          </div>
        </div>
      </Modal>
    </>
  );
};

export default CreditNotes;
