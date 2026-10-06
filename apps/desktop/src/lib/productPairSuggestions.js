import { normalizeProductCode } from '@wrs/shared';
import { mapWithConcurrency } from './mapWithConcurrency.js';

/**
 * Strong matches whose related/pair mapping should be looked up.
 * Exact code hits first; otherwise code prefixes; otherwise the top ranked row.
 * @param {object[]} matches
 * @param {string} search
 * @param {{ limit?: number }} [options]
 */
export function pickProductsForPairLookup(matches, search, options = {}) {
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) return [];
  const cap = Math.max(1, Number(options.limit) || 3);
  const q = String(search || '').trim();
  if (!q) return list.slice(0, cap);

  const qRaw = q.toLowerCase();
  const qNorm = normalizeProductCode(q).toLowerCase();

  const exact = list.filter((p) => productCodeEqualsSearch(p?.code, qRaw, qNorm));
  if (exact.length) return exact.slice(0, cap);

  const prefix = list.filter((p) => productCodeStartsWithSearch(p?.code, qRaw, qNorm));
  if (prefix.length) return prefix.slice(0, cap);

  return list.slice(0, 1);
}

/**
 * Insert pair rows immediately after the matched product they belong to.
 * Skips ids already present in `matches`.
 * @param {object[]} matches
 * @param {Map<string, object[]>|Record<string, object[]>} pairRowsByPrimaryId
 */
