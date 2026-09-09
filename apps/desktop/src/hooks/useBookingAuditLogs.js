import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { summarizeBookingAuditLogs } from '../lib/bookingAuditSummary.js';
import { systemLogsApi } from '../lib/api/systemLogs.js';

/**
 * @param {string|null|undefined} orderId
 * @param {{ enabled?: boolean }} [options]
 */
export function useBookingAuditLogs(orderId, options = {}) {
  const enabled = Boolean(options.enabled && orderId);

  const query = useQuery({
    queryKey: ['system-logs', 'booking', 'audit-summary', orderId],
    queryFn: () =>
      systemLogsApi.list({
        module: 'booking',
        entity_id: orderId,
        per_page: 100,
        page: 1,
      }),
    enabled,
    staleTime: 60_000,
  });

  const rows = query.data?.data || [];
  const summary = useMemo(() => summarizeBookingAuditLogs(rows), [rows]);

  return {
    rows,
    summary,
    meta: query.data?.meta,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}
