import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { catalogPermanentDeleteBlockers, deleteCatalogItem } from '../../lib/catalogDelete.js';
import { applyStalePreDeliveryRelease } from '../../lib/rentalOverlap.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import {
  buildProductCode,
  classifyProductSearchTerm,
  normalizeProductCode,
  normalizeProductName,
  parseProductCode,
  productCodeNumberFromStored,
  resolveFullProductCode,
} from '@wrs/shared';
import { listUpcomingBookingsForProduct } from './upcomingBookings.js';
import {
  applyProductSearchFilter,
  applyProductSearchRanking,
  findProductByCodeOrSearch,
} from './productSearch.js';

const CODE_FORMAT_KEY = 'config.product_code';
const DEFAULT_CODE_FORMAT = { default_prefix: '', padding: 4, by_category: {} };

/**
 * Order statuses that actively reserve a product against new bookings.
 * Once an order is `returned`, `closed` or `cancelled` the item is free again.
 */
const BLOCKING_ORDER_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
  'delivered',
  'partially_returned',
];
const NEXT_PICKUP_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
];

function applyCatalogActiveFilter(qb, query) {
  const mode = String(query.catalog_active || 'active')
    .trim()
    .toLowerCase();
  if (mode === 'inactive') {
    qb.andWhere({ 'p.is_active': false });
  } else if (mode === 'all') {
    // include active + inactive
  } else {
    qb.andWhere({ 'p.is_active': true });
  }
}

export function listProducts(shopId, query) {
  const lean =
    query.lean === '1' || query.lean === 1 || query.lean === true || query.lean === 'true';

  if (lean) {
    const qb = knex('products as p').where({ 'p.shop_id': shopId });
    applyCatalogActiveFilter(qb, query);
    if (query.category_id === 'none') {
      qb.whereNull('p.category_id');
    } else if (query.category_id) {
      qb.andWhere({ 'p.category_id': query.category_id });
    }
    if (query.type) qb.andWhere({ 'p.type': query.type });
    const saleOnly =
      query.sale_only === true || query.sale_only === 'true' || query.sale_only === '1';
    if (saleOnly) qb.whereIn('p.type', ['sell', 'both']);
    const size = String(query.size || '').trim();
    if (size) qb.andWhere({ 'p.size': size });
    const color = String(query.color || '').trim();
    if (color) qb.andWhere({ 'p.color': color });
    const noImage = query.no_image === true || query.no_image === 'true' || query.no_image === '1';
    if (noImage) {
      qb.where((w) => {
        w.whereNull('p.main_image').orWhere('p.main_image', '');
      });
    }
    const searchTerm = String(query.search || '').trim();
    if (searchTerm) {
      applyProductSearchFilter(qb, searchTerm, 'p');
      applyProductSearchRanking(qb, searchTerm, 'p');
    }
    qb.select('p.*');
    return paginate(qb, {
      page: query.page,
      per_page: query.per_page,
      sort: searchTerm ? undefined : query.sort || '-created_at',
    });
  }

  const qb = knex('products as p').where({ 'p.shop_id': shopId });
  attachInventoryQtyJoins(qb, shopId);
  qb.select(
    'p.*',
    buildActiveRentCountExpr('p'),
    knex.raw(
      `(SELECT oi.delivered_at
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id AND o.shop_id = p.shop_id
        WHERE oi.product_id = p.id AND o.is_deleted = 0 AND oi.delivered_at IS NOT NULL
        ORDER BY oi.delivered_at DESC
        LIMIT 1) AS last_delivered_at`
    ),
    knex.raw(
      `(SELECT COALESCE(oi.received_at, o.returned_at)
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id AND o.shop_id = p.shop_id
        WHERE oi.product_id = p.id AND o.is_deleted = 0
          AND (oi.received_at IS NOT NULL OR o.returned_at IS NOT NULL)
        ORDER BY COALESCE(oi.received_at, o.returned_at) DESC
        LIMIT 1) AS last_returned_at`
    ),
    knex.raw('COALESCE(bk.booked_qty, 0) as booked_qty'),
    knex.raw('COALESCE(dv.in_delivery_qty, 0) as in_delivery_qty'),
    knex.raw('COALESCE(rt.returned_qty, 0) as returned_qty'),
    knex.raw('COALESCE(ws.washing_qty, 0) as washing_qty'),
    knex.raw(`(${INVENTORY_DISPLAY_STATUS_CASE}) as display_status`)
  );
  applyCatalogActiveFilter(qb, query);
  if (query.category_id === 'none') {
    qb.whereNull('p.category_id');
  } else if (query.category_id) {
    qb.andWhere({ 'p.category_id': query.category_id });
  }
  applyInventoryLaneFilter(qb, query.inventory_lane);
  if (query.type) qb.andWhere({ 'p.type': query.type });
  const saleOnly =
    query.sale_only === true || query.sale_only === 'true' || query.sale_only === '1';
  if (saleOnly) qb.whereIn('p.type', ['sell', 'both']);
  const size = String(query.size || '').trim();
  if (size) qb.andWhere({ 'p.size': size });
  const color = String(query.color || '').trim();
  if (color) qb.andWhere({ 'p.color': color });
  const noImage = query.no_image === true || query.no_image === 'true' || query.no_image === '1';
  if (noImage) {
    qb.where((w) => {
      w.whereNull('p.main_image').orWhere('p.main_image', '');
    });
  }
  const searchTerm = String(query.search || '').trim();
  if (searchTerm) {
    applyProductSearchFilter(qb, searchTerm, 'p');
    applyProductSearchRanking(qb, searchTerm, 'p');
  }
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    sort: searchTerm ? undefined : query.sort || '-created_at',
  });
}

function formatExportTimestamp(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString();
}

function mapProductExportRow(row) {
  const photos = parseJSONSafe(row.photos);
  const galleryUrls = Array.isArray(photos)
    ? photos
        .map((u) => String(u || '').trim())
        .filter(Boolean)
        .join('|')
    : '';

  return {
    id: row.id,
    code: row.code || '',
    name: row.name || '',
    type: row.type || '',
    category_id: row.category_id || '',
    category_name: row.category_name || '',
    qty: Number(row.qty ?? 0),
    price_rent: Number(row.price_rent ?? 0),
    price_sell: Number(row.price_sell ?? 0),
    purchase_price: Number(row.purchase_price ?? 0),
    color: row.color || '',
    size: row.size || '',
    lifetime_gap: Number(row.lifetime_gap ?? 0),
    count: Number(row.count ?? 0),
    status: row.status || '',
    display_status: row.display_status || '',
    booked_qty: Number(row.booked_qty ?? 0),
    in_delivery_qty: Number(row.in_delivery_qty ?? 0),
    returned_qty: Number(row.returned_qty ?? 0),
    washing_qty: Number(row.washing_qty ?? 0),
    vendor_id: row.vendor_id || '',
    main_image: row.main_image || '',
    gallery_image_urls: galleryUrls,
    notes: row.notes || '',
    is_active: row.is_active !== false && row.is_active !== 0 ? 'Yes' : 'No',
    accessory_names: row.accessory_names || '',
    last_delivered_at: formatExportTimestamp(row.last_delivered_at),
    last_returned_at: formatExportTimestamp(row.last_returned_at),
    created_at: formatExportTimestamp(row.created_at),
    updated_at: formatExportTimestamp(row.updated_at),
  };
}

/** Shop catalog CSV export; optional query uses same filters as listProducts. */
export async function exportProducts(shopId, query = {}) {
  const qb = knex('products as p')
    .where({ 'p.shop_id': shopId })
    .leftJoin('categories as cat', function joinCat() {
      this.on('cat.id', '=', 'p.category_id').andOn('cat.shop_id', '=', 'p.shop_id');
    });
  attachInventoryQtyJoins(qb, shopId);
  applyCatalogActiveFilter(qb, query);
  if (query.category_id === 'none') {
    qb.whereNull('p.category_id');
  } else if (query.category_id) {
    qb.andWhere({ 'p.category_id': query.category_id });
  }
  applyInventoryLaneFilter(qb, query.inventory_lane);
  if (query.type) qb.andWhere({ 'p.type': query.type });
  const size = String(query.size || '').trim();
  if (size) qb.andWhere({ 'p.size': size });
  const color = String(query.color || '').trim();
  if (color) qb.andWhere({ 'p.color': color });
  const searchTerm = String(query.search || '').trim();
  if (searchTerm) {
    applyProductSearchFilter(qb, searchTerm, 'p');
  }
  qb.select(
    'p.*',
    'cat.label as category_name',
    buildActiveRentCountExpr('p'),
    knex.raw(
      `(SELECT oi.delivered_at
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id AND o.shop_id = p.shop_id
        WHERE oi.product_id = p.id AND o.is_deleted = 0 AND oi.delivered_at IS NOT NULL
        ORDER BY oi.delivered_at DESC
        LIMIT 1) AS last_delivered_at`
    ),
    knex.raw(
      `(SELECT COALESCE(oi.received_at, o.returned_at)
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id AND o.shop_id = p.shop_id
        WHERE oi.product_id = p.id AND o.is_deleted = 0
          AND (oi.received_at IS NOT NULL OR o.returned_at IS NOT NULL)
        ORDER BY COALESCE(oi.received_at, o.returned_at) DESC
        LIMIT 1) AS last_returned_at`
    ),
    knex.raw('COALESCE(bk.booked_qty, 0) as booked_qty'),
    knex.raw('COALESCE(dv.in_delivery_qty, 0) as in_delivery_qty'),
    knex.raw('COALESCE(rt.returned_qty, 0) as returned_qty'),
    knex.raw('COALESCE(ws.washing_qty, 0) as washing_qty'),
    knex.raw(`(${INVENTORY_DISPLAY_STATUS_CASE}) as display_status`),
    knex.raw(
      `(SELECT GROUP_CONCAT(a.name ORDER BY pa.display_order ASC, a.name ASC SEPARATOR '|')
        FROM product_accessories pa
        INNER JOIN accessories a ON a.id = pa.accessory_id AND a.shop_id = p.shop_id
        WHERE pa.product_id = p.id AND a.is_active = 1) AS accessory_names`
    )
  );
  qb.orderBy('p.code', 'asc');
  const rows = await qb;
  return rows.map(mapProductExportRow);
}

