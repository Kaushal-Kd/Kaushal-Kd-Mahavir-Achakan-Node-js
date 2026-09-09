import knex from '../../db/knex.js';
import { accessoryRentableQty } from '@wrs/shared';
import { applyStalePreDeliveryRelease } from '../../lib/rentalOverlap.js';
import { sqlStageFlagFalsy, sqlStageFlagTruthy } from '../../lib/stageFlagsSql.js';

/**
 * Rentable qty expression for SQL (total minus spare reserve and damaged stock).
 * @param {string} alias table alias for accessories
 */
export function accessoryRentableQtyExpr(alias = 'a') {
  return `GREATEST(0, ${alias}.qty - COALESCE(${alias}.spare_qty, 0) - COALESCE(${alias}.damaged_qty, 0))`;
}

/**
 * In-shop rentable qty expression (rentable minus physically out on orders).
 * @param {string} alias
 * @param {string} outAlias
 */
export function accessoryInShopQtyExpr(alias = 'a', outAlias = 'ao') {
  return `(GREATEST(0, ${accessoryRentableQtyExpr(alias)} - COALESCE(${outAlias}.out_qty, 0)))`;
}

export { accessoryRentableQty };

export const BLOCKING_ORDER_STATUSES = [
  'booked',
  'pending',
  'confirmed',
  'item_to_collect',
  'in_preparation',
  'ready_for_delivery',
  'delivered',
  'partially_returned',
];

/**
 * Date-overlap rent reservations on active orders (booking availability, not in-shop out).
 * @param {import('knex').Knex.QueryBuilder} qb
 * @param {string} shopId
 * @param {string} from YYYY-MM-DD
 * @param {string} to YYYY-MM-DD
 * @param {{ oaAlias?: string, oAlias?: string, excludeOrderId?: string|null }} [options]
 */
export function applyAccessoryRentOverlap(qb, shopId, from, to, options = {}) {
  const { oaAlias = 'oa', oAlias = 'o', excludeOrderId } = options;
  applyStalePreDeliveryRelease(qb, oAlias);
  qb.where(`${oaAlias}.shop_id`, shopId)
    .where(`${oAlias}.is_deleted`, false)
    .where(`${oaAlias}.type`, 'rent')
    .whereIn(`${oAlias}.status`, BLOCKING_ORDER_STATUSES)
    .andWhere(`${oAlias}.pickup_date`, '<=', to)
    .andWhereRaw(`COALESCE(${oAlias}.return_date, ${oAlias}.pickup_date) >= ?`, [from]);
  if (excludeOrderId) {
    qb.andWhere(`${oAlias}.id`, '!=', excludeOrderId);
  }
}

/**
 * @param {string} shopId
 * @param {string[]} accessoryIds
 * @param {string} from
 * @param {string} to
 * @param {string} [excludeOrderId]
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchAccessoryBookedQtyByIds(shopId, accessoryIds, from, to, excludeOrderId) {
  if (!accessoryIds?.length || !from || !to) return new Map();
  const bookedQb = knex('order_accessories as oa')
    .join('orders as o', 'o.id', 'oa.order_id')
    .whereIn('oa.accessory_id', accessoryIds);
  applyAccessoryRentOverlap(bookedQb, shopId, from, to, { excludeOrderId });
  const booked = await bookedQb
    .groupBy('oa.accessory_id')
    .select('oa.accessory_id')
    .sum({ booked_qty: 'oa.qty' });
  return new Map(booked.map((r) => [r.accessory_id, Number(r.booked_qty || 0)]));
}

/**
 * Rent accessory lines delivered to customer and not yet received (physically out of shop).
 * @param {import('knex').Knex} knexInstance
 * @param {string} shopId
 * @param {{ accessoryIds?: string[], alias?: string, oaAlias?: string, oAlias?: string }} [options]
 */
