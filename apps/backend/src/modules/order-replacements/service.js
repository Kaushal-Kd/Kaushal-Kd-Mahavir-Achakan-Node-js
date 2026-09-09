import { assertNoIssuedGstInvoice } from '../../lib/gstInvoiceLock.js';
import {
  addDays,
  normalizeProductStageFlagsFromParsed,
  normalizeSqlDateToIso,
  parseStageFlagsJson,
  rentalDateRangeOverlaps,
  todayIndiaISODate,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { AppError, badRequest, conflict, notFound } from '../../utils/errors.js';
import { lockOrderInventory } from '../orders/orderInventoryLock.js';

import {
  replacementLineIsStale,
  replacementRequirementStatus,
  replacementTargetIsPending,
} from './rules.js';

const TABLE = 'order_item_replacement_requirements';

function candidateLines(db, shopId) {
  return db('order_items as oi')
    .join('orders as o', function joinOrder() {
      this.on('o.id', '=', 'oi.order_id').andOn('o.shop_id', '=', 'oi.shop_id');
    })
    .where('oi.shop_id', shopId)
    .select('oi.*', 'o.status as order_status', 'o.is_deleted', 'o.pickup_date', 'o.order_number');
}

async function sourceRows(db, shopId, orderId, itemIds) {
  const query = db('order_items').where({ shop_id: shopId, order_id: orderId, type: 'rent' })
    .whereNotNull('product_id');
  if (itemIds?.length) query.whereIn('id', itemIds);
  else query.where({ damaged: true });
  return query.select('id', 'order_id', 'product_id', 'code_snapshot', 'name_snapshot', 'damaged');
}

async function ensureRequirement(trx, shopId, source, target) {
  const key = {
    shop_id: shopId,
    source_order_item_id: source.id,
    target_order_item_id: target.id,
  };
  const existing = await trx(TABLE).where(key).first();
  if (existing) return existing;
  const id = uuid();
  const reminderId = uuid();
  const label = source.code_snapshot || source.name_snapshot || source.source_product_label || 'Damaged product';
  const today = todayIndiaISODate();
  const beforePickup = normalizeSqlDateToIso(addDays(normalizeSqlDateToIso(target.pickup_date), -1));
  const row = {
    ...key,
    id,
    source_order_id: source.order_id,
    source_product_id: source.product_id,
    source_product_label: label,
    target_order_id: target.order_id,
    status: 'pending',
    reminder_id: reminderId,
  };
  await trx(TABLE).insert(row);
  await trx('reminders').insert({
    id: reminderId,
    shop_id: shopId,
    description: `Replacement required: ${label} for Bill ${target.order_number || target.order_id}. Select an alternate product before delivery.`,
    assignee: 'SELF',
    reminder_date: beforePickup < today ? today : beforePickup,
    reminder_time: '9:00 AM',
    is_completed: false,
  });
  return row;
}

export async function recordDamagedProductReplacements(trx, shopId, sourceOrderId, sourceItemIds) {
  const sources = await sourceRows(trx, shopId, sourceOrderId, sourceItemIds);
  const today = todayIndiaISODate();
  const created = [];
  for (const source of sources.filter((row) => row.damaged)) {
    const targets = await candidateLines(trx, shopId)
      .where('oi.product_id', source.product_id).whereNot('oi.order_id', sourceOrderId);
    for (const target of targets.filter((row) => replacementTargetIsPending(row, today))) {
      created.push(await ensureRequirement(trx, shopId, source, target));
    }
  }
  return created;
}

export async function syncReplacementRequirementsForOrder(trx, shopId, orderId, userId) {
  const order = await trx('orders').where({ id: orderId, shop_id: shopId }).first();
  const requirements = await trx(TABLE).where({ shop_id: shopId, target_order_id: orderId });
  const lines = await candidateLines(trx, shopId).where('oi.order_id', orderId);
  const byId = new Map(lines.map((line) => [line.id, line]));
  for (const requirement of requirements) {
    const line = byId.get(requirement.target_order_item_id);
    const status = replacementRequirementStatus(requirement, line, order);
    if (status !== requirement.status) {
      await trx(TABLE).where({ id: requirement.id, shop_id: shopId }).update({
        status,
        replacement_product_id: status === 'replaced' ? line.product_id : null,
        resolved_at: status === 'pending' ? null : trx.fn.now(),
        resolved_by: status === 'pending' ? null : userId || null,
        updated_at: trx.fn.now(),
      });
    }
    if (requirement.reminder_id) {
      await trx('reminders').where({ id: requirement.reminder_id, shop_id: shopId })
        .update({ is_completed: status !== 'pending' });
    }
  }
  // Keep the obligation when a line is removed and the same product is added back,
  // even if the source product was subsequently repaired.
  const historicalSources = new Map(requirements.map((requirement) => [requirement.source_order_item_id, {
    id: requirement.source_order_item_id,
    order_id: requirement.source_order_id,
    product_id: requirement.source_product_id,
    source_product_label: requirement.source_product_label,
  }]));
  for (const line of lines.filter((row) => replacementTargetIsPending({ ...row, type: 'rent' }, todayIndiaISODate()))) {
    const damagedSources = line.type === 'rent' ? await candidateLines(trx, shopId)
      .where('oi.product_id', line.product_id).where('oi.damaged', true)
      .where('o.is_deleted', false).whereNot('oi.order_id', orderId) : [];
    const sources = new Map([...historicalSources, ...damagedSources.map((source) => [source.id, source])]);
    for (const source of sources.values()) {
      if (source.product_id === line.product_id) await ensureRequirement(trx, shopId, source, line);
    }
  }
}

export async function assertOrderItemReplacementAllowed(trx, shopId, orderId, line) {
  if (!line.product_id) return;
  await syncReplacementRequirementsForOrder(trx, shopId, orderId, null);
  const pending = await trx(TABLE).where({
    shop_id: shopId, target_order_id: orderId, target_order_item_id: line.id, status: 'pending',
  }).select('id', 'source_product_label');
  if (pending.length) {
    throw new AppError(409, 'Select a replacement for the damaged product before delivery', {
      code: 'REPLACEMENT_REQUIRED',
      details: { order_item_id: line.id, requirement_ids: pending.map((row) => row.id) },
    });
  }
}

export async function listOrderReplacementRequirements(db, shopId, orderId, direction = 'target', sourceItemIds = []) {
  const order = await db('orders').where({ id: orderId, shop_id: shopId }).first('id');
  if (!order) throw notFound('Order not found');
  const rows = await db(`${TABLE} as rr`)
    .join('orders as o', function joinOrder() {
      this.on('o.id', '=', 'rr.target_order_id').andOn('o.shop_id', '=', 'rr.shop_id');
    })
    .leftJoin('customers as c', function joinCustomer() {
      this.on('c.id', '=', 'o.customer_id').andOn('c.shop_id', '=', 'o.shop_id');
    })
    .leftJoin('order_items as oi', 'oi.id', 'rr.target_order_item_id')
    .where('rr.shop_id', shopId)
    .where(direction === 'source' ? 'rr.source_order_id' : 'rr.target_order_id', orderId)
    .select('rr.*', 'o.order_number', 'o.pickup_date', 'c.name as customer_name',
      'oi.product_id as current_product_id', 'oi.replacement_version', 'oi.stage_flags')
    .orderBy('o.pickup_date', 'asc');
  if (direction !== 'source' || !sourceItemIds.length) return rows;
  const sources = await sourceRows(db, shopId, orderId, sourceItemIds);
  const known = new Set(rows.map((row) => `${row.source_order_item_id}:${row.target_order_item_id}`));
  for (const source of sources) {
    const candidates = await candidateLines(db, shopId)
      .where('oi.product_id', source.product_id).whereNot('oi.order_id', orderId);
    for (const target of candidates.filter((row) => replacementTargetIsPending(row, todayIndiaISODate()))) {
      const key = `${source.id}:${target.id}`;
      if (known.has(key)) continue;
      rows.push({
        id: key, source_order_id: orderId, source_order_item_id: source.id,
        source_product_id: source.product_id,
        source_product_label: source.code_snapshot || source.name_snapshot,
        target_order_id: target.order_id, target_order_item_id: target.id,
        order_number: target.order_number, pickup_date: target.pickup_date,
        current_product_id: target.product_id, replacement_version: target.replacement_version,
        status: 'preview',
      });
    }
  }
  return rows;
}

async function assertReplacementInventoryAvailable(trx, shopId, order, line, product) {
  if (!product.is_active || product.type === 'sell' || ['repair', 'lost', 'sold', 'washing'].includes(product.status)) {
    throw badRequest('Replacement product is not currently available');
  }
  const others = await trx('order_items as oi').join('orders as o', 'o.id', 'oi.order_id')
    .where({ 'oi.shop_id': shopId, 'oi.product_id': product.id, 'oi.type': 'rent', 'o.is_deleted': false })
    .whereNot('oi.id', line.id).whereNotIn('o.status', ['cancelled', 'returned', 'closed', 'draft'])
    .select('oi.qty', 'oi.stage_flags', 'o.pickup_date', 'o.return_date', 'o.next_booking_gap_days', 'o.previous_booking_gap_days');
  const from = normalizeSqlDateToIso(order.pickup_date);
  const to = normalizeSqlDateToIso(order.return_date) || from;
  const reserved = others.filter((row) => {
    const flags = normalizeProductStageFlagsFromParsed(parseStageFlagsJson(row.stage_flags));
    return !flags.received && (flags.delivered || rentalDateRangeOverlaps(from, to,
      normalizeSqlDateToIso(row.pickup_date),
      normalizeSqlDateToIso(row.return_date) || normalizeSqlDateToIso(row.pickup_date),
      row.next_booking_gap_days, row.previous_booking_gap_days));
  })
    .reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const washing = await trx('washing_queue').where({ shop_id: shopId, product_id: product.id }).sum('qty as total').first();
  const laundry = await trx('laundry_job_products').where({ shop_id: shopId, product_id: product.id, status: 'in_washing' })
    .sum('qty as total').first();
  const damaged = await candidateLines(trx, shopId).where('oi.product_id', product.id)
    .where('o.is_deleted', false).andWhere((qb) => qb.where('oi.damaged', true).orWhere('oi.missing', true));
  if (damaged.length || Number(line.qty) + reserved + Number(washing?.total || 0) + Number(laundry?.total || 0) > Number(product.qty || 0)) {
    throw conflict('Replacement product is unavailable for this booking; choose another product');
  }
}

export async function replaceOrderItem(shopId, orderId, itemId, body, userId) {
  return knex.transaction(async (trx) => {
    await lockOrderInventory(trx, shopId, orderId, [{ product_id: body.replacement_product_id }]);
    const order = await trx('orders').where({ id: orderId, shop_id: shopId }).forUpdate().first();
    if (!order) throw notFound('Order not found');
    const existing = await trx('sync_queue').where({ id: body.idempotency_key, shop_id: shopId }).forUpdate().first();
    if (existing) {
      const saved = typeof existing.payload === 'string' ? JSON.parse(existing.payload) : existing.payload;
      if (existing.entity !== 'order_item_replacement' || existing.entity_id !== itemId ||
          existing.user_id !== (userId || null) || existing.status !== 'synced' || saved.result?.order_id !== orderId ||
          !Object.entries(body).every(([key, value]) => saved.request?.[key] === value)) {
        throw conflict('This request key was already used for another replacement');
      }
      return { ...saved.result, replayed: true };
    }
    await assertNoIssuedGstInvoice(trx, shopId, orderId);
    const line = await trx('order_items').where({ id: itemId, order_id: orderId, shop_id: shopId }).forUpdate().first();
    if (!line) throw notFound('Order item not found');
    if (replacementLineIsStale(line, body)) throw conflict('Product changed since this screen was opened. Refresh before replacing it.');
    if (!replacementTargetIsPending({ ...line, order_status: order.status, pickup_date: order.pickup_date, is_deleted: order.is_deleted }, todayIndiaISODate())) {
      throw conflict('Only an undelivered future rental item can be replaced');
    }
    const productIds = [...new Set([line.product_id, body.replacement_product_id])].sort();
    const products = await trx('products').where({ shop_id: shopId }).whereIn('id', productIds).orderBy('id').forUpdate();
    const product = products.find((row) => row.id === body.replacement_product_id);
    if (!product) throw notFound('Replacement product not found');
    await syncReplacementRequirementsForOrder(trx, shopId, orderId, userId);
    const obligations = await trx(TABLE).where({ shop_id: shopId, target_order_id: orderId, target_order_item_id: itemId });
    if (!obligations.some((row) => row.status === 'pending')) throw conflict('This item has no pending replacement requirement');
    if (obligations.some((row) => row.source_product_id === product.id)) throw badRequest('Choose a different product, not the damaged original');
    await assertReplacementInventoryAvailable(trx, shopId, order, line, product);
    const version = Number(line.replacement_version || 0) + 1;
    await trx('order_items').where({ id: itemId, shop_id: shopId }).update({
      product_id: product.id, code_snapshot: product.code, name_snapshot: product.name,
      stage_flags: JSON.stringify({ item_to_collect: false, prepared: false, delivered: false, received: false }),
      prepared_at: null, delivered_at: null, received_at: null,
      replacement_version: version, updated_at: trx.fn.now(),
    });
    const [remainingItems, remainingAccessories] = await Promise.all([
      trx('order_items').where({ shop_id: shopId, order_id: orderId }).select('stage_flags'),
      trx('order_accessories').where({ shop_id: shopId, order_id: orderId }).select('stage_flags'),
    ]);
    const incomplete = [...remainingItems, ...remainingAccessories]
      .map((entry) => normalizeProductStageFlagsFromParsed(parseStageFlagsJson(entry.stage_flags)))
      .filter((flags) => !flags.delivered);
    // The newly replaced product is unprepared; preserve preparation of all other lines.
    await trx('orders').where({ id: orderId, shop_id: shopId }).update({
      status: incomplete.some((flags) => flags.prepared) ? 'in_preparation' : 'booked',
      packed_at: null, delivered_at: null, updated_at: trx.fn.now(),
    });
    await syncReplacementRequirementsForOrder(trx, shopId, orderId, userId);
    await trx('order_status_logs').insert({
      id: uuid(), shop_id: shopId, order_id: orderId, user_id: userId,
      item_id: itemId, item_type: 'item', field: 'product', action: 'REPLACED',
      old_value: line.product_id, new_value: product.id,
      message: `Replaced ${line.code_snapshot || line.name_snapshot} with ${product.code || product.name}; agreed price retained`,
    });
    const result = { order_id: orderId, item_id: itemId, replacement_product_id: product.id, replacement_version: version };
    await trx('sync_queue').insert({
      id: body.idempotency_key, shop_id: shopId, user_id: userId, entity: 'order_item_replacement',
      entity_id: itemId, op: 'update', payload: JSON.stringify({ request: body, result }),
      status: 'synced', retry_count: 0,
    });
    return result;
  }, { isolationLevel: 'read committed' });
}