export async function getProductCategoryCounts(shopId) {
  const [[totalRow], [uncatRow], categories, counts] = await Promise.all([
    knex('products').where({ shop_id: shopId, is_active: true }).count({ c: '*' }),
    knex('products')
      .where({ shop_id: shopId, is_active: true })
      .whereNull('category_id')
      .count({ c: '*' }),
    knex('categories')
      .where({ shop_id: shopId, is_active: true, category_type: 'product' })
      .orderBy('sort_order')
      .orderBy('label')
      .select('id', 'label', 'sort_order'),
    knex('products')
      .where({ shop_id: shopId, is_active: true })
      .whereNotNull('category_id')
      .groupBy('category_id')
      .select('category_id')
      .count({ c: '*' }),
  ]);

  const countMap = new Map(counts.map((r) => [r.category_id, Number(r.c || 0)]));

  return {
    total: Number(totalRow?.c || 0),
    uncategorized: Number(uncatRow?.c || 0),
    by_category: categories.map((c) => ({
      id: c.id,
      label: c.label,
      sort_order: c.sort_order,
      count: countMap.get(c.id) || 0,
    })),
  };
}

export async function getProduct(shopId, id) {
  const row = await knex('products as p')
    .where({ 'p.id': id, 'p.shop_id': shopId })
    .select('p.*', buildActiveRentCountExpr('p'))
    .first();
  if (!row) throw notFound('Product not found');
  row.photos = parseJSONSafe(row.photos) || [];
  return row;
}

export async function createProduct(shopId, data) {
  await assertProductCodeNumberAvailable(shopId, data);
  const id = uuid();
  const payload = toDBRow({ ...data, id, shop_id: shopId });
  await knex('products').insert(payload);
  return getProduct(shopId, id);
}

export async function updateProduct(shopId, id, data) {
  const existing = await getProduct(shopId, id);
  await assertProductCodeNumberAvailable(shopId, { ...existing, ...data }, id);
  const payload = toDBRow({ ...data, id, shop_id: shopId });
  delete payload.id;
  payload.updated_at = knex.fn.now();
  await knex('products').where({ id, shop_id: shopId }).update(payload);
  const after = await getProduct(shopId, id);
  return { before: existing, after };
}

function formatDeactivateBlockedMessage(blockers) {
  if (!blockers?.length) return 'Cannot deactivate product — active booking exists';
  if (blockers.length === 1) {
    const b = blockers[0];
    const label = b.name || b.code || 'Product';
    const ref = b.order_number || b.order_id || '';
    return ref
      ? `Cannot deactivate ${label} — product is on active booking ${ref}`
      : `Cannot deactivate ${label} — product is on an active booking`;
  }
  const parts = blockers.map((b) => {
    const label = b.name || b.code || 'Product';
    const ref = b.order_number || b.order_id || '';
    return ref ? `${label} (booking ${ref})` : label;
  });
  return `Cannot deactivate ${parts.join('; ')}`;
}

/** One blocking active booking per product (earliest pickup_date). */
async function listProductDeactivateBlockers(shopId, productIds) {
  if (!productIds?.length) return [];
  const rows = await knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .join('products as p', 'p.id', 'oi.product_id')
    .where('o.shop_id', shopId)
    .whereIn('oi.product_id', productIds)
    .whereIn('o.status', BLOCKING_ORDER_STATUSES)
    .andWhere('o.is_deleted', false)
    .orderBy('o.pickup_date')
    .select(
      'oi.product_id as product_id',
      'p.code as code',
      'p.name as name',
      'o.id as order_id',
      'o.order_number as order_number',
      'o.bill_no as bill_no'
    );

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    seen.add(row.product_id);
    const bookingRef = row.order_number || row.bill_no || row.order_id || '';
    out.push({
      product_id: row.product_id,
      id: row.product_id,
      code: row.code,
      name: row.name,
      order_id: row.order_id,
      order_number: bookingRef,
      reason: bookingRef
        ? `Product is on active booking ${bookingRef}`
        : 'Product is on an active booking or order',
    });
  }
  return out;
}

export async function deleteProduct(shopId, id, mode = 'deactivate') {
  return deleteCatalogItem(knex, { shopId, id, kind: 'product', mode });
}

export async function bulkDeactivateProducts(shopId, ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) throw badRequest('No products selected');

  const rows = await knex('products')
    .where({ shop_id: shopId, is_active: true })
    .whereIn('id', uniqueIds)
    .select('*');

  if (!rows.length) throw badRequest('No matching active products');

  const matchedIds = rows.map((r) => r.id);
  const blockers = await listProductDeactivateBlockers(shopId, matchedIds);
  const blockingIds = new Set(blockers.map((b) => b.product_id));
  const safeIds = matchedIds.filter((pid) => !blockingIds.has(pid));
  const blocked = blockers.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    order_number: b.order_number,
    reason: b.reason,
  }));

  if (!safeIds.length) throw badRequest(formatDeactivateBlockedMessage(blockers));

  const safeRows = rows.filter((r) => safeIds.includes(r.id));
  await knex('products')
    .where({ shop_id: shopId })
    .whereIn('id', safeIds)
    .update({ is_active: false, updated_at: knex.fn.now() });

  return {
    deactivated: safeIds.length,
    skipped_blocked: blocked.length,
    blocked,
    products: safeRows,
  };
}

export async function bulkActivateProducts(shopId, ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) throw badRequest('No products selected');

  const rows = await knex('products')
    .where({ shop_id: shopId, is_active: false })
    .whereIn('id', uniqueIds)
    .select('*');

  if (!rows.length) throw badRequest('No matching inactive products');

  const matchedIds = rows.map((r) => r.id);
  await knex('products')
    .where({ shop_id: shopId })
    .whereIn('id', matchedIds)
    .update({ is_active: true, updated_at: knex.fn.now() });

  return { activated: matchedIds.length, products: rows };
}

export function parseBulkDeleteProductCodes(input = {}) {
  const raw = [];
  if (Array.isArray(input.codes)) {
    for (const code of input.codes) {
      const parts = String(code || '')
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      raw.push(...parts);
    }
  }
  if (input.csv_text) {
    raw.push(...parseBulkDeleteCodesFromCsv(input.csv_text));
  }
  const normalized = [...new Set(raw.map((c) => normalizeProductCode(c)).filter(Boolean))];
  if (!normalized.length) throw badRequest('No product codes provided');
  if (normalized.length > 500) throw badRequest('Maximum 500 codes per request');
  return normalized;
}

export async function previewBulkDeleteProductsByCode(shopId, input) {
  const codes = parseBulkDeleteProductCodes(input);
  const products = await knex('products')
    .where({ shop_id: shopId })
    .whereIn('code', codes)
    .select('id', 'code', 'name', 'qty', 'is_active', 'status');

  const productByCode = new Map(products.map((p) => [normalizeProductCode(p.code), p]));
  const blockers = await catalogPermanentDeleteBlockers(knex, shopId, 'product', products);

  const deletable = [];
  const blocked = [];
  const not_found = [];

  for (const code of codes) {
    const product = productByCode.get(code);
    if (!product) {
      not_found.push(code);
      continue;
    }
    const row = {
      id: product.id,
      code: product.code,
      name: product.name,
      qty: product.qty,
      is_active: product.is_active,
    };
    if (blockers.has(product.id)) {
      blocked.push({
        ...row,
        reason: blockers.get(product.id),
      });
    } else {
      deletable.push(row);
    }
  }

  return {
    summary: {
      requested: codes.length,
      deletable: deletable.length,
      blocked: blocked.length,
      not_found: not_found.length,
    },
    deletable,
    blocked,
    not_found,
  };
}

export async function bulkHardDeleteProductsByCode(shopId, input) {
  const preview = await previewBulkDeleteProductsByCode(shopId, input);
  const ids = preview.deletable.map((d) => d.id);
  if (!ids.length) {
    return {
      deleted: 0,
      skipped_blocked: preview.blocked.length,
      products: [],
      summary: preview.summary,
      blocked: preview.blocked,
      not_found: preview.not_found,
    };
  }
  const result = await hardDeleteProductsByIds(shopId, ids);
  const blocked = [...preview.blocked, ...(result.blocked || [])];
  return {
    ...result,
    skipped_blocked: blocked.length,
    summary: { ...preview.summary, deletable: result.deleted, blocked: blocked.length },
    blocked,
    not_found: preview.not_found,
  };
}

