import { v4 as uuid } from 'uuid';

import {
  accessoryRentableQty,
  formatAccessoryQtyExceededMessage,
  formatAccessorySpareMessage,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { deleteCatalogItem } from '../../lib/catalogDelete.js';
import { sqlStageFlagFalsy, sqlStageFlagTruthy } from '../../lib/stageFlagsSql.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import {
  accessoryOutQtySubquery,
  accessoryInShopQtyExpr,
  applyAccessoryLowStockWhere,
  applyAccessoryRentOverlap,
  fetchAccessoryBookedQtyByIds,
  fetchAccessoryOutQtyByIds,
  mapAccessoryStockFields,
  readLowStockGlobalLimit,
} from './accessoryStockMetrics.js';
import {
  assertAccessoryCodeNumberAvailable,
  backfillMissingAccessoryCodes,
  generateNextAccessoryCode,
  getAccessoryCodeFormat,
  getLastAccessoryCodeForCategory,
  normalizeAccessoryCodeInput,
  ensureAccessoryCodesReady,
  shopHasMissingAccessoryCodes,
  updateAccessoryCodeFormat,
} from './accessoryCode.js';
import {
  activeAccessoryBookingConflicts,
  calculateAccessoryWashingAvailability,
} from './washingAvailability.js';

export {
  getAccessoryCodeFormat,
  updateAccessoryCodeFormat,
  getLastAccessoryCodeForCategory,
  generateNextAccessoryCode,
};

function enrichAccessoryAvailabilityFields(row, bookedQty = 0) {
  const total = Number(row.qty || 0);
  const spare = Math.max(0, Number(row.spare_qty || 0));
  const damaged = Math.max(0, Number(row.damaged_qty || 0));
  const rentable = accessoryRentableQty(row);
  const booked = Number(bookedQty || 0);
  const free = Math.max(0, rentable - booked);
  return {
    total_qty: total,
    spare_qty: spare,
    damaged_qty: damaged,
    rentable_qty: rentable,
    booked_qty: booked,
    free_qty: free,
  };
}

// Mirrors `refineAccessorySpareQty` in packages/shared/src/schemas/accessory.js.
// The zod rule only sees the payload, so a partial update that lowers `qty`
// without resending `spare_qty`/`damaged_qty` passes it — this one merges the
// payload over the stored row and catches that case.
function assertAccessorySpareQty(payload, existingRow = null) {
  const pick = (key) =>
    payload[key] !== undefined
      ? Math.max(0, Number(payload[key]) || 0)
      : Math.max(0, Number(existingRow?.[key] ?? 0) || 0);
  const qty = pick('qty');
  const spare = pick('spare_qty');
  const damaged = pick('damaged_qty');
  if (spare > qty) throw badRequest('Spare qty cannot exceed qty in stock');
  if (damaged > qty) throw badRequest('Damaged qty cannot exceed qty in stock');
  // Spare and damaged both come out of the same pool.
  if (spare + damaged > qty) {
    throw badRequest('Spare and damaged qty together cannot exceed qty in stock');
  }
}

function normalizeAccessoryOrderStatus(value) {
  const s = String(value || '').trim();
  if (s === 'given_with_rent' || s === 'pack_with_rent' || s === 'regular') return s;
  return 'regular';
}

function applyAccessoryCatalogActiveFilter(qb, query = {}, alias = 'a') {
  const mode = String(query.catalog_active || 'active')
    .trim()
    .toLowerCase();
  if (mode === 'inactive') {
    qb.andWhere({ [`${alias}.is_active`]: false });
  } else if (mode !== 'all') {
    qb.andWhere({ [`${alias}.is_active`]: true });
  }
  return qb;
}

/**
 * Active accessories where effective in-shop qty (total minus on-order) is
 * below per-item threshold or global low-stock limit.
 */
