import { useQuery } from '@tanstack/react-query';
import {
  ACTIONS,
  formatCurrency,
  formatDateTime,
  hasPermission,
  MODULES,
} from '@wrs/shared';
import clsx from 'clsx';
import { CalendarCheck, ClipboardList, CreditCard, Undo2 } from 'lucide-react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

import { dashboardApi } from '../../lib/api/dashboard.js';
import { useAuthStore } from '../../stores/authStore.js';
import Card from '../ui/Card.jsx';
import Skeleton from '../ui/Skeleton.jsx';

const KIND_META = {
  order: { Icon: CalendarCheck, tone: 'text-brand' },
  payment: { Icon: CreditCard, tone: 'text-green-700' },
  return: { Icon: Undo2, tone: 'text-green-700' },
  system_log: { Icon: ClipboardList, tone: 'text-gray-700' },
};

function resolveActivityTarget(item) {
  if (!item) return null;
  const orderId = item.entity_id || item.id;
  if (
    orderId &&
    (item.kind === 'order' ||
      item.kind === 'payment' ||
      item.kind === 'return' ||
      (item.kind === 'system_log' && item.module === 'booking'))
  ) {
    return { path: `/booking/${orderId}` };
  }
  return null;
}

function ActivityRow({ item, onNavigate }) {
  const meta = KIND_META[item.kind] || KIND_META.system_log;
  const Icon = meta.Icon;
  const target = resolveActivityTarget(item);

  const body = (
    <>
      <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 bg-gray-100">
        <Icon size={16} className={meta.tone} aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{item.title}</div>
        {item.subtitle ? (
          <div className="text-[11px] text-gray-500 truncate">{item.subtitle}</div>
        ) : null}
        {item.amount != null && Number(item.amount) > 0 ? (
          <div className="text-[11px] font-medium text-gray-700 tabular-nums">
            {formatCurrency(item.amount)}
          </div>
        ) : null}
      </div>
      {item.at ? (
        <div className="text-[11px] text-gray-500 whitespace-nowrap shrink-0 tabular-nums">
          {formatDateTime(item.at)}
        </div>
      ) : null}
    </>
  );

  if (target && onNavigate) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(target.path)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        {body}
      </button>
    );
  }

  return <div className="flex items-center gap-2 px-3 py-2">{body}</div>;
}

ActivityRow.propTypes = {
  item: PropTypes.shape({
    kind: PropTypes.string,
    at: PropTypes.string,
    title: PropTypes.string,
    subtitle: PropTypes.string,
    amount: PropTypes.number,
    id: PropTypes.string,
    entity_id: PropTypes.string,
    module: PropTypes.string,
  }).isRequired,
  onNavigate: PropTypes.func,
};

export default function ActivityLogsCard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canViewAuditLogs = hasPermission(user, MODULES.AUDIT_LOGS, ACTIONS.VIEW);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => dashboardApi.activity({ limit: 25 }).then((r) => r.data),
    refetchOnMount: 'always',
  });

  const stream = Array.isArray(data?.stream)
    ? data.stream
    : Array.isArray(data)
      ? data
      : [];
  const shouldScroll = stream.length > 10;

  const handleNavigate = (path) => {
    if (path) navigate(path);
  };

  return (
    <Card padded>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Activity Logs</h3>
          <p className="text-xs text-gray-500 mt-0.5">Recent bookings, payments, and updates</p>
        </div>
        {canViewAuditLogs ? (
          <button
            type="button"
            onClick={() => navigate('/settings/system-logs')}
            className="text-xs font-medium text-brand hover:underline"
          >
            View all logs
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <div className="text-sm text-gray-500 py-6 text-center">Could not load activity logs.</div>
      ) : stream.length === 0 ? (
        <div className="text-sm text-gray-500 py-6 text-center">No recent activity.</div>
      ) : (
        <div
          className={clsx(
            'rounded-md border border-gray-200 divide-y divide-gray-100',
            shouldScroll && 'max-h-80 overflow-y-auto'
          )}
        >
          {stream.map((item, idx) => (
            <ActivityRow
              key={`${item.kind}-${item.at}-${item.id || idx}`}
              item={item}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
