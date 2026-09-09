export const DASHBOARD_SECTION_IDS = Object.freeze([
  'kpi',
  'ops_stats',
  'reminders',
  'custom_order_trials',
  'low_stock',
  'bookings_chart',
  'calendar',
  'booking_earning',
  'activity_logs',
]);

export const DEFAULT_DASHBOARD_SECTION_ORDER = [...DASHBOARD_SECTION_IDS];

const STORAGE_PREFIX = 'wrs.dashboard.sectionOrder';

/** @param {string|null|undefined} shopId */
export function dashboardSectionStorageKey(shopId) {
  const sid = String(shopId || '').trim();
  return sid ? `${STORAGE_PREFIX}.${sid}` : STORAGE_PREFIX;
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeOrder(raw) {
  const allowed = new Set(DASHBOARD_SECTION_IDS);
  const seen = new Set();
  const out = [];
  if (!Array.isArray(raw)) return [...DEFAULT_DASHBOARD_SECTION_ORDER];
  for (const id of raw) {
    const key = String(id || '').trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  for (const id of DASHBOARD_SECTION_IDS) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

/** @param {string|null|undefined} shopId */
export function loadDashboardSectionOrder(shopId) {
  if (typeof localStorage === 'undefined') {
    return [...DEFAULT_DASHBOARD_SECTION_ORDER];
  }
  try {
    const raw = localStorage.getItem(dashboardSectionStorageKey(shopId));
    if (!raw) return [...DEFAULT_DASHBOARD_SECTION_ORDER];
    return normalizeOrder(JSON.parse(raw));
  } catch {
    return [...DEFAULT_DASHBOARD_SECTION_ORDER];
  }
}

/**
 * @param {string|null|undefined} shopId
 * @param {string[]} order
 */
export function saveDashboardSectionOrder(shopId, order) {
  if (typeof localStorage === 'undefined') return;
  const normalized = normalizeOrder(order);
  try {
    localStorage.setItem(dashboardSectionStorageKey(shopId), JSON.stringify(normalized));
  } catch {
    /* quota / private mode */
  }
}

/**
 * @param {string} dragId
 * @param {string} targetId
 * @param {string[]} order
 * @returns {string[]}
 */
export function reorderDashboardSections(dragId, targetId, order) {
  const from = String(dragId || '').trim();
  const to = String(targetId || '').trim();
  if (!from || !to || from === to) return normalizeOrder(order);
  const list = normalizeOrder(order);
  const fromIdx = list.indexOf(from);
  const toIdx = list.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return list;
  const next = [...list];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, from);
  return next;
}

export const DASHBOARD_SECTION_LABELS = Object.freeze({
  kpi: 'Today KPIs',
  ops_stats: 'Operations stats',
  reminders: 'Reminders',
  custom_order_trials: 'Custom order trials',
  low_stock: 'Low stock accessories',
  bookings_chart: 'Bookings chart',
  calendar: 'Calendar',
  booking_earning: 'Booking earning',
  activity_logs: 'Activity logs',
});
