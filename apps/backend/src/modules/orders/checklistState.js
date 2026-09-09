import { createHash } from 'node:crypto';

import {
  normalizeAccessoryStageFlagsFromParsed,
  normalizeProductStageFlagsFromParsed,
  parseStageFlagsJson,
} from '@wrs/shared';

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row?.[key] ?? null]));
const sorted = (rows) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

function lineState(row, accessory) {
  return {
    ...pick(row, ['id', 'product_id', 'accessory_id', 'order_item_id', 'type', 'given_status']),
    replacement_version: Number(row.replacement_version || 0),
    qty: Number(row.qty || 0),
    damaged: Boolean(row.damaged),
    missing: Boolean(row.missing),
    damaged_qty: row.damaged_qty == null ? null : Number(row.damaged_qty),
    missing_qty: row.missing_qty == null ? null : Number(row.missing_qty),
    damage_charge: Number(row.damage_charge || 0),
    damage_account_id: row.damage_account_id || null,
    stage_flags: accessory
      ? normalizeAccessoryStageFlagsFromParsed(parseStageFlagsJson(row.stage_flags))
      : normalizeProductStageFlagsFromParsed(parseStageFlagsJson(row.stage_flags)),
  };
}

export function checklistStateToken(order, items, accessories, charges, operations) {
  const state = {
    order: pick(order, ['id', 'shop_id', 'status', 'customer_id', 'pickup_date', 'return_date']),
    items: sorted(items).map((row) => lineState(row, false)),
    accessories: sorted(accessories).map((row) => lineState(row, true)),
    charges: sorted(charges).map((row) => ({
      ...pick(row, ['id', 'status', 'source', 'item_id', 'item_type', 'condition_kind', 'remarks']),
      amount: Number(row.amount || 0),
      money_flow_version: Number(row.money_flow_version || 0),
    })),
    operations: sorted(operations).map((row) => row.id),
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

/** Rendered line snapshots are used when supplied, so a later query cannot bless an older UI. */
export async function readChecklistStateToken(db, shopId, orderId, snapshot = null) {
  const scope = { shop_id: shopId, order_id: orderId };
  const order = snapshot || (await db('orders').where({ shop_id: shopId, id: orderId }).first());
  const items = snapshot?.items || (await db('order_items').where(scope));
  const accessories = snapshot?.accessories || (await db('order_accessories').where(scope));
  const charges = await db('security_charges').where(scope);
  const operations = await db('security_charge_operations').where(scope).select('id');
  if (snapshot) {
    const combined = charges.find(
      (row) =>
        row.source === 'checklist' && row.status === 'pending' && !row.item_id && !row.item_type
    );
    snapshot.pending_checklist_combined_charge = combined
      ? { amount: Number(combined.amount || 0), remarks: combined.remarks || null }
      : null;
  }
  return checklistStateToken(order, items, accessories, charges, operations);
}

export async function attachChecklistStateTokens(db, shopId, rows) {
  const ids = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
  if (!ids.length) return;
  const orders = await db('orders').where({ shop_id: shopId }).whereIn('id', ids);
  const items = await db('order_items').where({ shop_id: shopId }).whereIn('order_id', ids);
  const accessories = await db('order_accessories')
    .where({ shop_id: shopId })
    .whereIn('order_id', ids);
  const charges = await db('security_charges').where({ shop_id: shopId }).whereIn('order_id', ids);
  const operations = await db('security_charge_operations')
    .where({ shop_id: shopId })
    .whereIn('order_id', ids)
    .select('id', 'order_id');
  const tokens = new Map(
    orders.map((order) => [
      order.id,
      checklistStateToken(
        order,
        items.filter((row) => row.order_id === order.id),
        accessories.filter((row) => row.order_id === order.id),
        charges.filter((row) => row.order_id === order.id),
        operations.filter((row) => row.order_id === order.id)
      ),
    ])
  );
  const itemById = new Map(items.map((row) => [row.id, row]));
  for (const row of rows) {
    const current = itemById.get(row.id);
    const matches =
      current &&
      current.product_id === row.product_id &&
      Number(current.qty) === Number(row.qty) &&
      Number(current.replacement_version) === Number(row.replacement_version) &&
      JSON.stringify(lineState(current, false).stage_flags) ===
        JSON.stringify(lineState(row, false).stage_flags);
    row.checklist_state_token = matches ? tokens.get(row.order_id) : null;
  }
}
