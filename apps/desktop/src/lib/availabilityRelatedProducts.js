import { productsApi } from './api/products.js';

/**
 * Dedupe related mapping rows; exclude the primary product.
 * @param {object[]} relatedList
 * @param {string} primaryProductId
 */
export function dedupeRelatedProducts(relatedList, primaryProductId) {
  const primaryId = String(primaryProductId || '').trim();
  const seen = new Set();
  const unique = [];
  for (const related of relatedList || []) {
    const relatedId = String(related.related_product_id || related.id || '').trim();
    if (!relatedId || relatedId === primaryId) continue;
    if (seen.has(relatedId)) continue;
    seen.add(relatedId);
    unique.push(related);
  }
  return unique;
}

/**
 * Product payload suitable for availability cart lines.
 * @param {object} related
 * @param {object|null} checkResult
 */
export function relatedToCartProduct(related, checkResult) {
  const fromCheck = checkResult?.product || {};
  const id = related.related_product_id || related.id || fromCheck.id;
  return {
    id,
    code: fromCheck.code || related.code,
    name: fromCheck.name || related.name,
    main_image: fromCheck.main_image || related.main_image || null,
    category_id: fromCheck.category_id || related.category_id || null,
    price_rent: Number(fromCheck.price_rent ?? related.price_rent ?? 0),
    price_sell: Number(fromCheck.price_sell ?? related.price_sell ?? 0),
    type: fromCheck.type || related.type,
    status: fromCheck.status || related.status,
  };
}

/**
 * Load linked products and check rent availability for the same window.
 * @param {object} opts
 * @param {string} opts.productId
 * @param {string} opts.from
 * @param {string} opts.to
 * @param {number} [opts.qty]
 * @returns {Promise<object[]>}
 */
export async function fetchRelatedProductAvailability(opts) {
  const { productId, from, to, qty = 1 } = opts;
  if (!productId || !from || !to) return [];

  let relatedList = [];
  try {
    // Full mapping (all linked products), not booking-only recommended/required subset.
    const relatedRes = await productsApi.getRelatedMapping(productId);
    relatedList = relatedRes?.data?.products || [];
  } catch {
    return [];
  }

  const unique = dedupeRelatedProducts(relatedList, productId);
  if (unique.length === 0) return [];

  const requestedQty = Math.max(1, Number(qty) || 1);

  return Promise.all(
    unique.map(async (related) => {
      const relatedId = String(related.related_product_id || '').trim();
      try {
        const res = await productsApi.checkAvailability({
          product_id: relatedId,
          from,
          to,
          qty: requestedQty,
        });
        const result = res?.data || res || null;
        return {
          related,
          result,
          error: null,
        };
      } catch (err) {
        return {
          related,
          result: null,
          error:
            err?.response?.data?.error?.message ||
            err?.response?.data?.message ||
            err?.message ||
            'Could not check availability',
        };
      }
    })
  );
}