export async function hardDeleteProductsByIds(shopId, ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) throw badRequest('No products selected');
  return knex.transaction(async (trx) => {
    const rows = await trx('products').where({ shop_id: shopId }).whereIn('id', uniqueIds)
      .orderBy('id').forUpdate().select('*');
    const blockers = await catalogPermanentDeleteBlockers(trx, shopId, 'product', rows);
    const products = rows.filter((row) => !blockers.has(row.id));
    const blocked = rows.filter((row) => blockers.has(row.id)).map((row) => ({
      id: row.id, code: row.code, name: row.name, reason: blockers.get(row.id),
    }));
    let deleted = 0;
    if (products.length) {
      deleted = await trx('products').where({ shop_id: shopId, is_active: false })
        .whereIn('id', products.map((row) => row.id)).del();
    }
    return { deleted, skipped_blocked: blocked.length, skipped_not_found: uniqueIds.length - rows.length, products, blocked };
  }, { isolationLevel: 'read committed' });
}

function parseBulkDeleteCodesFromCsv(csvText) {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l, idx, arr) => !(idx === arr.length - 1 && l.trim() === ''));
  if (!lines.length) return [];
  const headers = parseBulkDeleteCsvLine(lines[0]).map((h) =>
    String(h || '')
      .trim()
      .toLowerCase()
  );
  const codeIdx = headers.indexOf('code');
  const useIdx = codeIdx >= 0 ? codeIdx : 0;
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseBulkDeleteCsvLine(lines[i]);
    if (cols.every((c) => String(c || '').trim() === '')) continue;
    const value = cols[useIdx] !== undefined ? String(cols[useIdx]).trim() : '';
    if (value) out.push(value);
  }
  return out;
}

function parseBulkDeleteCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function getProductAccessoryMapping(shopId, productId) {
  const product = await knex('products')
    .where({ id: productId, shop_id: shopId, is_active: true })
    .first('id');
  if (!product) throw notFound('Product not found');

  const rows = await knex('product_accessories as pa')
    .join('accessories as a', 'a.id', 'pa.accessory_id')
    .where({
      'pa.product_id': productId,
      'a.shop_id': shopId,
      'a.is_active': true,
    })
    .orderBy('pa.display_order')
    .orderBy('a.name')
    .select(
      'pa.accessory_id',
      'a.name',
      'a.image_url',
      'pa.is_recommended',
      'pa.is_required',
      'pa.display_order'
    );

  return {
    product_id: productId,
    accessories: rows.map((r) => ({
      accessory_id: r.accessory_id,
      name: r.name,
      image_url: r.image_url || null,
      is_recommended: !!r.is_recommended,
      is_required: !!r.is_required,
      display_order: Number(r.display_order || 0),
    })),
  };
}

export async function updateProductAccessoryMapping(shopId, productId, body) {
  const product = await knex('products')
    .where({ id: productId, shop_id: shopId, is_active: true })
    .first('id');
  if (!product) throw notFound('Product not found');

  const items = Array.isArray(body?.accessories) ? body.accessories : [];
  const accessoryIds = [
    ...new Set(items.map((i) => String(i.accessory_id || '').trim()).filter(Boolean)),
  ];

  if (accessoryIds.length !== items.length) {
    throw badRequest('Duplicate accessory in mapping');
  }

  if (accessoryIds.length > 0) {
    const valid = await knex('accessories')
      .where({ shop_id: shopId, is_active: true })
      .whereIn('id', accessoryIds)
      .pluck('id');
    if (valid.length !== accessoryIds.length) {
      throw badRequest('One or more accessories are invalid');
    }
  }

  await knex.transaction(async (trx) => {
    await trx('product_accessories').where({ product_id: productId }).del();
    if (items.length > 0) {
      await trx('product_accessories').insert(
        items.map((item, index) => ({
          id: uuid(),
          product_id: productId,
          accessory_id: item.accessory_id,
          is_recommended: item.is_recommended !== false,
          is_required: !!item.is_required,
          display_order: Number(item.display_order ?? index),
        }))
      );
    }
  });

  return getProductAccessoryMapping(shopId, productId);
}

export async function getProductRelatedMapping(shopId, productId) {
  const product = await knex('products')
    .where({ id: productId, shop_id: shopId, is_active: true })
    .first('id');
  if (!product) throw notFound('Product not found');

  const rows = await knex('product_related_products as pr')
    .join('products as p', 'p.id', 'pr.related_product_id')
    .where({
      'pr.product_id': productId,
      'pr.shop_id': shopId,
      'p.shop_id': shopId,
      'p.is_active': true,
    })
    .orderBy('pr.display_order')
    .orderBy('p.name')
    .select(
      'pr.related_product_id',
      'p.name',
      'p.code',
      'p.main_image',
      'p.category_id',
      'p.type',
      'p.price_rent',
      'p.price_sell',
      'pr.is_recommended',
      'pr.is_required',
      'pr.display_order'
    );

  return {
    product_id: productId,
    products: rows.map((r) => ({
      related_product_id: r.related_product_id,
      name: r.name,
      code: r.code,
      main_image: r.main_image || null,
      category_id: r.category_id || null,
      type: r.type,
      price_rent: Number(r.price_rent || 0),
      price_sell: Number(r.price_sell || 0),
      is_recommended: !!r.is_recommended,
      is_required: !!r.is_required,
      display_order: Number(r.display_order || 0),
    })),
  };
}

export async function updateProductRelatedMapping(shopId, productId, body) {
  const product = await knex('products')
    .where({ id: productId, shop_id: shopId, is_active: true })
    .first('id');
  if (!product) throw notFound('Product not found');

  const items = Array.isArray(body?.products) ? body.products : [];
  const relatedIds = [
    ...new Set(items.map((i) => String(i.related_product_id || '').trim()).filter(Boolean)),
  ];

  if (relatedIds.length !== items.length) {
    throw badRequest('Duplicate related product in mapping');
  }
  if (relatedIds.includes(String(productId))) {
    throw badRequest('A product cannot be related to itself');
  }

  if (relatedIds.length > 0) {
    const valid = await knex('products')
      .where({ shop_id: shopId, is_active: true })
      .whereIn('id', relatedIds)
      .pluck('id');
    if (valid.length !== relatedIds.length) {
      throw badRequest('One or more related products are invalid');
    }
  }

  await knex.transaction(async (trx) => {
    await trx('product_related_products').where({ product_id: productId, shop_id: shopId }).del();
    if (items.length > 0) {
      await trx('product_related_products').insert(
        items.map((item, index) => ({
          id: uuid(),
          shop_id: shopId,
          product_id: productId,
          related_product_id: item.related_product_id,
          is_recommended: item.is_recommended !== false,
          is_required: !!item.is_required,
          display_order: Number(item.display_order ?? index),
        }))
      );
    }
  });

  return getProductRelatedMapping(shopId, productId);
}

/** Related products for booking auto-add (recommended or required). */
export async function listRelatedProductsForBooking(shopId, productId) {
  const mapping = await getProductRelatedMapping(shopId, productId);
  return (mapping.products || []).filter((p) => p.is_recommended || p.is_required);
}

function toDBRow(data) {
  const row = { ...data };
  if (row.name != null && String(row.name).trim() !== '') {
    row.name = normalizeProductName(row.name);
  }
  if (row.code != null && String(row.code).trim() !== '') {
    row.code = resolveFullProductCode(row.code, row.size);
  }
  if (Array.isArray(row.photos)) row.photos = JSON.stringify(row.photos);
  return row;
}

function normalizeCodeFormatPrefix(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
    .slice(0, 40);
}

