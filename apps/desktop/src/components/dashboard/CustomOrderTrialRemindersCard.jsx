import {
  ACTIONS,
  CUSTOM_ORDER_STATUS_LABELS,
  formatDate,
  formatOrderTime12,
  hasPermission,
  MODULES,
} from '@wrs/shared';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';
import Card from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import {
  useCustomOrderMutations,
  useCustomOrderTrialReminders,
} from '../../hooks/api/useCustomOrders.js';
import { useAuthStore } from '../../stores/authStore.js';
import { toast } from '../../stores/uiStore.js';

const CELL = 'px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis align-middle';

const STATUS_TONE = {
  draft: 'gray',
  in_progress: 'brand',
  with_tailor: 'yellow',
  trial: 'brand',
  retrial: 'yellow',
  completed: 'green',
  cancelled: 'red',
};

function formatScheduled(date, time) {
  if (!date) return '—';
  const t = time ? formatOrderTime12(time) : '';
  return t ? `${formatDate(date)} ${t}` : formatDate(date);
}

const TRIAL_REMINDERS_QUERY_KEY = ['custom-orders', 'trial-reminders'];

export default function CustomOrderTrialRemindersCard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canEdit = hasPermission(user, MODULES.CUSTOM_ORDERS, ACTIONS.EDIT);
  const { data, isLoading, isError } = useCustomOrderTrialReminders();
  const { dismissTrialReminderMut } = useCustomOrderMutations();

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const overdueCount = Number(meta.overdue_count ?? rows.filter((r) => r.is_overdue).length);
  const upcomingCount = Math.max(0, rows.length - overdueCount);
  const shouldScroll = rows.length > 10;

  const summary = useMemo(() => {
    if (!rows.length) return null;
    const parts = [];
    if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
    if (upcomingCount > 0) parts.push(`${upcomingCount} upcoming`);
    return parts.join(' · ');
  }, [rows.length, overdueCount, upcomingCount]);

  const handleMarkComplete = (row, event) => {
    event.stopPropagation();
    dismissTrialReminderMut.mutate(row.id, {
      onSuccess: () => {
        queryClient.setQueryData(TRIAL_REMINDERS_QUERY_KEY, (old) => {
          if (!old?.data) return old;
          const nextData = old.data.filter((r) => r.id !== row.id);
          return {
            ...old,
            data: nextData,
            meta: {
              ...old.meta,
              total: nextData.length,
              overdue_count: nextData.filter((r) => r.is_overdue).length,
            },
          };
        });
        toast.success('Trial reminder marked complete');
      },
      onError: (err) =>
        toast.error(err?.response?.data?.error?.message || 'Could not mark reminder complete'),
    });
  };

  return (
    <Card padded>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Custom order trials</h3>
        {isLoading ? (
          <span className="text-xs text-gray-400">Loading…</span>
        ) : (
          <span className="text-xs text-gray-500">
            {summary ? (
              <>
                {overdueCount > 0 ? (
                  <span className="text-red-600 font-medium">{overdueCount} overdue</span>
                ) : null}
                {overdueCount > 0 && upcomingCount > 0 ? ' · ' : null}
                {upcomingCount > 0 ? <span>{upcomingCount} upcoming</span> : null}
              </>
            ) : (
              '0 scheduled'
            )}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : isError ? (
        <div className="text-sm text-gray-500 py-6 text-center">
          Could not load custom order trials.
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500 py-6 text-center">
          No trial or re-trial dates scheduled.
        </div>
      ) : (
        <div
          className={clsx(
            'rounded-md border border-gray-200 overflow-x-auto',
            shouldScroll && 'max-h-80 overflow-y-auto'
          )}
        >
          <table className="table w-full text-sm table-fixed min-w-[800px]">
            <thead className="sticky top-0 z-[1]">
              <tr>
                <th className={`text-left ${CELL} w-[12%]`}>
                  <TableHeaderLabel>Order no.</TableHeaderLabel>
                </th>
                <th className={`text-left ${CELL} w-[18%]`}>
                  <TableHeaderLabel>Customer</TableHeaderLabel>
                </th>
                <th className={`text-left ${CELL} w-[16%]`}>
                  <TableHeaderLabel>Status</TableHeaderLabel>
                </th>
                <th className={`text-left ${CELL} w-[10%]`}>
                  <TableHeaderLabel>Type</TableHeaderLabel>
                </th>
                <th className={`text-left ${CELL} w-[18%]`}>
                  <TableHeaderLabel>Scheduled</TableHeaderLabel>
                </th>
                {canEdit ? (
                  <th className={`text-center ${CELL} w-[16%]`}>
                    <TableHeaderLabel align="center">Actions</TableHeaderLabel>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => {
                const overdue = Boolean(row.is_overdue);
                const busy =
                  dismissTrialReminderMut.isPending &&
                  dismissTrialReminderMut.variables === row.id;
                return (
                  <tr
                    key={row.id}
                    className={clsx(
                      'cursor-pointer hover:bg-gray-50',
                      overdue && 'bg-red-50/80 hover:bg-red-50'
                    )}
                    onClick={() =>
                      navigate(`/custom-orders/${row.id}/edit`, { state: { viewOnly: true } })
                    }
                  >
                    <td
                      className={clsx(CELL, 'font-mono text-xs max-w-0', overdue && 'text-red-800')}
                      title={row.order_number || ''}
                    >
                      {row.order_number || '—'}
                    </td>
                    <td
                      className={clsx(CELL, 'font-medium text-gray-900 max-w-0')}
                      title={row.customer_name || ''}
                    >
                      {row.customer_name || '—'}
                    </td>
                    <td className={CELL}>
                      <Badge tone={STATUS_TONE[row.status] || 'gray'} className="whitespace-nowrap">
                        {CUSTOM_ORDER_STATUS_LABELS[row.status] || row.status}
                      </Badge>
                    </td>
                    <td className={clsx(CELL, 'text-gray-700')}>
                      {row.reminder_kind === 'retrial' ? 'Re-trial' : 'Trial'}
                    </td>
                    <td
                      className={clsx(
                        CELL,
                        'tabular-nums max-w-0',
                        overdue ? 'text-red-700 font-semibold' : 'text-gray-700'
                      )}
                      title={formatScheduled(row.reminder_date, row.reminder_time)}
                    >
                      {formatScheduled(row.reminder_date, row.reminder_time)}
                    </td>
                    {canEdit ? (
                      <td className={clsx(CELL, 'text-center')} onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={CheckCircle2}
                          loading={busy}
                          className="min-w-[7.5rem] px-2"
                          onClick={(e) => handleMarkComplete(row, e)}
                        >
                          Mark complete
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-right">
        <button
          type="button"
          className="text-xs font-medium text-brand hover:underline"
          onClick={() => navigate('/custom-orders')}
        >
          View all custom orders
        </button>
      </div>
    </Card>
  );
}
