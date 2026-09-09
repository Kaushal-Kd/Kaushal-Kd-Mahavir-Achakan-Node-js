import { toLocalISODate } from '@wrs/shared/utils/date.js';

/** @param {number} value @param {number} fallback */
export function clampDashboardDays(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(1, n));
}

/**
 * Inclusive lookback ending today: N days => today-(N-1) … today
 * Mirrors apps/backend/src/modules/dashboard/dashboardSettings.js lookbackRange.
 * @param {number} days
 * @param {Date} [today]
 */
export function dashboardLookbackRange(days, today = new Date()) {
  const span = clampDashboardDays(days, 9);
  const toDate = new Date(today);
  toDate.setHours(0, 0, 0, 0);
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - (span - 1));
  return {
    from: toLocalISODate(fromDate),
    to: toLocalISODate(toDate),
    days: span,
  };
}

/**
 * Inclusive lookahead from today: N days => today … today+(N-1)
 * Mirrors apps/backend/src/modules/dashboard/dashboardSettings.js lookaheadRange.
 * @param {number} days
 * @param {Date} [today]
 */
export function dashboardLookaheadRange(days, today = new Date()) {
  const span = clampDashboardDays(days, 10);
  const fromDate = new Date(today);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + (span - 1));
  return {
    from: toLocalISODate(fromDate),
    to: toLocalISODate(toDate),
    days: span,
  };
}

/** @typedef {'item_to_collect'|'item_to_prepare'|'pending_delivery'|'pending_return'} DashboardListPreset */

/**
 * @param {DashboardListPreset} preset
 * @param {{
 *   itemToCollectDays?: number,
 *   itemToPrepareDays?: number,
 *   pendingDeliveryDays?: number,
 *   pendingReturnDays?: number,
 * }} settings
 */
export function computeDashboardDatePreset(preset, settings = {}) {
  switch (preset) {
    case 'item_to_collect': {
      const range = dashboardLookaheadRange(settings.itemToCollectDays ?? 10);
      return { from: range.from, to: range.to, days: range.days };
    }
    case 'item_to_prepare': {
      const range = dashboardLookaheadRange(settings.itemToPrepareDays ?? 10);
      return { from: range.from, to: range.to, days: range.days };
    }
    case 'pending_delivery': {
      const range = dashboardLookbackRange(settings.pendingDeliveryDays ?? 9);
      return { from: range.from, to: range.to, days: range.days, status: 'pending_delivery' };
    }
    case 'pending_return': {
      const range = dashboardLookbackRange(settings.pendingReturnDays ?? 12);
      return { from: range.from, to: range.to, days: range.days, status: 'pending_return' };
    }
    default:
      return { from: '', to: '' };
  }
}

/**
 * Build query string for list navigation from a preset.
 * @param {DashboardListPreset} preset
 * @param {Parameters<typeof computeDashboardDatePreset>[1]} settings
 */
export function dashboardPresetSearchParams(preset, settings) {
  const p = computeDashboardDatePreset(preset, settings);
  const params = new URLSearchParams();
  if (p.from) params.set('from', p.from);
  if (p.to) params.set('to', p.to);
  if (p.status) params.set('status', p.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
