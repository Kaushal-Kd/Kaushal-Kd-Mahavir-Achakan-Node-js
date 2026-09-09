import assert from 'node:assert/strict';

import { addDays, normalizeSqlDateToIso, todayIndiaISODate } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import {
  assertOrderItemReplacementAllowed,
  recordDamagedProductReplacements,
  replaceOrderItem,
  syncReplacementRequirementsForOrder,
} from '../src/modules/order-replacements/service.js';
import { batchUpdateOrderStatusFlags, settleOrderDelivery, settleOrderReturn } from '../src/modules/orders/service.js';

export async function runReplacementIntegrityFixtures({ db, shopId, createProduct, createOrder }) {
  const originalProduct = await createProduct(1);
  const source = await createOrder({ productId: originalProduct, prepared: true });
  await db('order_items').where({ id: source.itemId }).update({
    damaged: true,
    stage_flags: JSON.stringify({ delivered: true, received: true, prepared: true, item_to_collect: true }),
  });
  await db('orders').where({ id: source.orderId }).update({ status: 'returned' });
  const future = [];
  for (const days of [3, 15, 60]) {
    const target = await createOrder({ productId: originalProduct, prepared: true });
    await db('orders').where({ id: target.orderId }).update({
      pickup_date: normalizeSqlDateToIso(addDays(todayIndiaISODate(), days)),
      return_date: normalizeSqlDateToIso(addDays(todayIndiaISODate(), days + 1)),
    });
    future.push(target);
  }
  await db.transaction((trx) => recordDamagedProductReplacements(trx, shopId, source.orderId, [source.itemId]));
  await db.transaction((trx) => recordDamagedProductReplacements(trx, shopId, source.orderId, [source.itemId]));
  const requirements = await db('order_item_replacement_requirements').where({ source_order_id: source.orderId });
  assert.equal(requirements.length, 3, 'all three future bookings must have one durable requirement');
  assert.equal(requirements.every((row) => row.status === 'pending' && row.reminder_id), true);

  const first = future[0];
  const firstLine = await db('order_items').where({ id: first.itemId }).first();
  await assert.rejects(
    db.transaction((trx) => assertOrderItemReplacementAllowed(trx, shopId, first.orderId, firstLine)),
    (error) => error.code === 'REPLACEMENT_REQUIRED'
  );

  // Repair does not discharge the user's explicit replacement obligation.
  await db('order_items').where({ id: source.itemId }).update({ damaged: false });
  const cashAccount = await db('payment_accounts').where({ shop_id: shopId, is_active: true, account_group: 'Cash Accounts' }).first('id');
  const blockedDeliveryKey = uuid();
  await assert.rejects(settleOrderDelivery(shopId, first.orderId, {
    idempotency_key: blockedDeliveryKey, discount_total: 0,
    deposit_amount: 0, security_amount: 0, security_status: 'unpaid', receive_amount: 10,
    payment_account_id: cashAccount.id, payment_date: todayIndiaISODate(),
    stage_updates: [{ item_id: first.itemId, item_type: 'item', field: 'delivered', value: true,
      expected_product_id: originalProduct, expected_line_version: 0 }],
  }, null), (error) => error.code === 'REPLACEMENT_REQUIRED');
  assert.equal(Number((await db('payments').where({ order_id: first.orderId }).count('* as count').first()).count), 0,
    'blocked future delivery must not commit its requested payment');
  assert.equal(await db('sync_queue').where({ id: blockedDeliveryKey }).first(), undefined,
    'failed atomic delivery must not claim the command key');
  await assert.rejects(
    db.transaction((trx) => assertOrderItemReplacementAllowed(trx, shopId, first.orderId, firstLine)),
    (error) => error.code === 'REPLACEMENT_REQUIRED'
  );

  const alternate = await createProduct(1);
  const payload = {
    replacement_product_id: alternate,
    expected_product_id: originalProduct,
    expected_line_version: 0,
    idempotency_key: uuid(),
  };
  const changed = await replaceOrderItem(shopId, first.orderId, first.itemId, payload, null);
  const replay = await replaceOrderItem(shopId, first.orderId, first.itemId, payload, null);
  assert.equal(changed.replacement_version, 1);
  assert.equal(replay.replayed, true);
  const updatedLine = await db('order_items').where({ id: first.itemId }).first();
  assert.equal(updatedLine.product_id, alternate);
  assert.equal(Number(updatedLine.price), Number(firstLine.price));
  const flags = typeof updatedLine.stage_flags === 'string' ? JSON.parse(updatedLine.stage_flags) : updatedLine.stage_flags;
  assert.equal(flags.prepared, false);
  assert.equal(flags.delivered, false);
  const remaining = await db('order_item_replacement_requirements').where({ source_order_id: source.orderId, status: 'pending' });
  assert.equal(remaining.length, 2, 'one replacement must not release other future bookings');
  await assert.rejects(replaceOrderItem(shopId, first.orderId, first.itemId, { ...payload, idempotency_key: uuid() }, null), /changed/i);

  await assert.rejects(batchUpdateOrderStatusFlags(shopId, first.orderId, [{
    item_id: first.itemId, item_type: 'item', field: 'prepared', value: true,
    expected_product_id: originalProduct, expected_line_version: 0,
  }], null), /changed/i);
  const prepared = await batchUpdateOrderStatusFlags(shopId, first.orderId,
    ['item_to_collect', 'prepared'].map((field) => ({
      item_id: first.itemId, item_type: 'item', field, value: true,
      expected_product_id: alternate, expected_line_version: 1,
    })), null);
  assert.equal(prepared.lines.find((line) => line.id === first.itemId).stage_flags.prepared, true);
  const conditionCommand = {
    idempotency_key: uuid(), discount_total: 0, payment_date: todayIndiaISODate(),
    security_refund_amount: 0, receive_amount: 0, condition_collect_amount: 0, condition_retain_amount: 0,
    condition_updates: [{ item_id: first.itemId, item_type: 'item', condition: 'damage', charge_amount: 0,
      expected_product_id: originalProduct, expected_line_version: 0 }], stage_updates: [],
  };
  await assert.rejects(settleOrderReturn(shopId, first.orderId, conditionCommand, null), /changed/i);
  assert.equal(Boolean((await db('order_items').where({ id: first.itemId }).first('damaged')).damaged), false);
  assert.equal(await db('sync_queue').where({ id: conditionCommand.idempotency_key }).first(), undefined);
  const freshCondition = await settleOrderReturn(shopId, first.orderId, {
    ...conditionCommand, idempotency_key: uuid(), condition_updates: [{ ...conditionCommand.condition_updates[0],
      expected_product_id: alternate, expected_line_version: 1 }],
  }, null);
  assert.equal(freshCondition.replayed, false);
  assert.equal(Boolean((await db('order_items').where({ id: first.itemId }).first('damaged')).damaged), true);

  // A removed/recreated line must inherit the original obligation even after repair.
  const second = future[1];
  await db('order_items').where({ id: second.itemId }).delete();
  const recreatedId = uuid();
  await db('order_items').insert({
    id: recreatedId, shop_id: shopId, order_id: second.orderId, product_id: originalProduct,
    name_snapshot: 'Re-added damaged original', qty: 1, type: 'rent',
    stage_flags: JSON.stringify({ prepared: false, delivered: false, received: false, item_to_collect: false }),
  });
  await db.transaction((trx) => syncReplacementRequirementsForOrder(trx, shopId, second.orderId, null));
  const recreated = await db('order_item_replacement_requirements').where({ target_order_item_id: recreatedId }).first();
  assert.equal(recreated.status, 'pending');
  await db('orders').where({ id: second.orderId }).update({ status: 'cancelled' });
  await db.transaction((trx) => syncReplacementRequirementsForOrder(trx, shopId, second.orderId, null));
  assert.equal((await db('order_item_replacement_requirements').where({ id: recreated.id }).first()).status, 'cancelled');
  await db('orders').where({ id: second.orderId }).update({ status: 'booked' });
  await db.transaction((trx) => syncReplacementRequirementsForOrder(trx, shopId, second.orderId, null));
  assert.equal((await db('order_item_replacement_requirements').where({ id: recreated.id }).first()).status, 'pending');
  process.stdout.write('Replacement integrity: three future holds, repair gate, replay, stale edit and line recreation passed.\n');
}