export async function listLowStockAccessories(shopId, limit = 40) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 40));
  const globalLimit = await readLowStockGlobalLimit(shopId);
  const inShopExpr = accessoryInShopQtyExpr('a', 'ao');
  const activeOutSub = accessoryOutQtySubquery(knex, shopId);

  const rows = await knex('accessories as a')
    .leftJoin('categories as c', function onCategory() {
      this.on('c.id', '=', 'a.category_id').andOn('c.shop_id', '=', knex.raw('?', [shopId]));
    })
    .leftJoin(activeOutSub, 'ao.accessory_id', 'a.id')
    .where({ 'a.shop_id': shopId, 'a.is_active': true })
    .modify((qb) => applyAccessoryLowStockWhere(qb, inShopExpr, 'a.threshold', globalLimit))
    .orderByRaw(`${inShopExpr} ASC`)
    .orderBy('a.name', 'asc')
    .limit(cap)
    .select(
      'a.id',
      'a.name',
      'a.qty',
      'a.spare_qty',
      'a.damaged_qty',
      'a.threshold',
      'a.unit',
      'a.image_url',
      'c.label as category_name',
      knex.raw('COALESCE(ao.out_qty, 0) as active_out_qty'),
      knex.raw(`GREATEST(0, ${inShopExpr}) as in_shop_qty`)
    );

  return rows.map((r) => ({
    ...r,
    ...mapAccessoryStockFields(r, r.active_out_qty, globalLimit),
  }));
}

export async function listAccessories(shopId, query) {
  const lowStockOnly = query.low_stock === '1' || query.low_stock === 'true';
  const damagedOnly = query.damaged === '1' || query.damaged === 'true';

  if (await shopHasMissingAccessoryCodes(shopId)) {
    await ensureAccessoryCodesReady(shopId);
  }

  const qb = knex('accessories as a').where({ 'a.shop_id': shopId });
  applyAccessoryCatalogActiveFilter(qb, query);
  if (query.default_type) qb.andWhere({ 'a.default_type': query.default_type });
  if (query.default_order_status)
    qb.andWhere({
      'a.default_order_status': normalizeAccessoryOrderStatus(query.default_order_status),
    });
  if (query.category_id === 'none') {
    qb.whereNull('a.category_id');
  } else if (query.category_id) {
    qb.andWhere({ 'a.category_id': query.category_id });
  }

  if (damagedOnly) qb.andWhere('a.damaged_qty', '>', 0);

  if (lowStockOnly) {
    const globalLimit = await readLowStockGlobalLimit(shopId);
    const lowStockOutSub = accessoryOutQtySubquery(knex, shopId, {
      alias: 'ls_ao',
      oaAlias: 'oa2',
      oAlias: 'o2',
    });
    const inShopExpr = accessoryInShopQtyExpr('a', 'ls_ao');
    qb.leftJoin(lowStockOutSub, 'ls_ao.accessory_id', 'a.id');
    applyAccessoryLowStockWhere(qb, inShopExpr, 'a.threshold', globalLimit);
  }

  qb.select('a.*');
  const searchBy = String(query.search_by || 'all')
    .trim()
    .toLowerCase();
  const searchFields =
    searchBy === 'code' ? ['a.code'] : searchBy === 'name' ? ['a.name'] : ['a.name', 'a.code'];
  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || 'a.name',
    search_fields: searchFields,
  });

  const from = isValidDate(query.from) ? query.from : null;
  const to = isValidDate(query.to) ? query.to : null;
  const excludeOrderId = query.exclude_order_id ? String(query.exclude_order_id).trim() : null;
  const includeActiveCount =
    query.include_active_count === '1' || query.include_active_count === 'true';
  const globalLimitForStock =
    includeActiveCount || lowStockOnly ? await readLowStockGlobalLimit(shopId) : 0;

  const rows = result?.data || [];
  const ids = rows.map((r) => r.id).filter(Boolean);
  let bookedById = new Map();
  let activeOutById = new Map();

  if (ids.length && from && to) {
    bookedById = await fetchAccessoryBookedQtyByIds(shopId, ids, from, to, excludeOrderId);
  }

  if (ids.length && includeActiveCount) {
    activeOutById = await fetchAccessoryOutQtyByIds(shopId, ids);
  }

  result.data = rows.map((r) => {
    const availability = enrichAccessoryAvailabilityFields(r, bookedById.get(r.id) || 0);
    const out = activeOutById.get(r.id) || 0;
    const row = { ...r, ...availability };
    if (includeActiveCount) {
      Object.assign(row, mapAccessoryStockFields(r, out, globalLimitForStock));
    }
    return row;
  });

  return result;
}

