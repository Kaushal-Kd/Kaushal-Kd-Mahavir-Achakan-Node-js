import { badRequest, notFound } from '../utils/errors.js';

const CATALOG = {
  product: { table: 'products', lines: 'order_items', foreignKey: 'product_id', laundry: 'laundry_job_products', label: 'Product' },
  accessory: { table: 'accessories', lines: 'order_accessories', foreignKey: 'accessory_id', laundry: 'laundry_job_accessories', label: 'Accessory' },
};

function configFor(kind) {
  const config = CATALOG[kind];
  if (!config) throw badRequest('Invalid catalog item type');
  return config;
}

export function isCatalogItemActive(row) {
  return ![false, 0, '0'].includes(row?.is_active);
}

export async function catalogBookingDeleteBlockers(db, shopId, kind, ids) {
  if (!ids.length) return new Map();
  const config = configFor(kind);
  const rows = await db(`${config.lines} as line`)
    .join('orders as booking', 'booking.id', 'line.order_id')
    .where({ 'line.shop_id': shopId, 'booking.shop_id': shopId, 'booking.is_deleted': false })
    .whereIn(`line.${config.foreignKey}`, ids)
    .whereNotIn('booking.status', ['cancelled', 'returned', 'closed'])
    .orderBy('booking.pickup_date')
    .select(`line.${config.foreignKey} as catalog_id`, 'booking.order_number');
  const blockers = new Map();
  for (const row of rows) {
    if (!blockers.has(row.catalog_id)) blockers.set(row.catalog_id, `Active booking ${row.order_number || '(number unavailable)'} must be completed or changed first.`);
  }
  return blockers;
}

/** Every operational reference must survive; historical order snapshots remain after removal. */
export async function catalogPermanentDeleteBlockers(db, shopId, kind, rows) {
  const config = configFor(kind);
  const ids = rows.map((row) => row.id);
  if (!ids.length) return new Map();
  const blockers = new Map(rows.filter(isCatalogItemActive).map((row) => [row.id, 'Deactivate this item first, then delete it from the inactive section.']));
  for (const row of rows) {
    if (kind === 'product' && row.status === 'washing' && !blockers.has(row.id)) {
      blockers.set(row.id, 'This item is still in washing. Receive it back before permanent deletion.');
    }
  }
  const booking = await catalogBookingDeleteBlockers(db, shopId, kind, ids);
  const queued = await db('washing_queue').where({ shop_id: shopId }).whereIn(config.foreignKey, ids)
    .select(config.foreignKey);
  const washing = await db(config.laundry).where({ shop_id: shopId }).whereIn(config.foreignKey, ids)
    .andWhere((query) => {
      query.where('status', 'in_washing');
      if (kind === 'accessory') query.orWhereRaw('COALESCE(qty_returned, 0) < qty');
    }).select(config.foreignKey);
  for (const [id, reason] of booking) if (!blockers.has(id)) blockers.set(id, reason);
  for (const row of queued) if (!blockers.has(row[config.foreignKey])) blockers.set(row[config.foreignKey], 'This item is in the washing queue. Complete or review that work before permanent deletion.');
  for (const row of washing) if (!blockers.has(row[config.foreignKey])) blockers.set(row[config.foreignKey], 'This item is still in washing. Receive it back before permanent deletion.');
  return blockers;
}

/** A repeated deactivate request cannot promote itself to permanent deletion. */
export async function deleteCatalogItem(db, { shopId, id, kind, mode = 'deactivate' }) {
  const config = configFor(kind);
  if (!['deactivate', 'permanent'].includes(mode)) throw badRequest('Invalid catalog delete mode');
  return db.transaction(async (trx) => {
    const before = await trx(config.table).where({ id, shop_id: shopId }).forUpdate().first();
    if (!before) throw notFound(`${config.label} not found`);
    if (mode === 'deactivate') {
      if (isCatalogItemActive(before)) {
        if (kind === 'product') {
          const blockers = await catalogBookingDeleteBlockers(trx, shopId, kind, [id]);
          if (blockers.has(id)) throw badRequest(`Cannot deactivate ${config.label.toLowerCase()}. ${blockers.get(id)}`);
        }
        await trx(config.table).where({ id, shop_id: shopId }).update({ is_active: false, updated_at: trx.fn.now() });
      }
      return { before, mode: 'deactivated' };
    }
    const blockers = await catalogPermanentDeleteBlockers(trx, shopId, kind, [before]);
    if (blockers.has(id)) throw badRequest(`Cannot permanently delete ${config.label.toLowerCase()}. ${blockers.get(id)}`);
    await trx(config.table).where({ id, shop_id: shopId, is_active: false }).del();
    return { before, mode: 'permanently_deleted' };
  }, { isolationLevel: 'read committed' });
}