export function accessoryOutQtySubquery(knexInstance, shopId, options = {}) {
  const { accessoryIds, alias = 'ao', oaAlias = 'oa', oAlias = 'o' } = options;
  const stageCol = `${oaAlias}.stage_flags`;
  const qb = knexInstance(`order_accessories as ${oaAlias}`)
    .join(`orders as ${oAlias}`, `${oAlias}.id`, `${oaAlias}.order_id`)
    .where(`${oaAlias}.shop_id`, shopId)
    .where(`${oAlias}.is_deleted`, false)
    .where(`${oaAlias}.type`, 'rent')
    .whereRaw(`(${sqlStageFlagTruthy(stageCol, '$.delivered')})`)
    .whereRaw(`(${sqlStageFlagFalsy(stageCol, '$.received')})`)
    .groupBy(`${oaAlias}.accessory_id`)
    .select(`${oaAlias}.accessory_id`)
    .sum({ out_qty: `${oaAlias}.qty` });
  if (accessoryIds?.length) {
    qb.whereIn(`${oaAlias}.accessory_id`, accessoryIds);
  }
  return qb.as(alias);
}

/**
 * @param {string} shopId
 */
export async function readLowStockGlobalLimit(shopId) {
  const row = await knex('settings')
    .where({ shop_id: shopId, key: 'LOW_STOCK_LIMIT_QUANTITY' })
    .first();
  const n = Number(row?.value ?? 4);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 4;
}

/**
 * @param {number} inShop
 * @param {number} threshold
 * @param {number} [_globalLimit] unused — kept for caller compatibility
 */
export function isAccessoryLowStock(inShop, threshold, _globalLimit) {
  const shop = Math.max(0, Number(inShop) || 0);
  const th = Math.max(0, Math.floor(Number(threshold) || 0));
  if (th <= 0) return false;
  return shop < th;
}

/**
 * SQL filter: in-shop qty below per-item threshold (threshold must be > 0).
 * @param {import('knex').Knex.QueryBuilder} builder
 * @param {string} inShopExpr e.g. "(a.qty - COALESCE(ao.out_qty, 0))"
 * @param {string} thresholdCol e.g. "a.threshold"
 * @param {number} [_globalLimit] unused — kept for caller compatibility
 */
export function applyAccessoryLowStockWhere(builder, inShopExpr, thresholdCol, _globalLimit) {
  builder.andWhere(thresholdCol, '>', 0).whereRaw(`${inShopExpr} < ${thresholdCol}`);
}

/**
 * @param {string} shopId
 * @param {string[]} accessoryIds
 * @returns {Promise<Map<string, number>>}
 */
export async function fetchAccessoryOutQtyByIds(shopId, accessoryIds) {
  if (!accessoryIds?.length) return new Map();
  const rows = await knex('order_accessories as oa')
    .join('orders as o', 'o.id', 'oa.order_id')
    .where('oa.shop_id', shopId)
    .whereIn('oa.accessory_id', accessoryIds)
    .where('o.is_deleted', false)
    .where('oa.type', 'rent')
    .whereRaw(`(${sqlStageFlagTruthy('oa.stage_flags', '$.delivered')})`)
    .whereRaw(`(${sqlStageFlagFalsy('oa.stage_flags', '$.received')})`)
    .groupBy('oa.accessory_id')
    .select('oa.accessory_id')
    .sum({ out_qty: 'oa.qty' });
  return new Map(rows.map((r) => [r.accessory_id, Number(r.out_qty || 0)]));
}

/**
 * @param {object} row
 * @param {number} outQty
 * @param {number} globalLimit
 */
export function mapAccessoryStockFields(row, outQty, globalLimit) {
  const total = Number(row.qty || 0);
  const spare = Math.max(0, Number(row.spare_qty || 0));
  const damaged = Math.max(0, Number(row.damaged_qty || 0));
  const rentable = accessoryRentableQty(row);
  const out = Number(outQty || 0);
  const inShop = Math.max(0, rentable - out);
  const threshold = Number(row.threshold || 0);
  return {
    spare_qty: spare,
    damaged_qty: damaged,
    rentable_qty: rentable,
    active_out_qty: out,
    in_shop_qty: inShop,
    is_low_stock: isAccessoryLowStock(inShop, threshold, globalLimit),
  };
}