export async function listRecommendedAccessories(shopId, params = {}) {
  const productId = params.product_id;
  const categoryId = params.category_id || null;
  const from = params.from || null;
  const to = params.to || null;
  if (!productId) throw badRequest('product_id is required');
  if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
    throw badRequest('from and to must be YYYY-MM-DD dates');
  }
  if (from && to && from > to) throw badRequest('from must be on or before to');

  const product = await knex('products')
    .where({ id: productId, shop_id: shopId, is_active: true })
    .first('id', 'category_id');
  if (!product) throw notFound('Product not found');

  const category = categoryId || product.category_id;

  const direct = await knex('product_accessories as pa')
    .join('accessories as a', 'a.id', 'pa.accessory_id')
    .leftJoin('categories as c', function onCategory() {
      this.on('c.id', '=', 'a.category_id').andOn('c.shop_id', '=', knex.raw('?', [shopId]));
    })
    .leftJoin('product_category_accessory_categories as pca', function onPca() {
      this.on('pca.accessory_category_id', '=', 'a.category_id');
      if (category) {
        this.andOn('pca.product_category_id', '=', knex.raw('?', [category]));
      }
    })
    .where({
      'pa.product_id': product.id,
      'a.shop_id': shopId,
      'a.is_active': true,
    })
    .orderBy('pa.display_order')
    .select(
      'a.id',
      'a.name',
      'a.image_url',
      'a.qty',
      'a.spare_qty',
      'a.damaged_qty',
      'a.price_rent',
      'a.price_sell',
      'a.default_type',
      'a.default_order_status',
      'a.category_id',
      'c.label as category_name',
      'pa.is_recommended',
      'pa.is_required',
      'pa.display_order',
      'pca.display_order as category_display_order'
    );

  // Always include category-mapped accessories too, then de-duplicate with
  // product mapping taking priority. This ensures category suggestions still
  // appear even when direct mapping is partial / absent.
  let categoryRows = [];
  if (category) {
    categoryRows = await knex('accessories as a')
      .join(
        'product_category_accessory_categories as pca',
        'pca.accessory_category_id',
        'a.category_id'
      )
      .leftJoin('categories as c', function onCategory() {
        this.on('c.id', '=', 'a.category_id').andOn('c.shop_id', '=', knex.raw('?', [shopId]));
      })
      .where({
        'a.shop_id': shopId,
        'a.is_active': true,
        'pca.product_category_id': category,
      })
      .orderBy('a.name')
      .select(
        'a.id',
        'a.name',
        'a.image_url',
        'a.qty',
        'a.spare_qty',
        'a.damaged_qty',
        'a.price_rent',
        'a.price_sell',
        'a.default_type',
        'a.default_order_status',
        'a.category_id',
        'c.label as category_name',
        'pca.display_order as category_display_order',
        knex.raw('1 as is_recommended'),
        knex.raw('0 as is_required'),
        knex.raw('9999 as display_order')
      );
  }
  const merged = new Map();
  direct.forEach((r) => merged.set(r.id, { ...r, source: 'product' }));
  categoryRows.forEach((r) => {
    if (!merged.has(r.id)) merged.set(r.id, { ...r, source: 'category' });
  });
  const rows = Array.from(merged.values()).sort((a, b) => {
    const catA =
      a.category_display_order !== undefined && a.category_display_order !== null
        ? Number(a.category_display_order)
        : 9999;
    const catB =
      b.category_display_order !== undefined && b.category_display_order !== null
        ? Number(b.category_display_order)
        : 9999;
    if (catA !== catB) return catA - catB;
    return Number(a.display_order || 0) - Number(b.display_order || 0);
  });
  const source = direct.length > 0 ? (categoryRows.length > 0 ? 'mixed' : 'product') : 'category';

  const excludeOrderId = params.exclude_order_id ? String(params.exclude_order_id).trim() : null;

  const ids = rows.map((r) => r.id);
  let bookedById = new Map();
  if (ids.length && from && to) {
    bookedById = await fetchAccessoryBookedQtyByIds(shopId, ids, from, to, excludeOrderId);
  }

  const settings = await getBookingAccessorySettings(shopId);
  const data = rows.map((r) => {
    const availability = enrichAccessoryAvailabilityFields(r, bookedById.get(r.id) || 0);
    const defaultType =
      r.default_type === 'rent' || r.default_type === 'sell' || r.default_type === 'both'
        ? r.default_type
        : 'sell';
    return {
      id: r.id,
      name: r.name,
      image_url: r.image_url || null,
      ...availability,
      available: availability.free_qty > 0,
      price_rent: Number(r.price_rent || 0),
      price_sell: Number(r.price_sell || 0),
      default_type: defaultType,
      default_order_status: normalizeAccessoryOrderStatus(r.default_order_status),
      category_id: r.category_id || null,
      category_name: r.category_name || null,
      is_recommended: !!r.is_recommended,
      is_required: !!r.is_required,
      default_selected: r.source === 'product',
      source: r.source || source,
      display_order: Number(r.display_order ?? 0),
      category_display_order:
        r.category_display_order !== undefined && r.category_display_order !== null
          ? Number(r.category_display_order || 0)
          : null,
    };
  });
  return { source, settings, data };
}