export function mergePairSuggestions(matches, pairRowsByPrimaryId) {
  const list = Array.isArray(matches) ? matches : [];
  const lookup = pairRowsByPrimaryId instanceof Map ? pairRowsByPrimaryId : new Map();
  if (!(pairRowsByPrimaryId instanceof Map) && pairRowsByPrimaryId && typeof pairRowsByPrimaryId === 'object') {
    for (const [key, value] of Object.entries(pairRowsByPrimaryId)) {
      lookup.set(String(key), value);
    }
  }

  const seen = new Set(list.map((row) => String(row?.id || '')).filter(Boolean));
  const out = [];
  for (const match of list) {
    out.push(match);
    const matchId = String(match?.id || '');
    const pairs = lookup.get(matchId) || [];
    for (const pair of pairs) {
      const id = String(pair?.id || pair?.related_product_id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(pair);
    }
  }
  return out;
}

/**
 * Catalog row for a related/pair product in a code-search dropdown.
 * @param {object} related
 * @param {object|null} availability
 * @param {object} primary
 */
export function relatedToSuggestionRow(related, availability, primary) {
  const id = related?.related_product_id || related?.id || availability?.id;
  return {
    ...(availability || {}),
    id,
    code: availability?.code || related?.code,
    name: availability?.name || related?.name,
    main_image: availability?.main_image || related?.main_image || null,
    category_id: availability?.category_id || related?.category_id || null,
    type: availability?.type || related?.type,
    price_rent: Number(availability?.price_rent ?? related?.price_rent ?? 0),
    price_sell: Number(availability?.price_sell ?? related?.price_sell ?? 0),
    suggested_as_pair: true,
    pair_of_product_id: primary?.id || null,
    pair_of_code: primary?.code || '',
    is_recommended: !!related?.is_recommended,
    is_required: !!related?.is_required,
  };
}

/**
 * Load related (pair) products for strong search matches and merge them into the list.
 * When `availability` is set, pair rows include booking stock/free qty.
 * @param {object} opts
 * @param {object[]} opts.matches
 * @param {string} [opts.search]
 * @param {boolean} [opts.forBooking]
 * @param {{ from: string, to: string, qty?: number, excludeOrderId?: string }} [opts.availability]
 * @param {(id: string, params?: object) => Promise<object>} [opts.getRelatedMapping]
 * @param {(params: object) => Promise<object>} [opts.bookingAvailability]
 * @param {number} [opts.concurrency]
 */
export async function loadPairSuggestionsForMatches(opts) {
  const matches = Array.isArray(opts?.matches) ? opts.matches : [];
  const search = String(opts?.search || '');
  const forBooking = opts?.forBooking !== false;
  const availability = opts?.availability || null;
  const getRelatedMapping = opts?.getRelatedMapping || defaultGetRelatedMapping;
  const bookingAvailability = opts?.bookingAvailability || defaultBookingAvailability;
  const concurrency = Math.max(1, Number(opts?.concurrency) || 3);

  const primaries = pickProductsForPairLookup(matches, search);
  if (!primaries.length) return matches;

  const relatedByPrimary = new Map();
  await mapWithConcurrency(primaries, concurrency, async (primary) => {
    try {
      const res = await getRelatedMapping(primary.id, forBooking ? { for_booking: 1 } : undefined);
      const list = res?.data?.products || [];
      relatedByPrimary.set(String(primary.id), uniqueRelatedForPrimary(list, primary.id));
    } catch {
      relatedByPrimary.set(String(primary.id), []);
    }
  });

  const existingIds = new Set(matches.map((row) => String(row?.id || '')).filter(Boolean));
  const missingIds = [];
  for (const primary of primaries) {
    for (const related of relatedByPrimary.get(String(primary.id)) || []) {
      const id = String(related.related_product_id || related.id || '').trim();
      if (!id || existingIds.has(id) || missingIds.includes(id)) continue;
      missingIds.push(id);
    }
  }

  const availById = new Map();
  if (availability?.from && availability?.to && missingIds.length) {
    try {
      const res = await bookingAvailability({
        product_ids: missingIds.join(','),
        from: availability.from,
        to: availability.to,
        qty: Math.max(1, Number(availability.qty) || 1),
        per_page: Math.max(missingIds.length, 1),
        ...(availability.excludeOrderId ? { exclude_order_id: availability.excludeOrderId } : {}),
      });
      for (const row of res?.data || []) {
        if (row?.id) availById.set(String(row.id), row);
      }
    } catch {
      // Keep mapping-only pair rows when availability lookup fails.
    }
  }

  const pairRowsByPrimaryId = new Map();
  for (const primary of primaries) {
    const rows = [];
    for (const related of relatedByPrimary.get(String(primary.id)) || []) {
      const id = String(related.related_product_id || related.id || '').trim();
      if (!id || existingIds.has(id)) continue;
      rows.push(relatedToSuggestionRow(related, availById.get(id) || null, primary));
    }
    if (rows.length) pairRowsByPrimaryId.set(String(primary.id), rows);
  }

  return mergePairSuggestions(matches, pairRowsByPrimaryId);
}

function uniqueRelatedForPrimary(relatedList, primaryProductId) {
  const primaryId = String(primaryProductId || '').trim();
  const seen = new Set();
  const unique = [];
  for (const related of relatedList || []) {
    const relatedId = String(related.related_product_id || related.id || '').trim();
    if (!relatedId || relatedId === primaryId || seen.has(relatedId)) continue;
    seen.add(relatedId);
    unique.push(related);
  }
  return unique;
}

async function defaultGetRelatedMapping(id, params) {
  const { productsApi } = await import('./api/products.js');
  return productsApi.getRelatedMapping(id, params);
}

async function defaultBookingAvailability(params) {
  const { productsApi } = await import('./api/products.js');
  return productsApi.bookingAvailability(params);
}

function productCodeEqualsSearch(code, qRaw, qNorm) {
  const value = String(code || '').trim();
  if (!value) return false;
  return value.toLowerCase() === qRaw || normalizeProductCode(value).toLowerCase() === qNorm;
}

function productCodeStartsWithSearch(code, qRaw, qNorm) {
  const value = String(code || '').trim();
  if (!value) return false;
  const raw = value.toLowerCase();
  const norm = normalizeProductCode(value).toLowerCase();
  return raw.startsWith(qRaw) || norm.startsWith(qNorm);
}
