import { round2 } from '@wrs/shared';

import knex from '../../db/knex.js';

const EXCLUDED_ORDER_STATUSES = ['draft', 'cancelled'];

/**
 * @param {string} shopId
 * @param {string} term
 * @returns {Promise<{ kind: 'none' } | { kind: 'ambiguous'; matches: Array<{ id: string; name: string; code: string }> } | { kind: 'one'; row: Record<string, unknown> }>}
 */
export async function resolveProductBySearch(shopId, term) {
  const q = String(term || '').trim();
  if (!q) return { kind: 'none' };

  const exact = await knex('products')
    .where({ shop_id: shopId, is_active: true, code: q })
    .select('id', 'name', 'code', 'qty', 'color', 'size', 'notes', 'main_image', 'purchase_price', 'price_sell')
    .first();

  if (exact) return { kind: 'one', row: exact };

  const like = `%${q}%`;
  const rows = await knex('products')
    .where({ shop_id: shopId, is_active: true })
    .where((b) => b.where('name', 'like', like).orWhere('code', 'like', like))
    .orderBy('name')
    .limit(21)
    .select('id', 'name', 'code', 'qty', 'color', 'size', 'notes', 'main_image', 'purchase_price', 'price_sell');

  if (rows.length === 0) return { kind: 'none' };
  if (rows.length > 1) {
    return {
      kind: 'ambiguous',
      matches: rows.slice(0, 20).map((r) => ({ id: r.id, name: r.name, code: r.code })),
    };
  }
  return { kind: 'one', row: rows[0] };
}

/**
 * @param {string} shopId
 * @param {string} productId
 */
export async function getActiveProductSummaryRow(shopId, productId) {
  return knex('products')
    .where({ shop_id: shopId, id: productId, is_active: true })
    .select('id', 'name', 'code', 'qty', 'color', 'size', 'notes', 'main_image', 'purchase_price', 'price_sell')
    .first();
}

/**
 * @param {string} shopId
 * @param {string} productId
 */
export async function aggregateProductHistoryStats(shopId, productId) {
  const row = await knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .andWhere('oi.product_id', productId)
    .andWhere('oi.type', 'rent')
    .andWhere('o.is_deleted', false)
    .whereNotIn('o.status', EXCLUDED_ORDER_STATUSES)
    .select(
      knex.raw('COALESCE(SUM(oi.price * oi.qty), 0) as total_rent'),
      knex.raw('COALESCE(SUM(oi.discount * oi.qty), 0) as total_discount'),
      knex.raw('COALESCE(SUM(oi.line_total), 0) as total_earning'),
      knex.raw('COUNT(DISTINCT o.id) as book_count')
    )
    .first();

  return {
    total_rent: round2(Number(row?.total_rent ?? 0)),
    total_discount: round2(Number(row?.total_discount ?? 0)),
    total_earning: round2(Number(row?.total_earning ?? 0)),
    book_count: Number(row?.book_count ?? 0),
  };
}

function mapProductForClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    qty: Number(row.qty ?? 0),
    color: row.color,
    size: row.size,
    remarks: row.notes,
    main_image: row.main_image,
    purchase_price: round2(Number(row.purchase_price ?? 0)),
    mrp: round2(Number(row.price_sell ?? 0)),
  };
}

/**
 * @param {string} shopId
 * @param {{ q?: string; product_id?: string }} query
 */
export async function getProductHistoryReport(shopId, query) {
  const { q, product_id: productId } = query;

  if (!productId && !q) {
    return { found: false };
  }

  let row = null;

  if (productId) {
    row = await getActiveProductSummaryRow(shopId, productId);
    if (!row) return { found: false };
  } else {
    const resolved = await resolveProductBySearch(shopId, q || '');
    if (resolved.kind === 'none') return { found: false };
    if (resolved.kind === 'ambiguous') {
      return { found: false, ambiguous: true, matches: resolved.matches };
    }
    row = resolved.row;
  }

  const stats = await aggregateProductHistoryStats(shopId, row.id);
  return {
    found: true,
    product: mapProductForClient(row),
    stats,
  };
}