export async function getAccessoryCategoryCounts(shopId, query = {}) {
  const globalLimit = await readLowStockGlobalLimit(shopId);
  const inShopExpr = accessoryInShopQtyExpr('a', 'ao');
  const activeOutSub = accessoryOutQtySubquery(knex, shopId);

  const [[totalRow], [uncatRow], categories, counts, [lowStockRow], [damagedRow]] =
    await Promise.all([
      applyAccessoryCatalogActiveFilter(
        knex('accessories as a').where({ 'a.shop_id': shopId }),
        query
      ).count({ c: '*' }),
      applyAccessoryCatalogActiveFilter(
        knex('accessories as a').where({ 'a.shop_id': shopId }),
        query
      )
        .whereNull('a.category_id')
        .count({ c: knex.raw('DISTINCT a.id') }),
      knex('categories')
        .where({ shop_id: shopId, is_active: true, category_type: 'accessory' })
        .orderBy('label')
        .select('id', 'label', 'sort_order'),
      applyAccessoryCatalogActiveFilter(
        knex('accessories as a').where({ 'a.shop_id': shopId }),
        query
      )
        .whereNotNull('a.category_id')
        .groupBy('a.category_id')
        .select('a.category_id')
        .count({ c: knex.raw('DISTINCT a.id') }),
      applyAccessoryCatalogActiveFilter(
        knex('accessories as a')
          .leftJoin(activeOutSub, 'ao.accessory_id', 'a.id')
          .where({ 'a.shop_id': shopId }),
        query
      )
        .modify((qb) => applyAccessoryLowStockWhere(qb, inShopExpr, 'a.threshold', globalLimit))
        .count({ c: knex.raw('DISTINCT a.id') }),
      applyAccessoryCatalogActiveFilter(
        knex('accessories as a').where({ 'a.shop_id': shopId }),
        query
      )
        .andWhere('a.damaged_qty', '>', 0)
        .count({ c: knex.raw('DISTINCT a.id') }),
    ]);

  const countMap = new Map(counts.map((r) => [r.category_id, Number(r.c || 0)]));

  return {
    total: Number(totalRow?.c || 0),
    uncategorized: Number(uncatRow?.c || 0),
    low_stock_count: Number(lowStockRow?.c || 0),
    damaged_count: Number(damagedRow?.c || 0),
    by_category: categories.map((c) => ({
      id: c.id,
      label: c.label,
      sort_order: c.sort_order,
      count: countMap.get(c.id) || 0,
    })),
  };
}

/**
 * Rent accessory availability for a pickup/return window (catalog qty minus overlapping rent bookings).
 */