function parseJSONSafe(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildActiveRentCountExpr(productAlias) {
  return knex.raw(
    `COALESCE((
      SELECT SUM(oi.qty)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
        AND o.is_deleted = false
        AND o.status <> 'cancelled'
      WHERE oi.product_id = ${productAlias}.id
        AND oi.shop_id = ${productAlias}.shop_id
        AND oi.type = 'rent'
    ), 0) as count`
  );
}

function normalizeCodeFormatStored(stored) {
  const padding =
    Number.isInteger(stored?.padding) && stored.padding > 0
      ? stored.padding
      : DEFAULT_CODE_FORMAT.padding;
  const defaultPrefix =
    typeof stored?.default_prefix === 'string'
      ? stored.default_prefix
      : typeof stored?.prefix === 'string'
        ? stored.prefix
        : DEFAULT_CODE_FORMAT.default_prefix;
  const byCategoryRaw =
    stored?.by_category && typeof stored.by_category === 'object' ? stored.by_category : {};
  const by_category = {};
  for (const [catId, val] of Object.entries(byCategoryRaw)) {
    if (typeof val === 'string') by_category[String(catId)] = val.trim().slice(0, 40);
  }
  return {
    padding,
    default_prefix: defaultPrefix.trim().slice(0, 40),
    by_category,
  };
}

/** @param {ReturnType<typeof normalizeCodeFormatStored>} fmt */
export function resolveProductCodePrefix(fmt, categoryId) {
  if (categoryId && fmt.by_category?.[categoryId]) {
    return fmt.by_category[categoryId];
  }
  return fmt.default_prefix || '';
}

async function maxProductCodeNumberForPrefix(shopId, prefix, padding, categoryId = null) {
  const p = String(prefix ?? '').trim();
  if (!p) return 0;
  let qb = knex('products').where({ shop_id: shopId }).andWhere('code', 'like', `${p}%`);
  if (categoryId) qb = qb.andWhere({ category_id: categoryId });

  const rows = await qb.select('code');
  let max = 0;
  for (const row of rows) {
    const n = productCodeNumberFromStored(row.code, p, padding);
    if (n > max) max = n;
  }
  return max;
}

async function fetchProductCodeWithNumber(shopId, categoryId, prefix, padding, targetNumber) {
  const num = Math.floor(Number(targetNumber) || 0);
  const p = String(prefix ?? '').trim();
  if (!p || num <= 0) return null;

  let qb = knex('products').where({ shop_id: shopId }).andWhere('code', 'like', `${p}%`);
  if (categoryId) qb = qb.andWhere({ category_id: categoryId });
  const rows = await qb.select('code').orderBy('created_at', 'desc');
  for (const row of rows) {
    if (productCodeNumberFromStored(row.code, p, padding) === num) {
      return normalizeProductCode(row.code);
    }
  }
  return null;
}

async function resolveNextAvailableProductCodeNumber(shopId, prefix, padding, categoryId) {
  const max = await maxProductCodeNumberForPrefix(shopId, prefix, padding, categoryId);
  let next = Math.max(0, max) + 1;
  while (
    await findProductCodeNumberConflict(shopId, {
      prefix,
      padding,
      number: next,
      categoryId,
    })
  ) {
    next += 1;
  }
  return { max, next };
}

async function findProductCodeNumberConflict(
  shopId,
  { prefix, padding, number, categoryId, excludeProductId, size }
) {
  const num = Math.floor(Number(number));
  const p = String(prefix ?? '').trim();
  if (!Number.isFinite(num) || num <= 0 || !p) return null;

  let qb = knex('products').where({ shop_id: shopId }).andWhere('code', 'like', `${p}%`);
  if (categoryId) qb = qb.andWhere({ category_id: categoryId });
  if (excludeProductId) qb = qb.whereNot({ id: excludeProductId });

  // When size is provided, only same number + size conflicts (A-668[36] ≠ A-668[38]).
  // When omitted, any product with that number conflicts (next-code sequencing).
  const sizeFilter = size !== undefined && size !== null ? String(size).trim().toUpperCase() : null;

  const rows = await qb.select('id', 'code');
  for (const row of rows) {
    const parsed = parseProductCode(row.code, p, padding);
    const stored = parsed?.number ?? productCodeNumberFromStored(row.code, p, padding);
    if (stored !== num) continue;
    if (sizeFilter !== null) {
      const codeSize = String(parsed?.size ?? '')
        .trim()
        .toUpperCase();
      if (codeSize !== sizeFilter) continue;
    }
    return {
      number: num,
      existing_code: normalizeProductCode(row.code),
      product_id: row.id,
    };
  }
  return null;
}

async function assertProductCodeNumberAvailable(shopId, data, excludeProductId = null) {
  const fmt = await getProductCodeFormat(shopId);
  const categoryId = data.category_id || null;
  const prefix = resolveProductCodePrefix(fmt, categoryId);
  if (!prefix) return;
  const padding = fmt.padding;
  const code = resolveFullProductCode(data.code, data.size);
  const number = productCodeNumberFromStored(code, prefix, padding);
  if (!number) return;
  const parsed = parseProductCode(code, prefix, padding);
  const size = parsed?.size ?? String(data.size ?? '').trim();

  const conflict = await findProductCodeNumberConflict(shopId, {
    prefix,
    padding,
    number,
    categoryId,
    excludeProductId,
    size,
  });
  if (conflict) {
    throw badRequest(
      conflict.existing_code
        ? `Product number ${number} already exists (${conflict.existing_code}).`
        : `Product number ${number} already exists.`
    );
  }
}

export async function checkProductCodeNumberTaken(
  shopId,
  { categoryId = null, number, excludeProductId = null, size }
) {
  const fmt = await getProductCodeFormat(shopId);
  const prefix = resolveProductCodePrefix(fmt, categoryId);
  if (!prefix) {
    return { taken: false, number: Math.floor(Number(number) || 0), existing_code: null };
  }
  const conflict = await findProductCodeNumberConflict(shopId, {
    prefix,
    padding: fmt.padding,
    number,
    categoryId,
    excludeProductId,
    size: size !== undefined && size !== null ? size : '',
  });
  return {
    taken: Boolean(conflict),
    number: Math.floor(Number(number) || 0),
    existing_code: conflict?.existing_code || null,
  };
}

export async function getProductCodeFormat(shopId) {
  const row = await knex('settings').where({ shop_id: shopId, key: CODE_FORMAT_KEY }).first();
  const stored = parseJSONSafe(row?.value);
  const fmt = normalizeCodeFormatStored(stored || {});
  return { ...fmt, is_custom: !!stored };
}

export async function updateProductCodeFormat(shopId, data) {
  const byCategoryIn =
    data?.by_category && typeof data.by_category === 'object' ? data.by_category : {};
  const by_category = {};
  for (const [catId, val] of Object.entries(byCategoryIn)) {
    by_category[String(catId)] = normalizeCodeFormatPrefix(val);
  }
  const payload = {
    default_prefix: normalizeCodeFormatPrefix(data?.default_prefix ?? ''),
    padding: Math.max(1, Math.min(10, Number(data?.padding) || DEFAULT_CODE_FORMAT.padding)),
    by_category,
  };
  const existing = await knex('settings').where({ shop_id: shopId, key: CODE_FORMAT_KEY }).first();
  const rowPayload = { value: JSON.stringify(payload), updated_at: knex.fn.now() };
  if (existing) {
    await knex('settings').where({ id: existing.id }).update(rowPayload);
  } else {
    await knex('settings').insert({
      id: uuid(),
      shop_id: shopId,
      key: CODE_FORMAT_KEY,
      ...rowPayload,
    });
  }
  return { ...payload, is_custom: true };
}

/** Highest code number in category and the next available number. */
export async function getLastProductCodeForCategory(shopId, categoryId) {
  if (!categoryId)
    return { code: null, max_number: null, prefix: '', padding: 4, next_number: null };
  const fmt = await getProductCodeFormat(shopId);
  const prefix = resolveProductCodePrefix(fmt, categoryId);
  const padding = fmt.padding;

  if (!prefix) {
    return { code: null, max_number: null, prefix: '', padding, next_number: null };
  }

  const { max, next } = await resolveNextAvailableProductCodeNumber(
    shopId,
    prefix,
    padding,
    categoryId
  );
  const code =
    max > 0 ? await fetchProductCodeWithNumber(shopId, categoryId, prefix, padding, max) : null;

  return { code, max_number: max || null, prefix, padding, next_number: next };
}

export async function generateNextProductCode(shopId, categoryId = null, size = '') {
  const fmt = await getProductCodeFormat(shopId);
  const prefix = resolveProductCodePrefix(fmt, categoryId);
  const padding = fmt.padding;

  if (categoryId && !prefix) {
    throw badRequest(
      'Configure a prefix for this category in Code format (Configuration → Code format).'
    );
  }

  const { next } = await resolveNextAvailableProductCodeNumber(shopId, prefix, padding, categoryId);
  const code = normalizeProductCode(buildProductCode(prefix, next, padding, size));

  return { code, prefix, padding, next_number: next };
}

/**
 * Apply the overlap-in-range condition to an order-items-join-orders query.
 * An order reserves a product between `pickup_date` and `return_date`
 * (inclusive). When `return_date` is NULL we treat the order as a single-day
 * reservation on `pickup_date`. Two ranges [a,b] and [x,y] overlap iff
 * `a <= y` AND `b >= x`.
 */
function applyRentalOverlap(qb, shopId, from, to) {
  applyStalePreDeliveryRelease(qb, 'o');
  return qb
    .where('oi.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .andWhere('oi.type', 'rent')
    .whereIn('o.status', BLOCKING_ORDER_STATUSES)
    .andWhereRaw(
      'DATE_SUB(o.pickup_date, INTERVAL COALESCE(o.previous_booking_gap_days, 0) DAY) <= ?',
      [to]
    )
    .andWhereRaw(
      'DATE_ADD(COALESCE(o.return_date, o.pickup_date), INTERVAL COALESCE(o.next_booking_gap_days, 0) DAY) >= ?',
      [from]
    );
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Check availability for a single product (by code or id) over a date range.
 *
 * Returns the product row, total qty on hand, booked qty overlapping the
 * window, free qty, and the list of conflicting orders so the UI can show
 * *who* has the product booked.
 */
export async function checkProductAvailability(shopId, params) {
  const { code, product_id: productId, qty = 1 } = params;
  const from = params.from;
  const to = params.to;
  if (!isValidDate(from) || !isValidDate(to)) {
    throw badRequest('from and to must be YYYY-MM-DD dates');
  }
  if (from > to) throw badRequest('from must be on or before to');
  if (!code && !productId) throw badRequest('Provide product code or id');

  const pq = knex('products as p')
    .where({ 'p.shop_id': shopId, 'p.is_active': true })
    .select('p.*', buildActiveRentCountExpr('p'));
  let product;
  if (productId) {
    product = await pq.andWhere({ 'p.id': productId }).first();
  } else {
    const resolved = await findProductByCodeOrSearch(knex, shopId, String(code).trim());
    if (resolved) {
      product = await pq.andWhere({ 'p.id': resolved.id }).first();
    }
  }
  if (!product) throw notFound('Product not found');
  const excludeOrderId = params.exclude_order_id ? String(params.exclude_order_id).trim() : null;
  const conflictsQb = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oi.product_id', product.id);
  applyRentalOverlap(conflictsQb, shopId, from, to);
  if (excludeOrderId) conflictsQb.andWhere('o.id', '!=', excludeOrderId);

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
        'o.next_booking_gap_days',
        'o.previous_booking_gap_days',
        'oi.id as order_item_id',
        'oi.qty as booked_qty',
        'c.id as customer_id',
        'c.name as customer_name',
        'c.phone1 as customer_phone'
      ),
    knex('washing_queue as wq')
      .leftJoin('orders as o', 'o.id', 'wq.order_id')
      .where({ 'wq.product_id': product.id, 'wq.shop_id': shopId })
      .orderBy('wq.queued_at', 'desc')
      .select(
        'wq.id',
        'wq.qty',
        'wq.order_id',
        'wq.order_item_id',
        'wq.queued_at',
        'o.order_number'
      ),
    knex('laundry_job_products as ljp')
      .join('laundry_jobs as lj', 'lj.id', 'ljp.laundry_job_id')
      .where({
        'ljp.product_id': product.id,
        'ljp.shop_id': shopId,
        'ljp.status': 'in_washing',
      })
      .orderBy('lj.laundry_date', 'desc')
      .select(
        'ljp.id as line_id',
        'ljp.qty',
        'lj.id as laundry_job_id',
        'lj.job_no',
        'lj.laundry_date',
        'lj.vendor_name',
        'lj.pickup_by',
        'lj.status as job_status'
      ),
  ]);

  const bookedQty = conflicts.reduce((sum, r) => sum + Number(r.booked_qty || 0), 0);
  const totalQty = Number(product.qty || 0);

  const washingQueueQty = washingQueueRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const laundryWashingQty = laundryWashingRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const washingQty = washingQueueQty + laundryWashingQty;

  const freeQty = Math.max(0, totalQty - bookedQty - washingQty);
  const requested = Math.max(1, Number(qty) || 1);
  const includeUpcoming = params.include_upcoming !== false && params.include_upcoming !== 'false';
  const upcoming_bookings = includeUpcoming
    ? await listUpcomingBookingsForProduct(shopId, product.id)
    : [];

  return {
    product: {
      id: product.id,
      name: product.name,
      code: product.code,
      main_image: product.main_image,
      lifetime_gap: Number(product.lifetime_gap || 0),
      count: Number(product.count || 0),
      color: product.color,
      size: product.size,
      type: product.type,
      status: product.status,
      price_rent: Number(product.price_rent || 0),
      price_sell: Number(product.price_sell || 0),
    },
    from,
    to,
    total_qty: totalQty,
    booked_qty: bookedQty,
    washing_qty: washingQty,
    washing_queue_qty: washingQueueQty,
    laundry_washing_qty: laundryWashingQty,
    washing_queue: washingQueueRows.map((row) => ({
      id: row.id,
      qty: Number(row.qty || 0),
      order_id: row.order_id || null,
      order_item_id: row.order_item_id || null,
      order_number: row.order_number || null,
      queued_at: row.queued_at || null,
    })),
    laundry_washing: laundryWashingRows.map((row) => ({
      line_id: row.line_id,
      qty: Number(row.qty || 0),
      laundry_job_id: row.laundry_job_id,
      job_no: row.job_no,
      laundry_date: row.laundry_date,
      vendor_name: row.vendor_name || null,
      pickup_by: row.pickup_by || null,
      job_status: row.job_status || 'open',
    })),
    free_qty: freeQty,
    requested_qty: requested,
    available: freeQty >= requested,
    upcoming_bookings,
    conflicts: conflicts.map((c) => ({
      ...c,
      booked_qty: Number(c.booked_qty || 0),
    })),
  };
}

