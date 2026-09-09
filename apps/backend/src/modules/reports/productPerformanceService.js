import { round2 } from '@wrs/shared';

import knex from '../../db/knex.js';

const EXCLUDED_ORDER_STATUSES = ['draft', 'cancelled'];

const SORT_BY_KEYS = new Set([
  'total_earning',
  'total_rent',
  'booked_qty',
  'sale_qty',
  'total_discount',
  'stock',
  'mrp',
  'rent_price',
  'code',
  'product_name',
  'category_name',
]);

/** @param {string} sortBy @param {'asc'|'desc'} sortDir */
function orderClauseForSort(sortBy, sortDir) {
  const dir = sortDir === 'asc' ? 'asc' : 'desc';
  switch (sortBy) {
    case 'code':
      return [{ column: 'p.code', order: dir }];
    case 'product_name':
      return [{ column: 'p.name', order: dir }];
    case 'category_name':
      return [{ column: 'c.label', order: dir }];
    case 'stock':
      return [{ column: 'p.qty', order: dir }];
    case 'mrp':
      return [{ column: 'p.price_sell', order: dir }];
    case 'rent_price':
      return [{ column: 'p.price_rent', order: dir }];
    case 'booked_qty':
      return [{ column: knex.raw('COALESCE(oa.booked_qty, 0)'), order: dir }];
    case 'total_rent':
      return [{ column: knex.raw('COALESCE(oa.total_rent, 0)'), order: dir }];
    case 'total_discount':
      return [{ column: knex.raw('COALESCE(oa.total_discount, 0)'), order: dir }];
    case 'sale_qty':
      return [{ column: knex.raw('COALESCE(oa.sale_qty, 0)'), order: dir }];
    case 'total_earning':
    default:
      return [{ column: knex.raw('COALESCE(oa.total_earning, 0)'), order: dir }];
  }
}

/**
 * @param {string} shopId
 * @param {{ from: string; to: string }} range
 * @param {{ page: number; per_page: number; category_id?: string; search?: string; sort_by?: string; sort_dir?: string }} query
 */
export async function getProductPerformanceReport(shopId, range, query) {
  const { from, to } = range;
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(200, Math.max(1, Number(query.per_page) || 50));

  const orderAgg = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .andWhere('o.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .whereNotIn('o.status', EXCLUDED_ORDER_STATUSES)
    .whereBetween('o.booking_date', [from, to])
    .whereNotNull('oi.product_id')
    .groupBy('oi.product_id')
    .select(
      'oi.product_id',
      knex.raw(
        "COALESCE(SUM(CASE WHEN oi.type = 'rent' THEN oi.qty ELSE 0 END), 0) as booked_qty"
      ),
      knex.raw(
        "COALESCE(SUM(CASE WHEN oi.type = 'rent' THEN oi.price * oi.qty ELSE 0 END), 0) as total_rent"
      ),
      knex.raw(
        "COALESCE(SUM(CASE WHEN oi.type = 'rent' THEN oi.discount * oi.qty ELSE 0 END), 0) as total_discount"
      ),
      knex.raw("COALESCE(SUM(CASE WHEN oi.type = 'sell' THEN oi.qty ELSE 0 END), 0) as sale_qty"),
      knex.raw('COALESCE(SUM(oi.line_total), 0) as total_earning')
    );

  const base = knex('products as p')
    .leftJoin('categories as c', (j) => {
      j.on('c.id', 'p.category_id').andOn(knex.raw("c.category_type = 'product'"));
    })
    .leftJoin(orderAgg.as('oa'), 'oa.product_id', 'p.id')
    .where('p.shop_id', shopId)
    .andWhere('p.is_active', true);

  if (query.category_id === 'none') {
    base.whereNull('p.category_id');
  } else if (query.category_id) {
    base.andWhere('p.category_id', query.category_id);
  }

  const search = String(query.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    base.andWhere((b) => b.where('p.name', 'like', like).orWhere('p.code', 'like', like));
  }

  const [countRow] = await base.clone().clearSelect().clearOrder().select(knex.raw('COUNT(DISTINCT p.id) as total'));
  const total = Number(countRow?.total || 0);

  const sortBy = SORT_BY_KEYS.has(query.sort_by) ? query.sort_by : 'total_earning';
  const sortDir = query.sort_dir === 'asc' ? 'asc' : 'desc';
  const orderParts = orderClauseForSort(sortBy, sortDir);

  let rowsQb = base.clone().select(
    'p.id',
    'p.code',
    'p.main_image',
    knex.raw('c.label as category_name'),
    knex.raw('p.name as product_name'),
    'p.qty as stock',
    knex.raw('COALESCE(oa.booked_qty, 0) as booked_qty'),
    'p.price_sell as mrp',
    'p.price_rent as rent_price',
    knex.raw('COALESCE(oa.total_rent, 0) as total_rent'),
    knex.raw('COALESCE(oa.total_discount, 0) as total_discount'),
    knex.raw('COALESCE(oa.sale_qty, 0) as sale_qty'),
    knex.raw('COALESCE(oa.total_earning, 0) as total_earning')
  );
  for (const part of orderParts) {
    rowsQb = rowsQb.orderBy(part.column, part.order);
  }
  const rows = await rowsQb.offset((page - 1) * perPage).limit(perPage);

  const mapped = rows.map((r) => ({
    id: r.id,
    code: r.code,
    main_image: r.main_image || null,
    category_name: r.category_name || null,
    product_name: r.product_name,
    stock: Number(r.stock ?? 0),
    booked_qty: Number(r.booked_qty ?? 0),
    mrp: round2(Number(r.mrp ?? 0)),
    rent_price: round2(Number(r.rent_price ?? 0)),
    total_rent: round2(Number(r.total_rent ?? 0)),
    total_discount: round2(Number(r.total_discount ?? 0)),
    sale_qty: Number(r.sale_qty ?? 0),
    total_earning: round2(Number(r.total_earning ?? 0)),
  }));

  return {
    range: { from, to },
    rows: mapped,
    meta: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.ceil(total / perPage) || 0,
    },
  };
}