export async function checkAccessoryAvailability(shopId, params) {
  const accessoryId = params.accessory_id;
  const from = params.from;
  const to = params.to;
  const requestedQty = Math.max(1, Number(params.qty ?? 1));
  if (!accessoryId) throw badRequest('accessory_id is required');
  if (!isValidDate(from) || !isValidDate(to)) {
    throw badRequest('from and to must be YYYY-MM-DD dates');
  }
  if (from > to) throw badRequest('from must be on or before to');

  const accessory = await knex('accessories')
    .where({ id: accessoryId, shop_id: shopId, is_active: true })
    .first();
  if (!accessory) throw notFound('Accessory not found');

  const excludeOrderId = params.exclude_order_id ? String(params.exclude_order_id).trim() : null;

  const conflictsQb = knex('order_accessories as oa')
    .join('orders as o', 'o.id', 'oa.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oa.accessory_id', accessory.id);
  applyAccessoryRentOverlap(conflictsQb, shopId, from, to, { excludeOrderId });

  const [conflicts, washingQueueRows, laundryWashingRows] = await Promise.all([
    conflictsQb
      .orderBy('o.pickup_date')
      .select(
        'o.id as order_id',
        'o.order_number',
        'o.bill_no',
        'o.status',
        'o.pickup_date',
        'o.return_date',
        'oa.id as order_accessory_id',
        'oa.qty as booked_qty',
        'oa.stage_flags',
        'c.name as customer_name',
        'c.phone1 as customer_phone'
      ),
    knex('washing_queue as wq')
      .leftJoin('orders as qo', 'qo.id', 'wq.order_id')
      .where({ 'wq.shop_id': shopId, 'wq.accessory_id': accessory.id })
      .where('wq.item_kind', 'accessory')
      .orderBy('wq.queued_at', 'desc')
      .select('wq.id', 'wq.qty', 'wq.order_id', 'wq.order_accessory_id', 'qo.order_number'),
    knex('laundry_job_accessories as lja')
      .join('laundry_jobs as lj', 'lj.id', 'lja.laundry_job_id')
      .where({
        'lja.shop_id': shopId,
        'lja.accessory_id': accessory.id,
        'lja.status': 'in_washing',
      })
      .orderBy('lj.laundry_date', 'desc')
      .select(
        'lja.id as line_id',
        'lja.qty',
        'lj.id as laundry_job_id',
        'lj.job_no',
        'lj.laundry_date'
      ),
  ]);

  const activeConflicts = activeAccessoryBookingConflicts(conflicts);
  const bookedQty = activeConflicts.reduce((sum, r) => sum + Number(r.booked_qty || 0), 0);
  const totalQty = Number(accessory.qty || 0);
  const spareQty = Math.max(0, Number(accessory.spare_qty || 0));
  const damagedQty = Math.max(0, Number(accessory.damaged_qty || 0));
  const rentableQty = accessoryRentableQty(accessory);
  const washingQueue = washingQueueRows.map((row) => ({
    ...row,
    qty: Number(row.qty || 0),
  }));
  const laundryWashing = laundryWashingRows.map((row) => ({
    ...row,
    qty: Number(row.qty || 0),
  }));
  const { washingQueueQty, laundryWashingQty, washingQty, freeQty } =
    calculateAccessoryWashingAvailability({
      rentableQty,
      bookedQty,
      washingQueueRows: washingQueue,
      laundryWashingRows: laundryWashing,
    });

  return {
    accessory: {
      id: accessory.id,
      name: accessory.name,
      qty: totalQty,
      spare_qty: spareQty,
      damaged_qty: damagedQty,
    },
    total_qty: totalQty,
    spare_qty: spareQty,
    damaged_qty: damagedQty,
    rentable_qty: rentableQty,
    booked_qty: bookedQty,
    washing_qty: washingQty,
    washing_queue_qty: washingQueueQty,
    laundry_washing_qty: laundryWashingQty,
    free_qty: freeQty,
    requested_qty: requestedQty,
    available: freeQty >= requestedQty,
    conflicts: activeConflicts.map(({ stage_flags: _stageFlags, ...conflict }) => ({
      ...conflict,
      booked_qty: Number(conflict.booked_qty || 0),
    })),
    washing_queue: washingQueue,
    laundry_washing: laundryWashing,
  };
}

/**
 * Bookings where this rent accessory is delivered and not yet received (matches active_out_qty).
 * @param {string} shopId
 * @param {string} accessoryId
 */
export async function listAccessoryOutOrders(shopId, accessoryId) {
  const accessory = await knex('accessories').where({ id: accessoryId, shop_id: shopId }).first();
  if (!accessory) throw notFound('Accessory not found');

  const stageCol = 'oa.stage_flags';
  const rows = await knex('order_accessories as oa')
    .join('orders as o', 'o.id', 'oa.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oa.shop_id', shopId)
    .where('oa.accessory_id', accessoryId)
    .where('o.is_deleted', false)
    .where('oa.type', 'rent')
    .whereRaw(`(${sqlStageFlagTruthy(stageCol, '$.delivered')})`)
    .whereRaw(`(${sqlStageFlagFalsy(stageCol, '$.received')})`)
    .orderBy('o.pickup_date', 'desc')
    .orderBy('o.order_number', 'desc')
    .select(
      'oa.id as order_accessory_id',
      'o.id as order_id',
      'o.order_number',
      'o.bill_no',
      'o.status',
      'o.pickup_date',
      'o.return_date',
      'oa.qty',
      'oa.name_snapshot',
      'oa.given_status',
      'c.name as customer_name',
      'c.phone1 as customer_phone'
    );

  const mapped = rows.map((r) => ({
    order_accessory_id: r.order_accessory_id,
    order_id: r.order_id,
    order_number: r.order_number,
    bill_no: r.bill_no || r.order_number,
    status: r.status,
    pickup_date: r.pickup_date,
    return_date: r.return_date,
    qty: Number(r.qty || 0),
    name_snapshot: r.name_snapshot,
    given_status: r.given_status,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
  }));
  const total_qty = mapped.reduce((sum, r) => sum + r.qty, 0);

  return {
    accessory: { id: accessory.id, name: accessory.name, unit: accessory.unit },
    rows: mapped,
    total_qty,
  };
}