function isRentProductOrderLine(item) {
  if (!item || item.item_type === 'accessory') return false;
  const type = String(item.type || 'rent').toLowerCase();
  if (type === 'sell') return false;
  return Boolean(item.product_id);
}

function isSellProductOrderLine(item) {
  if (!item || item.item_type === 'accessory') return false;
  const type = String(item.type || 'rent').toLowerCase();
  if (type !== 'sell') return false;
  return Boolean(item.product_id);
}

const SELL_PRODUCT_BLOCKED_STATUSES = new Set(['repair', 'lost', 'sold']);

const SELL_BOOKING_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatBookingDateForSellMessage(isoDate) {
  const s = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '';
  const [y, m, d] = s.split('-');
  const month = SELL_BOOKING_MONTHS[Number(m) - 1] || m;
  return `${Number(d)}-${month}-${y}`;
}

function formatSellBlockedByBookingMessage(label, conflict) {
  const datePart = formatBookingDateForSellMessage(conflict?.pickup_date);
  const billPart =
    String(conflict?.order_number || '').trim() ||
    (conflict?.bill_no != null && conflict?.bill_no !== '' ? String(conflict.bill_no) : '');
  const suffix = [datePart, billPart].filter(Boolean).join(' · ');
  return suffix
    ? `${label} cannot be sold because it is already booked (${suffix})`
    : `${label} cannot be sold because it is already booked`;
}

/**
 * Active rent reservations that block selling a product outright.
 * @param {string} shopId
 * @param {string} productId
 * @param {string|null} [excludeOrderId]
 */
export async function listActiveRentBookingsForProduct(shopId, productId, excludeOrderId = null) {
  const qb = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where({ 'oi.shop_id': shopId, 'oi.product_id': productId, 'oi.type': 'rent' })
    .where('o.is_deleted', false)
    .whereIn('o.status', BLOCKING_ORDER_STATUSES);
  applyStalePreDeliveryRelease(qb, 'o');
  const exclude = excludeOrderId ? String(excludeOrderId).trim() : '';
  if (exclude) qb.andWhere('o.id', '!=', exclude);
  return qb
    .orderBy('o.pickup_date')
    .select(
      'o.id as order_id',
      'o.order_number',
      'o.bill_no',
      'o.pickup_date',
      'o.return_date',
      'oi.qty as booked_qty',
      'c.name as customer_name'
    );
}

/**
 * @param {string} shopId
 * @param {string} productId
 * @param {string} label
 * @param {string|null} [excludeOrderId]
 */
export async function assertProductNotBookedForSell(
  shopId,
  productId,
  label,
  excludeOrderId = null
) {
  const conflicts = await listActiveRentBookingsForProduct(shopId, productId, excludeOrderId);
  if (conflicts.length === 0) return;
  throw badRequest(formatSellBlockedByBookingMessage(label, conflicts[0]));
}

/**
 * @param {string} shopId
 * @param {{ product_id?: string, exclude_order_id?: string }} params
 */
export async function checkProductSellAvailability(shopId, params) {
  const productId = params.product_id ? String(params.product_id).trim() : '';
  if (!productId) throw badRequest('product_id is required');
  const excludeOrderId = params.exclude_order_id ? String(params.exclude_order_id).trim() : null;

  const product = await knex('products')
    .where({ id: productId, shop_id: shopId, is_active: true })
    .first('id', 'name', 'code', 'status');
  if (!product) throw notFound('Product not found');

  const label = product.name || product.code || 'Product';
  const status = String(product.status || 'available').toLowerCase();
  const conflicts = await listActiveRentBookingsForProduct(shopId, productId, excludeOrderId);

  let message = '';
  if (SELL_PRODUCT_BLOCKED_STATUSES.has(status)) {
    message = `${label} cannot be sold (status: ${status})`;
  } else if (conflicts.length > 0) {
    message = formatSellBlockedByBookingMessage(label, conflicts[0]);
  }

  return {
    available: !SELL_PRODUCT_BLOCKED_STATUSES.has(status) && conflicts.length === 0,
    conflicts,
    message,
    product: { id: product.id, name: product.name, code: product.code, status },
  };
}

/**
 * Ensure all rent product lines fit availability for the order date window.
 * @param {string} shopId
 * @param {{ from: string, to: string, items: object[], excludeOrderId?: string|null }} opts
 */
export async function assertRentProductLinesAvailable(shopId, opts) {
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

  const rentLines = items.filter(isRentProductOrderLine);
  if (rentLines.length === 0) return;

  const results = await Promise.all(
    rentLines.map((item) => {
      const qty = Math.max(1, Number(item.qty) || 1);
      return checkProductAvailability(shopId, {
        product_id: item.product_id,
        from,
        to,
        qty,
        include_upcoming: false,
        ...(excludeOrderId ? { exclude_order_id: excludeOrderId } : {}),
      }).then((result) => ({ item, qty, result }));
    })
  );

  for (const { item, qty, result } of results) {
    if (result.available) continue;
    const label =
      String(item.name_snapshot || '').trim() ||
      String(item.code_snapshot || '').trim() ||
      result.product?.name ||
      result.product?.code ||
      'Product';
    const status = String(result.product?.status || '').toLowerCase();
    if (status === 'sold') {
      throw badRequest(`${label} cannot be booked for rent because it is sold`);
    }
    const free = Number(result.free_qty || 0);
    throw badRequest(
      free > 0
        ? `${label}: requested ${qty}, only ${free} available for selected dates`
        : `${label} is not available for selected dates`
    );
  }
}

/**
 * Block reconcile when any booking product was sold after the booking was cancelled.
 * @param {string} shopId
 * @param {object[]} items — product order lines (rent or sell)
 */
