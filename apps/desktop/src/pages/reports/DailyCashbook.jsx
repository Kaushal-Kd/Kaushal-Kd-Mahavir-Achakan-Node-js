import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCurrency, formatDate, todayIndiaISODate } from '@wrs/shared';
import { Calendar, Info } from 'lucide-react';
import { useMemo, useState } from 'react';

import Button from '../../components/ui/Button.jsx';
import Card from '../../components/ui/Card.jsx';
import Input from '../../components/ui/Input.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Skeleton from '../../components/ui/Skeleton.jsx';
import TableHeaderLabel from '../../components/ui/TableHeaderLabel.jsx';
import { reportsApi } from '../../lib/api/reports.js';
import { syncService } from '../../services/syncService.js';
import DailyCashbookBreakdownModal from './DailyCashbookBreakdownModal.jsx';
import AdminPasswordModal from '../../components/ui/AdminPasswordModal.jsx';
import { toast } from '../../stores/uiStore.js';

function normGroupLabel(group) {
  const g = String(group || '').trim();
  return g || 'Other';
}

const DailyCashbook = () => {
  const [dateDraft, setDateDraft] = useState(() => todayIndiaISODate());
  const [appliedDate, setAppliedDate] = useState(() => todayIndiaISODate());
  const [breakdownTarget, setBreakdownTarget] = useState(null);
  const [counts, setCounts] = useState({});
  const [reasons, setReasons] = useState({});
  const [revisionTarget, setRevisionTarget] = useState(null);
  const queryClient = useQueryClient();

  const listParams = useMemo(() => ({ date: appliedDate }), [appliedDate]);

  const { data: res, isLoading, isFetching } = useQuery({
    queryKey: ['reports', 'daily-cashbook', listParams],
    queryFn: () => reportsApi.dailyCashbook(listParams),
  });

  const payload = res?.data;
  const accounts = useMemo(
    () => payload?.accounts ?? [],
    [payload?.accounts]
  );
  const summary = payload?.summary;
  const reportDate = payload?.date || appliedDate;

  const closeMutation = useMutation({
    mutationFn: ({ row, adminPassword = null }) =>
      syncService.submitOrQueueCashReconciliation(
        {
          payment_account_id: row.id,
          business_date: reportDate,
          counted_closing: Number(counts[row.id]),
          notes: null,
          revision_reason: row.close ? String(reasons[row.id] || '').trim() : null,
          admin_password: adminPassword,
          idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${row.id}`,
          expected_total_fingerprint: row.movement_fingerprint,
        },
        {
          label: row.name,
          requiresMasterPassword: Boolean(row.close),
        }
      ),
    onSuccess: async (result) => {
      toast.success(
        result?.queued ? 'Cash close queued for synchronization' : 'Cash counter reconciled'
      );
      setRevisionTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['reports', 'daily-cashbook'] });
    },
    onError: (error) => toast.error(error?.response?.data?.error?.message || 'Could not reconcile cash counter'),
  });

  const submitClose = (row) => {
    if (counts[row.id] === undefined || counts[row.id] === '') {
      toast.error('Enter the counted closing cash');
      return;
    }
    if (row.close) {
      if (!String(reasons[row.id] || '').trim()) {
        toast.error('Enter a revision reason');
        return;
      }
      setRevisionTarget(row);
      return;
    }
    closeMutation.mutate({ row });
  };

  const groupSummaryRows = useMemo(() => {
    const m = new Map();
    for (const a of accounts) {
      const key = normGroupLabel(a?.account_group);
      if (!m.has(key)) m.set(key, { group: key, income: 0, expense: 0, net: 0 });
      const cur = m.get(key);
      cur.income += Number(a?.income || 0);
      cur.expense += Number(a?.expense || 0);
    }
    const rows = Array.from(m.values()).map((r) => ({ ...r, net: r.income - r.expense }));
    rows.sort((x, y) => String(x.group).localeCompare(String(y.group)));
    return rows;
  }, [accounts]);

  const breadcrumbs = useMemo(
    () => [
      { label: 'Dashboard', to: '/' },
      { label: 'Daily cashbook', to: null },
    ],
    []
  );

  return (
    <div className="-mx-6 px-6 w-full min-w-0 max-w-none pb-6 text-xs text-gray-900 [&_.label]:text-xs [&_input]:text-xs [&_h1]:!text-base [&_h1]:!font-semibold">
      <PageHeader title="Daily cashbook" breadcrumbs={breadcrumbs} />

      <div className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="w-[11rem]">
          <Input
            label="Date"
            type="date"
            value={dateDraft}
            onChange={(e) => setDateDraft(e.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setAppliedDate(dateDraft)}
          disabled={isFetching || !dateDraft}
        >
          <Calendar className="h-3.5 w-3.5 mr-1 shrink-0" aria-hidden />
          Load
        </Button>
        {summary && !isLoading ? (
          <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
            <span>
              Day total income:{' '}
              <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(summary.income_total)}</span>
            </span>
            <span>
              Day total expense:{' '}
              <span className="font-semibold text-gray-900 tabular-nums">{formatCurrency(summary.expense_total)}</span>
            </span>
            <span>
              Net:{' '}
              <span className="font-semibold text-brand tabular-nums">{formatCurrency(summary.net)}</span>
            </span>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-gray-500 mb-3">
        Showing <span className="font-medium text-gray-700">{formatDate(reportDate)}</span> — payment accounts with
        activity for the day. Cash counters remain visible even with no movement so each floor can be closed independently.
      </p>

      {!isLoading && groupSummaryRows.length > 0 ? (
        <Card padded className="border border-gray-200 mb-4">
          <div className="text-xs font-semibold text-gray-900 mb-2">Account group summary</div>
          <div className="overflow-x-auto">
            <table className="table w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left">
                    <TableHeaderLabel>Group</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Income</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Expense</TableHeaderLabel>
                  </th>
                  <th className="text-right">
                    <TableHeaderLabel align="right">Net</TableHeaderLabel>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupSummaryRows.map((r) => (
                  <tr key={r.group} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-900 whitespace-nowrap">{r.group}</td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums">
                      {formatCurrency(r.income)}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums">
                      {formatCurrency(r.expense)}
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold tabular-nums text-brand">
                      {formatCurrency(r.net)}
                    </td>
                  </tr>
                ))}
                {summary ? (
                  <tr className="border-t border-gray-200">
                    <td className="py-2 pr-3 font-semibold text-gray-900 whitespace-nowrap">Total</td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums">
                      {formatCurrency(summary.income_total)}
                    </td>
                    <td className="py-2 px-3 text-right font-semibold tabular-nums">
                      {formatCurrency(summary.expense_total)}
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold tabular-nums text-brand">
                      {formatCurrency(summary.net)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} padded className="border border-gray-200">
                <Skeleton className="h-4 w-32 mb-3" />
                <Skeleton className="h-5 w-24 mb-2" />
                <Skeleton className="h-5 w-28" />
              </Card>
            ))
          : accounts.map((row) => (
              <Card key={row.id} padded className="border border-gray-200 flex flex-col min-h-[9.5rem]">
                <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2 mb-3">
                  <h3 className="text-sm font-semibold text-gray-900 truncate min-w-0">{row.name}</h3>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand hover:bg-brand-light"
                    title="View amount breakdown"
                    aria-label={`View breakdown for ${row.name}`}
                    onClick={() =>
                      setBreakdownTarget({
                        id: row.id,
                        name: row.name,
                        income: row.income,
                        expense: row.expense,
                      })
                    }
                  >
                    <Info size={14} aria-hidden />
                  </button>
                </div>
                <dl className="space-y-2 text-xs">
                  {row.account_type === 'cash' ? (
                    <>
                      <div className="flex justify-between gap-2">
                        <dt className="text-gray-600">Opening Cash</dt>
                        <dd className="font-semibold tabular-nums">{formatCurrency(row.opening_cash)}</dd>
                      </div>
                    </>
                  ) : null}
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">Income</dt>
                    <dd className="font-semibold text-gray-900 tabular-nums text-right">{formatCurrency(row.income)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-gray-600 shrink-0">Expense</dt>
                    <dd className="font-semibold text-gray-900 tabular-nums text-right">{formatCurrency(row.expense)}</dd>
                  </div>
                  {row.account_type === 'cash' ? (
                    <>
                      <div className="flex justify-between gap-2 border-t border-gray-100 pt-2">
                        <dt className="text-gray-600">Expected Closing</dt>
                        <dd className="font-semibold tabular-nums">{formatCurrency(row.expected_closing)}</dd>
                      </div>
                      {row.close ? (
                        <div className="rounded border border-gray-200 bg-gray-50 p-2">
                          <div className="flex justify-between gap-2">
                            <span>Counted</span>
                            <strong>{formatCurrency(row.close.counted_closing)}</strong>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Variance</span>
                            <strong className={Number(row.close.variance) ? 'text-red-600' : 'text-green-700'}>
                              {formatCurrency(row.close.variance)}
                            </strong>
                          </div>
                          <div className="mt-1 text-[10px] font-medium uppercase text-gray-500">
                            {row.close.status}{row.close.is_stale ? ' — transactions changed after close' : ''}
                          </div>
                        </div>
                      ) : null}
                      <Input
                        label={row.close ? 'Revised counted closing' : 'Counted closing'}
                        type="number"
                        step="0.01"
                        value={counts[row.id] ?? ''}
                        onChange={(event) => setCounts((current) => ({ ...current, [row.id]: event.target.value }))}
                      />
                      {row.close ? (
                        <Input
                          label="Revision reason"
                          value={reasons[row.id] ?? ''}
                          onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))}
                        />
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant={row.close ? 'secondary' : 'primary'}
                        loading={closeMutation.isPending && (!revisionTarget || revisionTarget.id === row.id)}
                        onClick={() => submitClose(row)}
                      >
                        {row.close ? 'Revise close' : 'Close counter'}
                      </Button>
                    </>
                  ) : null}
                </dl>
              </Card>
            ))}
      </div>

      {!isLoading && accounts.length === 0 ? (
        <p className="text-sm text-gray-500 mt-4">
          No payment account activity on {formatDate(reportDate)}.
        </p>
      ) : null}

      <DailyCashbookBreakdownModal
        isOpen={Boolean(breakdownTarget)}
        onClose={() => setBreakdownTarget(null)}
        accountId={breakdownTarget?.id}
        accountName={breakdownTarget?.name}
        date={reportDate}
        expectedIncome={breakdownTarget?.income}
        expectedExpense={breakdownTarget?.expense}
      />
      <AdminPasswordModal
        isOpen={Boolean(revisionTarget)}
        onClose={() => setRevisionTarget(null)}
        onConfirm={(password) => closeMutation.mutate({ row: revisionTarget, adminPassword: password })}
        title="Revise cash counter close"
        description="This preserves the previous close as an audit revision."
        itemLabel={revisionTarget?.name}
        loading={closeMutation.isPending}
        confirmLabel="Save revision"
      />
    </div>
  );
};

export default DailyCashbook;