function isRentAccessoryOrderLine(item) {
  if (!item || item.item_type !== 'accessory') return false;
  if (String(item.type || 'rent').toLowerCase() === 'sell') return false;
  return Boolean(item.accessory_id);
}

/**
 * Ensure aggregated rent accessory demand fits availability for the order date window.
 * @param {string} shopId
 * @param {{ from: string, to: string, items: object[], excludeOrderId?: string|null }} opts
 */
export async function assertRentAccessoryLinesAvailable(shopId, opts) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  const excludeOrderId = opts.excludeOrderId
    ? String(opts.excludeOrderId).trim()
    : opts.exclude_order_id
      ? String(opts.exclude_order_id).trim()
      : null;
  const from = opts.from;
  const to = opts.to;
  if (!isValidDate(from) || !isValidDate(to)) {
    throw badRequest('from and to must be YYYY-MM-DD dates');
  }

  const demand = new Map();
  const labels = new Map();
  for (const item of items) {
    if (!isRentAccessoryOrderLine(item)) continue;
    const id = item.accessory_id;
    const qty = Math.max(1, Number(item.qty) || 1);
    demand.set(id, (demand.get(id) || 0) + qty);
    if (!labels.has(id)) {
      const label = String(item.name_snapshot || '').trim();
      if (label) labels.set(id, label);
    }
  }

  if (demand.size === 0) return;

  const results = await Promise.all(
    [...demand.entries()].map(([accessoryId, qty]) =>
      checkAccessoryAvailability(shopId, {
        accessory_id: accessoryId,
        from,
        to,
        qty,
        ...(excludeOrderId ? { exclude_order_id: excludeOrderId } : {}),
      }).then((result) => ({ accessoryId, qty, result }))
    )
  );

  for (const { accessoryId, qty, result } of results) {
    if (result.available) continue;
    const label = labels.get(accessoryId) || result.accessory?.name || 'Accessory';
    const free = Number(result.free_qty || 0);
    const spare = Number(result.spare_qty || 0);
    const damaged = Number(result.damaged_qty || 0);
    throw badRequest(
      free > 0
        ? formatAccessoryQtyExceededMessage(label, qty, free, spare, 'rent', damaged)
        : formatAccessorySpareMessage(label, spare, free, 'rent', damaged)
    );
  }
}

function isSellAccessoryOrderLine(item) {
  if (!item || item.item_type !== 'accessory') return false;
  if (String(item.type || 'rent').toLowerCase() !== 'sell') return false;
  return Boolean(item.accessory_id);
}

/**
 * Ensure aggregated sell accessory demand fits rentable pool (qty minus spare reserve).
 * @param {string} shopId
 * @param {{ items: object[], excludeOrderId?: string|null }} opts
 */
export async function assertSellAccessoryLinesAvailable(shopId, opts) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  const excludeOrderId = opts.excludeOrderId
    ? String(opts.excludeOrderId).trim()
    : opts.exclude_order_id
      ? String(opts.exclude_order_id).trim()
      : null;
  const demand = new Map();
  const labels = new Map();

  for (const item of items) {
    if (!isSellAccessoryOrderLine(item)) continue;
    const id = item.accessory_id;
    const qty = Math.max(1, Number(item.qty) || 1);
    demand.set(id, (demand.get(id) || 0) + qty);
    if (!labels.has(id)) {
      const label = String(item.name_snapshot || '').trim();
      if (label) labels.set(id, label);
    }
  }

  let previousSellByAccessory = new Map();
  if (excludeOrderId) {
    const rows = await knex('order_accessories')
      .where({ order_id: excludeOrderId, shop_id: shopId, type: 'sell' })
      .whereNotNull('accessory_id')
      .groupBy('accessory_id')
      .select('accessory_id')
      .sum({ qty: 'qty' });
    previousSellByAccessory = new Map(rows.map((row) => [row.accessory_id, Number(row.qty || 0)]));
  }

  for (const [accessoryId, qty] of demand) {
    const row = await knex('accessories')
      .where({ id: accessoryId, shop_id: shopId, is_active: true })
      .first();
    if (!row) throw badRequest('Accessory not found for sell item');
    const rentable = accessoryRentableQty(row) + (previousSellByAccessory.get(accessoryId) || 0);
    if (qty <= rentable) continue;
    const label = labels.get(accessoryId) || row.name || 'Accessory';
    const spare = Math.max(0, Number(row.spare_qty || 0));
    const damaged = Math.max(0, Number(row.damaged_qty || 0));
    throw badRequest(
      formatAccessoryQtyExceededMessage(label, qty, rentable, spare, 'sell', damaged)
    );
  }
}