export async function assertReconcileProductsNotSold(shopId, items) {
  const incoming = Array.isArray(items) ? items : [];
  const productLines = incoming.filter((item) => item.product_id && item.item_type !== 'accessory');
  if (productLines.length === 0) return;

  const productIds = [...new Set(productLines.map((item) => item.product_id))];
  const rows = await knex('products')
    .where({ shop_id: shopId, is_active: true })
    .whereIn('id', productIds)
    .select('id', 'name', 'code', 'status', 'qty');
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const item of productLines) {
    const row = byId.get(item.product_id);
    const label =
      String(item.name_snapshot || '').trim() ||
      String(item.code_snapshot || '').trim() ||
      row?.name ||
      row?.code ||
      'Product';
    if (!row) throw badRequest(`${label} not found`);
    const status = String(row.status || 'available').toLowerCase();
    if (status === 'sold') {
      throw badRequest(`${label} is already sold — this cancelled booking cannot be reconciled`);
    }
  }
}

/**
 * Ensure sell product lines have sufficient on-hand stock.
 * @param {string} shopId
 * @param {{ items: object[], excludeOrderId?: string|null }} opts
 */
export async function assertSellProductLinesAvailable(shopId, opts) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  const excludeOrderId = opts.excludeOrderId
    ? String(opts.excludeOrderId).trim()
    : opts.exclude_order_id
      ? String(opts.exclude_order_id).trim()
      : null;

  const demand = new Map();
  const labels = new Map();
  for (const item of items) {
    if (!isSellProductOrderLine(item)) continue;
    const id = item.product_id;
    const qty = Math.max(1, Number(item.qty) || 1);
    demand.set(id, (demand.get(id) || 0) + qty);
    if (!labels.has(id)) {
      const label =
        String(item.name_snapshot || '').trim() || String(item.code_snapshot || '').trim();
      if (label) labels.set(id, label);
    }
  }
  if (demand.size === 0) return;

  let prevSellByProduct = new Map();
  if (excludeOrderId) {
    const rows = await knex('order_items')
      .where({ order_id: excludeOrderId, shop_id: shopId, type: 'sell' })
      .whereNotNull('product_id')
      .groupBy('product_id')
      .select('product_id')
      .sum({ qty: 'qty' });
    prevSellByProduct = new Map(rows.map((r) => [r.product_id, Number(r.qty || 0)]));
  }

  for (const [productId, qty] of demand) {
    const row = await knex('products')
      .where({ id: productId, shop_id: shopId, is_active: true })
      .first('id', 'name', 'code', 'qty', 'status');
    const label = labels.get(productId) || row?.name || row?.code || 'Product';
    if (!row) throw badRequest(`${label} not found for sell item`);
    await assertProductNotBookedForSell(shopId, productId, label, excludeOrderId);
    const status = String(row.status || 'available').toLowerCase();
    if (SELL_PRODUCT_BLOCKED_STATUSES.has(status)) {
      throw badRequest(`${label} cannot be sold (status: ${status})`);
    }
    const prevReleased = prevSellByProduct.get(productId) || 0;
    const available = Number(row.qty || 0) + prevReleased;
    if (qty > available) {
      throw badRequest(
        available > 0
          ? `${label}: requested ${qty}, only ${available} in stock`
          : `${label} is out of stock`
      );
    }
  }
}

/**
 * Rent-line booking history for a single product (non-draft orders).
 * When `show_all` is false, only rows whose rental window ends today or later.
 */
export async function listProductRentalHistory(shopId, productId, query) {
  const showAll = query.show_all === true;

  const product = await knex('products as p')
    .where({ 'p.shop_id': shopId, 'p.id': productId, 'p.is_active': true })
    .first('p.id');
  if (!product) throw notFound('Product not found');

  const qb = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where('oi.shop_id', shopId)
    .andWhere('oi.product_id', productId)
    .andWhere('oi.type', 'rent')
    .andWhere('o.is_deleted', false)
    .whereNot('o.status', 'draft');

  if (!showAll) {
    qb.andWhereRaw('COALESCE(o.return_date, o.pickup_date) >= CURDATE()');
  }

  const rows = await qb
    .orderBy('o.pickup_date', 'desc')
    .orderBy('o.created_at', 'desc')
    .select(
      'o.id as order_id',
      'oi.id as order_item_id',
      'o.bill_no',
      'o.status',
      'o.pickup_date',
      'o.delivery_time',
      'o.return_date',
      'o.return_time',
      'oi.qty',
      'oi.line_total as rent',
      'c.name as customer_name',
      'c.phone1 as customer_phone',
      'c.address as customer_address'
    );

  return rows.map((r) => ({
    ...r,
    bill_no: Number(r.bill_no ?? 0),
    qty: Number(r.qty ?? 0),
    rent: Number(r.rent ?? 0),
  }));
}

function applySaleHistoryStandaloneDateFilter(qb, showAll, from, to) {
  if (showAll) return;
  const fromDate = String(from || '').slice(0, 10);
  const toDate = String(to || '').slice(0, 10);
  if (fromDate && isValidDate(fromDate)) qb.andWhere('s.sale_date', '>=', fromDate);
  if (toDate && isValidDate(toDate)) qb.andWhere('s.sale_date', '<=', toDate);
}

function applySaleHistoryBookingDateFilter(qb, showAll, from, to) {
  if (showAll) return;
  const fromDate = String(from || '').slice(0, 10);
  const toDate = String(to || '').slice(0, 10);
  if (fromDate && isValidDate(fromDate)) {
    qb.andWhereRaw('COALESCE(o.pickup_date, o.booking_date) >= ?', [fromDate]);
  }
  if (toDate && isValidDate(toDate)) {
    qb.andWhereRaw('COALESCE(o.pickup_date, o.booking_date) <= ?', [toDate]);
  }
}

/**
 * Sale history for a product: standalone sales and booking sell lines.
 * When `show_all` is false, optional from/to filter sale_date / pickup date.
 */
export async function listProductSaleHistory(shopId, productId, query) {
  const showAll = query.show_all === true;
  const from = query.from;
  const to = query.to;

  const product = await knex('products as p')
    .where({ 'p.shop_id': shopId, 'p.id': productId, 'p.is_active': true })
    .first('p.id');
  if (!product) throw notFound('Product not found');

  const saleQb = knex('sale_items as si')
    .join('sales as s', 's.id', 'si.sale_id')
    .where({ 'si.shop_id': shopId, 'si.product_id': productId })
    .whereNot('s.status', 'cancelled');
  applySaleHistoryStandaloneDateFilter(saleQb, showAll, from, to);

  const salesRows = await saleQb.select(
    'si.id as row_id',
    knex.raw("'sale' as source"),
    's.id as record_id',
    's.sale_number as bill_no',
    's.sale_date as event_date',
    knex.raw('NULL as event_time'),
    's.created_at as event_at',
    's.customer_name',
    's.contact_no as customer_phone',
    knex.raw('NULL as customer_address'),
    'si.qty',
    'si.total_amount as amount',
    's.status'
  );

  const bookingQb = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('customers as c', 'c.id', 'o.customer_id')
    .where({ 'oi.shop_id': shopId, 'oi.product_id': productId, 'oi.type': 'sell' })
    .andWhere('o.is_deleted', false)
    .whereNotIn('o.status', ['draft', 'cancelled']);
  applySaleHistoryBookingDateFilter(bookingQb, showAll, from, to);

  const bookingRows = await bookingQb.select(
    knex.raw("CONCAT('booking-', oi.id) as row_id"),
    knex.raw("'booking' as source"),
    'o.id as record_id',
    'o.order_number as bill_no',
    knex.raw('COALESCE(o.pickup_date, o.booking_date) as event_date'),
    knex.raw('COALESCE(o.delivery_time, o.booking_time) as event_time'),
    knex.raw('NULL as event_at'),
    knex.raw('COALESCE(o.pickup_name, c.name) as customer_name'),
    knex.raw('COALESCE(o.contact_phone1, c.phone1) as customer_phone'),
    'c.address as customer_address',
    'oi.qty',
    'oi.line_total as amount',
    'o.status'
  );

  const eventSortKey = (row) => {
    if (row.event_at) return String(row.event_at);
    const date = String(row.event_date || '');
    const time = String(row.event_time || '');
    return time ? `${date} ${time}` : date;
  };

  const combined = [...salesRows, ...bookingRows].sort((a, b) =>
    eventSortKey(b).localeCompare(eventSortKey(a))
  );

  return combined.map((r) => ({
    ...r,
    qty: Number(r.qty ?? 0),
    amount: Number(r.amount ?? 0),
  }));
}

/**
 * For the "check availability" grid: return every active product with its
 * booked-vs-free qty for the given date range.
 */
