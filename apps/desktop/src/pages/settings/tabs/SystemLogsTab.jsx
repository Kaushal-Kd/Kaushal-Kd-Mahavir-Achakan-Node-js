import { useQuery } from '@tanstack/react-query';
import { ACTIONS, MODULES, SYSTEM_LOG_MODULES, hasPermission } from '@wrs/shared';
import { Download, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';

import AuditChangeLogGroups from '../../../components/audit/AuditChangeLogGroups.jsx';
import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import Select from '../../../components/ui/Select.jsx';
import { useDataTableColumns } from '../../../hooks/useDataTableColumns.js';
import {
  flattenSystemLogsToChangeRows,
  groupChangeRowsByLog,
  logNeedsChangeDetailFetch,
} from '../../../lib/bookingAuditSummary.js';
import { systemLogsApi } from '../../../lib/api/systemLogs.js';
import {
  EXPORT_PER_PAGE,
  FLAT_CHANGES_EXPORT_COLUMNS,
  SUMMARY_EXPORT_COLUMNS,
  buildSummaryExportRows,
  flattenChangesForExport,
  getDefaultSystemLogDateRange,
} from '../../../lib/systemLogExport.js';
import { runTablePdfExport } from '../../../lib/reportPdfExport.js';
import { useAuthStore } from '../../../stores/authStore.js';
import { toast } from '../../../stores/uiStore.js';

import { DEFAULT_TABLE_PER_PAGE } from '../../../lib/tablePerPage.js';

import Tab from './_Tab.jsx';

const MODULE_FILTER_OPTIONS = [
  { value: '', label: 'All modules' },
  ...SYSTEM_LOG_MODULES.map((m) => ({ value: m.value, label: m.label })),
];

const DEFAULT_RANGE = getDefaultSystemLogDateRange();

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

const SystemLogsTab = () => {
  const user = useAuthStore((s) => s.user);
  const canView = hasPermission(user, MODULES.AUDIT_LOGS, ACTIONS.VIEW);

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('booking');
  const [dateFrom, setDateFrom] = useState(DEFAULT_RANGE.from);
  const [dateTo, setDateTo] = useState(DEFAULT_RANGE.to);
  const [useDate, setUseDate] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_TABLE_PER_PAGE);
  const [exportBusy, setExportBusy] = useState(false);
  const [enrichedLogs, setEnrichedLogs] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const listParams = useMemo(
    () => ({
      page,
      per_page: perPage,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(useDate && dateFrom ? { from: dateFrom, use_date: true } : {}),
      ...(useDate && dateTo ? { to: dateTo, use_date: true } : {}),
    }),
    [page, perPage, search, moduleFilter, useDate, dateFrom, dateTo]
  );

  const exportListParams = useMemo(
    () => ({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(useDate && dateFrom ? { from: dateFrom, use_date: true } : {}),
      ...(useDate && dateTo ? { to: dateTo, use_date: true } : {}),
    }),
    [search, moduleFilter, useDate, dateFrom, dateTo]
  );

  const { data: res, isLoading, isFetching } = useQuery({
    queryKey: ['system-logs', listParams],
    queryFn: () => systemLogsApi.list(listParams),
    enabled: canView,
    keepPreviousData: true,
  });

  const listLogs = res?.data;
  const meta = res?.meta;
  const totalPages = meta?.total_pages || 1;

  useEffect(() => {
    if (!canView || !listLogs?.length) {
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
  }, [canView, listLogs]);

  const flatRows = useMemo(
    () => flattenSystemLogsToChangeRows(enrichedLogs.length ? enrichedLogs : listLogs || []),
    [enrichedLogs, listLogs]
  );

  const logGroups = useMemo(() => groupChangeRowsByLog(flatRows), [flatRows]);

  const fetchAllFilteredLogs = useCallback(async () => {
    let p = 1;
    const acc = [];
    let pages = 1;
    do {
      const resPage = await systemLogsApi.list({
        ...exportListParams,
        page: p,
        per_page: EXPORT_PER_PAGE,
      });
      acc.push(...(resPage?.data || []));
      pages = Number(resPage?.meta?.total_pages) || 1;
      p += 1;
    } while (p <= pages);
    return enrichLogsWithDetails(acc);
  }, [exportListParams]);

  const runExport = useCallback(
    async (mode) => {
      setExportBusy(true);
      try {
        const logs = await fetchAllFilteredLogs();
        if (!logs.length) {
          toast.warning('No logs to export for the current filters');
          return;
        }

        const stamp = useDate ? `${dateFrom || 'all'}_${dateTo || 'all'}` : 'all_dates';
        const subtitleParts = [];
        if (useDate) subtitleParts.push(`Date ${dateFrom || '—'} to ${dateTo || '—'}`);
        if (search.trim()) subtitleParts.push(`Search: ${search.trim()}`);
        if (moduleFilter) {
          const modLabel = MODULE_FILTER_OPTIONS.find((o) => o.value === moduleFilter)?.label;
          if (modLabel) subtitleParts.push(`Module: ${modLabel}`);
        }

        if (mode === 'summary') {
          await runTablePdfExport({
            filename: `system_logs_${stamp}.pdf`,
            title: 'System Logs',
            subtitle: [...subtitleParts, `${logs.length} log record(s)`].join(' · '),
            columns: SUMMARY_EXPORT_COLUMNS,
            rows: buildSummaryExportRows(logs),
          });
          return;
        }

        const changeRows = flattenChangesForExport(logs);
        if (!changeRows.length) {
          toast.warning('No changes in the selected range to export');
          return;
        }
        await runTablePdfExport({
          filename: `system_logs_changes_${stamp}.pdf`,
          title: 'System Logs — All Changes',
          subtitle: [...subtitleParts, `${changeRows.length} change line(s)`].join(' · '),
          columns: FLAT_CHANGES_EXPORT_COLUMNS,
          rows: changeRows,
        });
      } catch (e) {
        toast.error(e?.response?.data?.error?.message || 'Could not export logs');
      } finally {
        setExportBusy(false);
      }
    },
    [fetchAllFilteredLogs, useDate, dateFrom, dateTo, search, moduleFilter]
  );

  if (!canView) {
    return <Navigate to="/settings/shops" replace />;
  }

  const applySearch = () => {
    setSearch(searchDraft);
    setPage(1);
  };

  const tableLoading = isLoading || isFetching || detailLoading;

  return (
    <Tab
      title="System Logs"
      description="All bill and product changes in one view. Default range is the last 7 days; export PDF for customer review (beta)."
      contentClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="card p-3 mb-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex w-full min-w-[240px] items-end gap-1 md:w-[32rem] md:max-w-[45vw]">
            <Input
              label="Search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch()}
              placeholder="Search…"
            />
            <Button type="button" variant="secondary" icon={Search} onClick={applySearch} className="mb-0.5">
              Search
            </Button>
          </div>
          <div className="w-44">
            <Select
              label="Module"
              value={moduleFilter}
              onChange={(e) => {
                setModuleFilter(e.target.value);
                setPage(1);
              }}
              options={MODULE_FILTER_OPTIONS}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-36">
              <Input
                label="From"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                disabled={!useDate}
              />
            </div>
            <div className="w-36">
              <Input
                label="To"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                disabled={!useDate}
              />
            </div>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={useDate}
                onChange={(e) => {
                  setUseDate(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-gray-300 text-brand focus:ring-brand"
              />
              Filter date range
            </label>
          </div>
          <div className="flex flex-wrap gap-2 pb-0.5 ml-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Download}
              disabled={exportBusy || isLoading}
              onClick={() => runExport('summary')}
            >
              Export logs PDF
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Download}
              disabled={exportBusy || isLoading}
              onClick={() => runExport('changes')}
              title="One row per bill or product change with date and time (PDF)"
            >
              Export changes PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="card p-3 overflow-hidden flex-1 min-h-0 flex flex-col">
        <AuditChangeLogGroups
          groups={logGroups}
          loading={tableLoading}
          emptyTitle="No system logs"
          emptyMessage="Actions will appear here when bookings, sales, and other records change."
          scrollClassName="max-h-[calc(100vh-320px)]"
        />
        {meta?.total ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2 border-t border-gray-100 text-xs text-gray-500">
            <span>
              {flatRows.length} change(s) from page {meta.page ?? page} · {meta.total ?? 0} log record(s)
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page <= 1 || tableLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous logs
              </Button>
              <span>
                Page {meta.page ?? page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={page >= totalPages || tableLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next logs
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Tab>
  );
};

export default SystemLogsTab;