export async function getAccessory(shopId, id) {
  const row = await knex('accessories').where({ id, shop_id: shopId }).first();
  if (!row) throw notFound('Accessory not found');
  if (!String(row.code || '').trim()) {
    await ensureAccessoryCodesReady(shopId);
    return knex('accessories').where({ id, shop_id: shopId }).first();
  }
  return row;
}

export async function createAccessory(shopId, data) {
  await ensureAccessoryCodesReady(shopId);
  const { category_id: rawCategoryId, code: rawCode, ...rest } = data;
  const category_id = rawCategoryId || null;
  await assertAccessoryCategoryId(shopId, category_id);
  assertAccessorySpareQty(rest);

  let code = rawCode ? normalizeAccessoryCodeInput(rawCode) : '';
  if (!code) {
    const generated = await generateNextAccessoryCode(shopId, category_id);
    code = generated.code;
  }

  await assertAccessoryCodeNumberAvailable(shopId, { ...rest, category_id, code });

  const id = uuid();
  await knex('accessories').insert({
    ...rest,
    category_id,
    code,
    id,
    shop_id: shopId,
  });
  return getAccessory(shopId, id);
}

export async function updateAccessory(shopId, id, data) {
  const existing = await getAccessory(shopId, id);
  const { category_id, code: rawCode, ...rest } = data;
  const payload = { ...rest };
  const nextCategoryId = category_id !== undefined ? category_id : undefined;
  if (nextCategoryId !== undefined) {
    await assertAccessoryCategoryId(shopId, nextCategoryId);
    payload.category_id = nextCategoryId;
  }
  if (rawCode !== undefined) {
    payload.code = normalizeAccessoryCodeInput(rawCode);
  }
  delete payload.id;
  assertAccessorySpareQty(payload, existing);

  const merged = {
    ...existing,
    ...payload,
    category_id: nextCategoryId !== undefined ? nextCategoryId : existing.category_id,
  };
  await assertAccessoryCodeNumberAvailable(shopId, merged, id);

  Object.keys(payload).forEach((k) => {
    if (payload[k] === undefined) delete payload[k];
  });
  payload.updated_at = knex.fn.now();
  await knex('accessories').where({ id, shop_id: shopId }).update(payload);
  const after = await getAccessory(shopId, id);
  return { before: existing, after };
}

async function assertAccessoryCategoryId(shopId, categoryId) {
  if (!categoryId) return;
  const row = await knex('categories')
    .where({
      id: categoryId,
      shop_id: shopId,
      is_active: true,
      category_type: 'accessory',
    })
    .first('id');
  if (!row) throw badRequest('Accessory category is invalid for this shop');
}

export async function deleteAccessory(shopId, id, mode = 'deactivate') {
  return deleteCatalogItem(knex, { shopId, id, kind: 'accessory', mode });
}

export async function activateAccessory(shopId, id) {
  const existing = await getAccessory(shopId, id);
  if (existing.is_active !== false && existing.is_active !== 0) {
    throw badRequest('Accessory is already active');
  }
  await knex('accessories')
    .where({ id, shop_id: shopId, is_active: false })
    .update({ is_active: true, updated_at: knex.fn.now() });
  return { before: existing, after: { ...existing, is_active: true } };
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function getBookingAccessorySettings(shopId) {
  const row = await knex('settings')
    .where({ shop_id: shopId, key: 'config.booking_accessories' })
    .first('value');
  let parsed = {};
  try {
    parsed = row?.value ? JSON.parse(row.value) : {};
  } catch {
    parsed = {};
  }
  return {
    auto_add_enabled: parsed.auto_add_enabled !== false,
    default_selected: parsed.default_selected !== false,
  };
}