export async function listProductAvailability(shopId, params) {
  const from = params.from;
  const to = params.to;
  if (!isValidDate(from) || !isValidDate(to)) {
    throw badRequest('from and to must be YYYY-MM-DD dates');
  }
  if (from > to) throw badRequest('from must be on or before to');

  const overlapSub = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .groupBy('oi.product_id')
    .select('oi.product_id')
    .sum({ booked: 'oi.qty' });
  applyRentalOverlap(overlapSub, shopId, from, to);

  const washingSub = knex.raw(
    `(SELECT product_id, SUM(qty) as washing FROM (
      SELECT product_id, qty FROM washing_queue WHERE shop_id = ?
      UNION ALL
      SELECT product_id, qty FROM laundry_job_products WHERE status = 'in_washing'
    ) combined GROUP BY product_id) as ws`,
    [shopId]
  );

  const qb = knex('products as p')
    .leftJoin('categories as cat', 'cat.id', 'p.category_id')
    .leftJoin(overlapSub.as('bk'), 'bk.product_id', 'p.id')
    .leftJoin(washingSub, 'ws.product_id', 'p.id')
    .where({ 'p.shop_id': shopId, 'p.is_active': true });

  if (params.category_id === 'none') qb.whereNull('p.category_id');
  else if (params.category_id) qb.andWhere('p.category_id', params.category_id);
  if (params.status) qb.andWhere('p.status', params.status);
  if (params.type) qb.andWhere('p.type', params.type);
  if (params.size) qb.andWhere('p.size', params.size);
  if (params.color) qb.andWhere('p.color', params.color);
  const rentMinRaw = params.rent_min;
  const rentMaxRaw = params.rent_max;
  if (rentMinRaw != null && rentMinRaw !== '') {
    const rentMin = Number(rentMinRaw);
    if (Number.isFinite(rentMin)) qb.andWhere('p.price_rent', '>=', rentMin);
  }
  if (rentMaxRaw != null && rentMaxRaw !== '') {
    const rentMax = Number(rentMaxRaw);
    if (Number.isFinite(rentMax)) qb.andWhere('p.price_rent', '<=', rentMax);
  }
  const searchTerm = String(params.search || '').trim();
  if (searchTerm) {
    // Resolve code-like input the same way Check Availability does so padded /
    // size-suffixed codes (A-0795 vs A-795[40]) reliably match. The resolved
    // product is OR-ed alongside the loose text filter so every matching size
    // still shows. `available_only` below still hides fully-booked stock.
    let resolvedId = null;
    const classified = classifyProductSearchTerm(searchTerm);
    const codeLike = classified.mode !== 'text' || /\d/.test(searchTerm);
    if (codeLike) {
      const resolved = await findProductByCodeOrSearch(knex, shopId, searchTerm, {
        activeOnly: true,
      });
      resolvedId = resolved?.id || null;
    }
    qb.andWhere((w) => {
      w.where((sub) => {
        applyProductSearchFilter(sub, searchTerm, 'p');
      });
      if (resolvedId) w.orWhere('p.id', resolvedId);
    });
    applyProductSearchRanking(qb, searchTerm, 'p');
  }
  if (params.available_only === true || params.available_only === 'true') {
    qb.andWhereRaw('(p.qty - COALESCE(bk.booked, 0) - COALESCE(ws.washing, 0)) > 0');
  }

  qb.select(
    'p.id',
    'p.category_id',
    'cat.label as category_name',
    'p.name',
    'p.code',
    'p.main_image',
    'p.photos',
    'p.color',
    'p.size',
    'p.type',
    'p.status',
    'p.price_rent',
    'p.price_sell',
    'p.qty as total_qty',
    knex.raw('COALESCE(bk.booked, 0) as booked_qty'),
    knex.raw('COALESCE(ws.washing, 0) as washing_qty')
  );

  const page = Math.max(1, Number(params.page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(params.per_page) || 24));
  // Always pass a table-qualified sort. When a search term is present the
  // ranking CASE has already been applied and takes priority; `p.name` is a
  // safe tie-breaker. Passing undefined lets paginate fall back to a bare
  // `created_at`, which is ambiguous once `categories` is joined.
  const { data: rows, meta } = await paginate(qb, {
    page,
    per_page: perPage,
    sort: 'p.name',
  });

  return {
    data: rows.map((r) => {
      const total = Number(r.total_qty || 0);
      const booked = Number(r.booked_qty || 0);
      const washing = Number(r.washing_qty || 0);
      const free = Math.max(0, total - booked - washing);
      const photos = parseJSONSafe(r.photos) || [];
      const gallery = Array.isArray(photos)
        ? photos.map((u) => String(u || '').trim()).filter(Boolean)
        : [];
      return {
        ...r,
        code: resolveFullProductCode(r.code, r.size),
        price_rent: Number(r.price_rent || 0),
        price_sell: Number(r.price_sell || 0),
        total_qty: total,
        booked_qty: booked,
        washing_qty: washing,
        free_qty: free,
        available: free > 0,
        main_image: String(r.main_image || gallery[0] || '').trim(),
      };
    }),
    meta,
  };
}

/**
 * Fast booking search endpoint used by Create Booking:
 * - text search by name/code/barcode
 * - date-window stock buckets (booked / in delivery / return pending)
 * - quick next-available hint using return_date + gap_days
 */
export async function searchBookingAvailability(shopId, params = {}) {
  const from = params.from;
  const to = params.to;
  const qty = Math.max(1, Number(params.qty) || 1);
  if (!isValidDate(from) || !isValidDate(to)) {
    throw badRequest('from and to must be YYYY-MM-DD dates');
  }
  if (from > to) throw badRequest('from must be on or before to');

  const search = String(params.search || '').trim();
  const perPage = Math.min(100, Math.max(1, Number(params.per_page) || 20));

  const overlap = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .andWhere('oi.type', 'rent')
    .andWhereRaw(
      'DATE_SUB(o.pickup_date, INTERVAL COALESCE(o.previous_booking_gap_days, 0) DAY) <= ?',
      [to]
    )
    .andWhereRaw(
      'DATE_ADD(COALESCE(o.return_date, o.pickup_date), INTERVAL COALESCE(o.next_booking_gap_days, 0) DAY) >= ?',
      [from]
    );
  applyStalePreDeliveryRelease(overlap, 'o');
  overlap
    .groupBy('oi.product_id')
    .select('oi.product_id')
    .select(
      knex.raw(
        "SUM(CASE WHEN o.status IN ('booked','pending','confirmed','item_to_collect','in_preparation','ready_for_delivery') THEN oi.qty ELSE 0 END) as booked_qty"
      )
    )
    .select(
      knex.raw(
        "SUM(CASE WHEN o.status IN ('delivered','partially_returned') THEN oi.qty ELSE 0 END) as in_delivery_qty"
      )
    )
    .select(
      knex.raw(
        "SUM(CASE WHEN o.status IN ('delivered','partially_returned') THEN oi.qty ELSE 0 END) as return_pending_qty"
      )
    );

  const nextAvail = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .andWhere('oi.type', 'rent')
    .whereIn('o.status', BLOCKING_ORDER_STATUSES);
  applyStalePreDeliveryRelease(nextAvail, 'o');
  nextAvail
    .groupBy('oi.product_id')
    .select('oi.product_id')
    .select(
      knex.raw(
        'MAX(DATE_ADD(COALESCE(o.return_date, o.pickup_date), INTERVAL COALESCE(o.next_booking_gap_days, 0) DAY)) as next_available_date'
      )
    );

  const nextPickup = knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .andWhere('oi.type', 'rent')
    .whereIn('o.status', NEXT_PICKUP_STATUSES)
    .andWhere('o.pickup_date', '>=', from)
    .groupBy('oi.product_id')
    .select('oi.product_id')
    .select(knex.raw('MIN(o.pickup_date) as next_pickup_date'));

  const washingSub = knex.raw(
    `(SELECT product_id, SUM(qty) as washing FROM (
      SELECT product_id, qty FROM washing_queue WHERE shop_id = ?
      UNION ALL
      SELECT product_id, qty FROM laundry_job_products WHERE status = 'in_washing'
    ) combined GROUP BY product_id) as ws`,
    [shopId]
  );

  const qb = knex('products as p')
    .leftJoin(overlap.as('ov'), 'ov.product_id', 'p.id')
    .leftJoin(nextAvail.as('na'), 'na.product_id', 'p.id')
    .leftJoin(nextPickup.as('np'), 'np.product_id', 'p.id')
    .leftJoin(washingSub, 'ws.product_id', 'p.id')
    .where({ 'p.shop_id': shopId, 'p.is_active': true });

  if (params.category_id && String(params.category_id).trim() !== '') {
    qb.andWhere('p.category_id', String(params.category_id).trim());
  }

  if (search) {
    applyProductSearchFilter(qb, search, 'p');
    applyProductSearchRanking(qb, search, 'p');
  } else {
    qb.orderBy('p.name');
  }

  qb.limit(perPage).select(
    'p.id',
    'p.name',
    'p.code',
    'p.main_image',
    'p.category_id',
    'p.status',
    'p.qty as total_qty',
    'p.price_rent',
    'p.price_sell',
    knex.raw('COALESCE(ov.booked_qty, 0) as booked_qty'),
    knex.raw('COALESCE(ov.in_delivery_qty, 0) as in_delivery_qty'),
    knex.raw('COALESCE(ov.return_pending_qty, 0) as return_pending_qty'),
    knex.raw('COALESCE(ws.washing, 0) as washing_qty'),
    knex.raw('na.next_available_date as next_available_date'),
    knex.raw('np.next_pickup_date as next_pickup_date')
  );

  const rows = await qb;
  return rows.map((r) => {
    const total = Number(r.total_qty || 0);
    const booked = Number(r.booked_qty || 0);
    const inDelivery = Number(r.in_delivery_qty || 0);
    const washing = Number(r.washing_qty || 0);
    const repair = r.status === 'repair' ? total : 0;
    const blocked = booked + inDelivery + washing;
    const free = Math.max(0, total - blocked);
    return {
      ...r,
      total_qty: total,
      booked_qty: booked,
      in_delivery_qty: inDelivery,
      return_pending_qty: Number(r.return_pending_qty || 0),
      washing_qty: washing,
      repair_qty: repair,
      branch_stock_qty: total,
      free_qty: free,
      requested_qty: qty,
      available: free >= qty,
      can_book: free >= qty,
      next_available_date: r.next_available_date || null,
      next_pickup_date: r.next_pickup_date || null,
      price_rent: Number(r.price_rent || 0),
      price_sell: Number(r.price_sell || 0),
    };
  });
}

