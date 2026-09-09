import { getNumberSetting } from '@wrs/shared';

import knex from '../../db/knex.js';

const DASHBOARD_SETTING_KEYS = [
  'DASHBOARD_PENDING_DELIVERY_DAYS',
  'DASHBOARD_PENDING_RETURN_DAYS',
  'DASHBOARD_ITEM_TO_COLLECT_DAYS',
  'DASHBOARD_ITEM_TO_PREPARE_DAYS',
];

export function clampDashboardDays(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(1, n));
}

export function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Inclusive lookback ending today: N days => today-(N-1) … today */
export function lookbackRange(today, days) {
  const span = clampDashboardDays(days, 9);
  const toDate = new Date(today);
  toDate.setHours(0, 0, 0, 0);
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - (span - 1));
  return {
    from: toLocalIsoDate(fromDate),
    to: toLocalIsoDate(toDate),
    days: span,
  };
}

/** Inclusive lookahead from today: N days => today … today+(N-1) */
export function lookaheadRange(today, days) {
  const span = clampDashboardDays(days, 10);
  const fromDate = new Date(today);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + (span - 1));
  return {
    from: toLocalIsoDate(fromDate),
    to: toLocalIsoDate(toDate),
    days: span,
  };
}

const DASHBOARD_SETTINGS_TTL_MS = 60_000;
/** @type {Map<string, { data: object, expiresAt: number }>} */
const dashboardSettingsCache = new Map();

export function invalidateDashboardDaySettingsCache(shopId) {
  if (shopId) dashboardSettingsCache.delete(String(shopId));
  else dashboardSettingsCache.clear();
}

async function loadDashboardDaySettingsFromDb(shopId) {
  const rows = await knex('settings')
    .where({ shop_id: shopId })
    .whereIn('key', DASHBOARD_SETTING_KEYS);
  const storedMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    pendingDeliveryDays: clampDashboardDays(
      getNumberSetting(storedMap, 'DASHBOARD_PENDING_DELIVERY_DAYS', 9),
      9
    ),
    pendingReturnDays: clampDashboardDays(
      getNumberSetting(storedMap, 'DASHBOARD_PENDING_RETURN_DAYS', 12),
      12
    ),
    itemToCollectDays: clampDashboardDays(
      getNumberSetting(storedMap, 'DASHBOARD_ITEM_TO_COLLECT_DAYS', 10),
      10
    ),
    itemToPrepareDays: clampDashboardDays(
      getNumberSetting(storedMap, 'DASHBOARD_ITEM_TO_PREPARE_DAYS', 10),
      10
    ),
  };
}

export async function loadDashboardDaySettings(shopId) {
  const key = String(shopId);
  const now = Date.now();
  const hit = dashboardSettingsCache.get(key);
  if (hit && hit.expiresAt > now) return hit.data;

  const data = await loadDashboardDaySettingsFromDb(shopId);
  dashboardSettingsCache.set(key, { data, expiresAt: now + DASHBOARD_SETTINGS_TTL_MS });
  return data;
}
