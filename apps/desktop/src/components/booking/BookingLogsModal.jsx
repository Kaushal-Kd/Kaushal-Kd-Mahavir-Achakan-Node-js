import { useQuery } from '@tanstack/react-query';
import PropTypes from 'prop-types';
import { useEffect, useMemo, useState } from 'react';

import AuditChangeLogGroups from '../audit/AuditChangeLogGroups.jsx';
import {
  enrichChangeRowsWithOrderLineNames,
  flattenSystemLogsToChangeRows,
  groupChangeRowsByLog,
  logNeedsChangeDetailFetch,
} from '../../lib/bookingAuditSummary.js';
import { ordersApi } from '../../lib/api/orders.js';
import { salesApi } from '../../lib/api/sales.js';
import { systemLogsApi } from '../../lib/api/systemLogs.js';
import { toast } from '../../stores/uiStore.js';
import Modal from '../ui/Modal.jsx';

async function enrichLogsWithDetails(logs) {
  const needsFetch = (logs || []).filter(logNeedsChangeDetailFetch);
  if (!needsFetch.length) return logs;

  const detailById = new Map();
  await Promise.all(
    needsFetch.map(async (log) => {
      try {
        const res = await systemLogsApi.get(log.id);
        if (res?.data) detailById.set(String(log.id), res.data);
      } catch {
        /* keep list row */
      }
    })
  );

  return (logs || []).map((log) => detailById.get(String(log.id)) || log);
}

const BookingLogsModal = ({ isOpen, onClose, orderId, billNo, module = 'booking', entityLabel }) => {
  const [enrichedLogs, setEnrichedLogs] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const kind = module === 'sale' ? 'sale' : 'booking';
  const label = entityLabel || kind;

  const { data: res, isLoading, isError } = useQuery({
    queryKey: ['system-logs', kind, orderId],
    queryFn: () =>
      systemLogsApi.list({
        module: kind,
        entity_id: orderId,
        per_page: 100,
        page: 1,
      }),
    enabled: isOpen && Boolean(orderId),
  });

  const orderQuery = useQuery({
    queryKey: [kind, orderId, 'logs-lines'],
    queryFn: () =>
      kind === 'sale'
        ? salesApi.get(orderId).then((r) => r.data)
        : ordersApi.get(orderId).then((r) => r.data),
    enabled: isOpen && Boolean(orderId),
    staleTime: 60_000,
  });

  const listLogs = res?.data;

  useEffect(() => {
    if (!isOpen) {
      setEnrichedLogs([]);
      setDetailLoading(false);
      return;
    }
    if (!listLogs?.length) {
      setEnrichedLogs([]);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    enrichLogsWithDetails(listLogs)
      .then((logs) => {
        if (!cancelled) setEnrichedLogs(logs);
      })
      .catch(() => {
        if (!cancelled) setEnrichedLogs(listLogs);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, listLogs]);

  useEffect(() => {
    if (isOpen && isError) {
      toast.error(`Could not load ${label} logs`);
    }
  }, [isOpen, isError, label]);

  const flatRows = useMemo(() => {
    const base = flattenSystemLogsToChangeRows(enrichedLogs.length ? enrichedLogs : listLogs || []);
    const lineSource =
      kind === 'sale'
        ? { items: orderQuery.data?.items || [], accessories: [] }
        : orderQuery.data;
    return enrichChangeRowsWithOrderLineNames(base, lineSource);
  }, [enrichedLogs, listLogs, orderQuery.data, kind]);

  const logGroups = useMemo(() => groupChangeRowsByLog(flatRows), [flatRows]);

  const title = billNo ? `Logs — ${billNo}` : `${label.charAt(0).toUpperCase()}${label.slice(1)} logs`;
  const loading = isLoading || detailLoading || orderQuery.isLoading;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="3xl">
      <AuditChangeLogGroups
        groups={logGroups}
        loading={loading}
        emptyTitle={`No audit entries for this ${label} yet`}
        emptyMessage={
          kind === 'sale'
            ? 'Changes appear here after create, edit, payments, or cancel.'
            : 'Changes appear here after create, edit, stage updates, or cancel.'
        }
        scrollClassName="max-h-[min(72vh,680px)]"
      />
    </Modal>
  );
};

BookingLogsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  orderId: PropTypes.string,
  billNo: PropTypes.string,
  module: PropTypes.string,
  entityLabel: PropTypes.string,
};

BookingLogsModal.defaultProps = {
  orderId: null,
  billNo: null,
  module: 'booking',
  entityLabel: null,
};

export default BookingLogsModal;