/**
 * Return all items currently in the washing queue (auto-added when
 * order items are marked received). The queue IS the source of truth.
 */
export async function listPendingWashing(shopId) {
  const rows = await knex('washing_queue as wq')
    .leftJoin('products as p', 'p.id', 'wq.product_id')
    .leftJoin('orders as o', 'o.id', 'wq.order_id')
    .where('wq.shop_id', shopId)
    .orderBy('wq.queued_at', 'desc')
    .select(
      'wq.id as queue_id',
      'wq.product_id as id',
      'wq.product_code',
      'wq.product_name',
      'wq.image_url',
      'wq.category_id',
      'wq.qty as pending_qty',
      'wq.queued_at',
      'wq.order_id',
      'o.order_number',
      'p.name as current_name',
      'p.code as current_code',
      'p.main_image as current_image',
      'p.qty as total_qty'
    );

  return rows.map((r) => ({
    queue_id: r.queue_id,
    id: r.id,
    name: r.product_name || r.current_name || '',
    code: r.product_code || r.current_code || '',
    main_image: r.image_url || r.current_image || '',
    category_id: r.category_id,
    total_qty: Number(r.total_qty || 0),
    pending_qty: Number(r.pending_qty || 1),
    queued_at: r.queued_at,
    order_id: r.order_id,
    order_number: r.order_number || null,
  }));
}

const INVENTORY_BOOKED_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
];
const INVENTORY_DELIVERED_STATUSES = ['delivered', 'partially_returned'];
const INVENTORY_RETURNED_STATUSES = ['returned', 'closed'];

const INVENTORY_DISPLAY_STATUS_CASE = `
  CASE
    WHEN LOWER(p.status) IN ('repair', 'sold', 'lost') THEN LOWER(p.status)
    WHEN COALESCE(ws.washing_qty, 0) > 0 THEN 'washing'
    WHEN COALESCE(dv.in_delivery_qty, 0) > 0 THEN 'delivered'
    WHEN COALESCE(bk.booked_qty, 0) > 0 THEN 'booked'
    WHEN COALESCE(rt.returned_qty, 0) > 0 THEN 'returned'
    ELSE 'available'
  END
`;

function attachInventoryQtyJoins(qb, shopId) {
  const bookedSub = buildInventoryOrderQtySubquery(shopId, INVENTORY_BOOKED_STATUSES, 'booked_qty');
  const deliveredSub = buildInventoryOrderQtySubquery(
    shopId,
    INVENTORY_DELIVERED_STATUSES,
    'in_delivery_qty'
  );
  const returnedSub = buildInventoryOrderQtySubquery(
    shopId,
    INVENTORY_RETURNED_STATUSES,
    'returned_qty'
  );
  const washingSub = buildInventoryWashingSubquery(shopId);
  qb.leftJoin(bookedSub.as('bk'), 'bk.product_id', 'p.id')
    .leftJoin(deliveredSub.as('dv'), 'dv.product_id', 'p.id')
    .leftJoin(returnedSub.as('rt'), 'rt.product_id', 'p.id')
    .leftJoin(washingSub, 'ws.product_id', 'p.id');
}

function applyInventoryLaneFilter(qb, lane) {
  const value = String(lane || '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all') return;
  qb.whereRaw(`(${INVENTORY_DISPLAY_STATUS_CASE}) = ?`, [value]);
}

function buildInventoryOrderQtySubquery(shopId, statuses, alias) {
  return knex('order_items as oi')
    .join('orders as o', 'o.id', 'oi.order_id')
    .where('oi.shop_id', shopId)
    .andWhere('o.is_deleted', false)
    .andWhere('oi.type', 'rent')
    .whereIn('o.status', statuses)
    .groupBy('oi.product_id')
    .select('oi.product_id')
    .sum({ [alias]: 'oi.qty' });
}

function buildInventoryWashingSubquery(shopId) {
  return knex.raw(
    `(SELECT product_id, SUM(qty) as washing_qty FROM (
      SELECT product_id, qty FROM washing_queue WHERE shop_id = ?
      UNION ALL
      SELECT product_id, qty FROM laundry_job_products WHERE shop_id = ? AND status = 'in_washing'
    ) combined GROUP BY product_id) as ws`,
    [shopId, shopId]
  );
}

function resolveInventoryDisplayStatus(row) {
  const status = String(row.status || 'available').toLowerCase();
  if (status === 'repair' || status === 'sold' || status === 'lost') return status;
  if (Number(row.washing_qty || 0) > 0) return 'washing';
  if (Number(row.in_delivery_qty || 0) > 0) return 'delivered';
  if (Number(row.booked_qty || 0) > 0) return 'booked';
  if (Number(row.returned_qty || 0) > 0) return 'returned';
  return 'available';
}

function matchesInventoryLane(row, lane) {
  if (!lane || lane === 'all') return true;
  const display = row.display_status || resolveInventoryDisplayStatus(row);
  return display === lane;
}

function countInventoryLane(rows, lane) {
  if (lane === 'all') return rows.length;
  return rows.filter((row) => matchesInventoryLane(row, lane)).length;
}

/**
 * Live inventory grid: qty buckets from active orders + washing queue, not only `products.status`.
 */
export async function listInventorySnapshot(shopId, params = {}) {
  const baseQb = () => {
    const qb = knex('products as p').where({ 'p.shop_id': shopId, 'p.is_active': true });
    attachInventoryQtyJoins(qb, shopId);

    const type = String(params.type || '').trim();
    if (type) qb.andWhere('p.type', type);

    const categoryId = String(params.category_id || '').trim();
    if (categoryId === 'none') qb.whereNull('p.category_id');
    else if (categoryId) qb.andWhere('p.category_id', categoryId);

    const size = String(params.size || '').trim();
    if (size) qb.andWhere('p.size', size);

    const color = String(params.color || '').trim();
    if (color) qb.andWhere('p.color', color);

    const search = String(params.search || '').trim();
    if (search) {
      const like = `%${search}%`;
      qb.andWhere((q) =>
        q
          .where('p.name', 'like', like)
          .orWhere('p.code', 'like', like)
          .orWhere('p.color', 'like', like)
          .orWhere('p.size', 'like', like)
      );
    }
    return qb;
  };

  const laneKeys = [
    'all',
    'available',
    'booked',
    'delivered',
    'returned',
    'washing',
    'repair',
    'sold',
    'lost',
  ];
  const counts = {};
  await Promise.all(
    laneKeys.map(async (laneKey) => {
      const qb = baseQb();
      if (laneKey !== 'all') applyInventoryLaneFilter(qb, laneKey);
      const row = await qb.clone().count({ c: 'p.id' }).first();
      counts[laneKey] = Number(row?.c || 0);
    })
  );

  const lane =
    String(params.lane || 'all')
      .trim()
      .toLowerCase() || 'all';
  const listQb = baseQb();
  if (lane !== 'all') applyInventoryLaneFilter(listQb, lane);
  listQb.select(
    'p.*',
    buildActiveRentCountExpr('p'),
    knex.raw('COALESCE(bk.booked_qty, 0) as booked_qty'),
    knex.raw('COALESCE(dv.in_delivery_qty, 0) as in_delivery_qty'),
    knex.raw('COALESCE(rt.returned_qty, 0) as returned_qty'),
    knex.raw('COALESCE(ws.washing_qty, 0) as washing_qty'),
    knex.raw(`(${INVENTORY_DISPLAY_STATUS_CASE}) as display_status`)
  );

  const page = Math.max(1, Number(params.page) || 1);
  const perPage = Math.min(500, Math.max(1, Number(params.per_page) || 500));
  const result = await paginate(listQb, {
    page,
    per_page: perPage,
    sort: 'p.name',
  });

  const data = result.data.map((r) => {
    const total = Number(r.qty || 0);
    const booked = Number(r.booked_qty || 0);
    const inDelivery = Number(r.in_delivery_qty || 0);
    const returned = Number(r.returned_qty || 0);
    const washing = Number(r.washing_qty || 0);
    const status = String(r.status || 'available').toLowerCase();
    const repairHold = status === 'repair' ? total : 0;
    const soldHold = status === 'sold' ? total : 0;
    const lostHold = status === 'lost' ? total : 0;
    const blocked = booked + inDelivery + returned + washing + repairHold + soldHold + lostHold;
    const free = Math.max(0, total - blocked);
    return {
      ...r,
      qty: total,
      booked_qty: booked,
      in_delivery_qty: inDelivery,
      returned_qty: returned,
      washing_qty: washing,
      free_qty: free,
      display_status:
        r.display_status ||
        resolveInventoryDisplayStatus({
          status,
          booked_qty: booked,
          in_delivery_qty: inDelivery,
          returned_qty: returned,
          washing_qty: washing,
        }),
    };
  });

  return {
    data,
    meta: result.meta,
    counts,
  };
}
