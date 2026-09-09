import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  computeDashboardDatePreset,
  dashboardPresetSearchParams,
} from '../lib/dashboardDateRanges.js';
import { isDrillToday } from '../lib/orderListDrillDown.js';
import { useAppSettings } from './useAppSettings.js';

const BUCKET_QUERY_KEYS = new Set(['today', 'upcoming', 'overdue']);

/** @typedef {import('../lib/dashboardDateRanges.js').DashboardListPreset} DashboardListPreset */

/**
 * @param {import('react-router-dom').URLSearchParams} searchParams
 */
export function urlHasExplicitDateFilters(searchParams) {
  return Boolean(searchParams.get('from') || searchParams.get('to'));
}

/**
 * @param {import('react-router-dom').URLSearchParams} searchParams
 */
export function urlHasBucketFilter(searchParams) {
  const bucket = searchParams.get('bucket') || '';
  return BUCKET_QUERY_KEYS.has(bucket);
}

/**
 * @param {import('react-router-dom').URLSearchParams} searchParams
 */
export function urlHasExplicitStatus(searchParams) {
  return Boolean(String(searchParams.get('status') || '').trim());
}

/**
 * Read dashboard app-settings and compute date/status presets for ops-stat list pages.
 * @param {DashboardListPreset} preset
 */
export function useDashboardListDateDefaults(preset) {
  const [searchParams] = useSearchParams();
  const appSettings = useAppSettings();

  const settings = useMemo(
    () => ({
      itemToCollectDays: appSettings.getNumber('DASHBOARD_ITEM_TO_COLLECT_DAYS', 10),
      itemToPrepareDays: appSettings.getNumber('DASHBOARD_ITEM_TO_PREPARE_DAYS', 10),
      pendingDeliveryDays: appSettings.getNumber('DASHBOARD_PENDING_DELIVERY_DAYS', 9),
      pendingReturnDays: appSettings.getNumber('DASHBOARD_PENDING_RETURN_DAYS', 12),
    }),
    [appSettings.map]
  );

  const computed = useMemo(
    () => computeDashboardDatePreset(preset, settings),
    [preset, settings]
  );

  const skipDefaults =
    urlHasExplicitDateFilters(searchParams) ||
    urlHasBucketFilter(searchParams) ||
    isDrillToday(searchParams);

  const skipStatusDefault = urlHasExplicitStatus(searchParams);

  const shouldApplyDates = !appSettings.isLoading && !skipDefaults;
  const shouldApplyStatus =
    !appSettings.isLoading &&
    !skipStatusDefault &&
    Boolean(computed.status);

  return {
    preset,
    ready: !appSettings.isLoading,
    skipDefaults,
    shouldApplyDates,
    shouldApplyStatus,
    from: computed.from || '',
    to: computed.to || '',
    status: computed.status || '',
    settings,
    searchParamsPath: dashboardPresetSearchParams(preset, settings),
  };
}

/**
 * Apply dashboard preset dates/status once when settings load and URL has no explicit filters.
 * @param {{
 *   preset: DashboardListPreset,
 *   setDateFrom: (v: string) => void,
 *   setDateTo: (v: string) => void,
 *   setStatus?: (v: string) => void,
 *   syncUrl?: boolean,
 * }} opts
 */
export function useApplyDashboardListDateFilters(opts) {
  const { preset, setDateFrom, setDateTo, setStatus, syncUrl = false } = opts;
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = useDashboardListDateDefaults(preset);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!defaults.ready) return;
    if (appliedRef.current) return;
    appliedRef.current = true;

    if (!defaults.shouldApplyDates && !defaults.shouldApplyStatus) return;

    if (defaults.shouldApplyDates) {
      setDateFrom(defaults.from);
      setDateTo(defaults.to);
    }
    if (defaults.shouldApplyStatus && setStatus) {
      setStatus(defaults.status);
    }

    if (
      syncUrl &&
      (defaults.shouldApplyDates || (defaults.shouldApplyStatus && defaults.status))
    ) {
      const next = new URLSearchParams(searchParams);
      if (defaults.shouldApplyDates) {
        next.set('from', defaults.from);
        next.set('to', defaults.to);
      }
      if (defaults.shouldApplyStatus && defaults.status) {
        next.set('status', defaults.status);
      }
      setSearchParams(next, { replace: true });
    }
  }, [
    defaults.ready,
    defaults.skipDefaults,
    defaults.shouldApplyDates,
    defaults.shouldApplyStatus,
    defaults.from,
    defaults.to,
    defaults.status,
    preset,
    setDateFrom,
    setDateTo,
    setStatus,
    syncUrl,
    searchParams,
    setSearchParams,
  ]);
}

export default useDashboardListDateDefaults;
