import assert from 'node:assert/strict';

import { updateOrderInputSchema } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import serviceDb from '../src/db/knex.js';
import { updateOrder } from '../src/modules/orders/service.js';
import { getOrdinarySecurityNet } from '../src/modules/payments/bookingEditSettlement.js';

export async function runBookingEditIntegrityFixtures({
  db,
  shopId,
  customerId,
  paymentAccountId,
  securityAccountId,
  createProduct,
  createOrder,
}) {
  const database = String(db.client.config.connection.database || '');
  if (
    process.env.WRS_TEST_MYSQL_INTEGRATION !== '1' ||
    database !== process.env.WRS_TEST_DB_NAME ||
    database !== serviceDb.client.config.connection.database ||
    !/(test|disposable|temporary|tmp)/i.test(database)
  ) {
    throw new Error(
      'Booking edit fixtures require the explicitly selected disposable MySQL database'
    );
  }
  const productId = await createProduct(1);
  const { orderId, itemId } = await createOrder({ productId, prepared: false });
  const date = '2026-08-15';
  const makePayload = (overrides = {}) =>
    updateOrderInputSchema.parse({
      idempotency_key: uuid(),
      shop_id: shopId,
      customer_id: customerId,
      bill_type: 'kaccha',
      gst_enabled: false,
      booking_date: date,
      pickup_date: '2026-08-16',
      return_date: '2026-08-18',
      customer_notes: 'Booking edit fixture',
      expected_product_lines: [
        { item_id: itemId, expected_product_id: productId, expected_line_version: 0 },
      ],
      items: [
        {
          id: itemId,
          product_id: productId,
          expected_product_id: productId,
          expected_line_version: 0,
          name_snapshot: 'Atomic edit fixture product',
          qty: 1,
          price: 120,
          discount: 0,
          tax: 0,
          type: 'rent',
          tailor_notes: 'Edited line note',
        },
      ],
      ...overrides,
    });
  const save = (payload) => updateOrder(shopId, orderId, payload, null);
  const snapshot = async () => ({
    order: await db('orders')
      .where({ id: orderId, shop_id: shopId })
      .first(
        'customer_notes',
        'deposit_amount',
        'total_amount',
        'paid_amount',
        'balance',
        'status'
      ),
    line: await db('order_items')
      .where({ id: itemId, order_id: orderId })
      .first('price', 'tailor_notes', 'product_id', 'replacement_version'),
    payments: await db('payments')
      .where({ order_id: orderId, shop_id: shopId, is_deleted: false })
      .select('id', 'category', 'amount', 'payment_account_id', 'security_account_id')
      .orderBy('id'),
  });
  const rejectsWithoutWrites = async (payload, pattern) => {
    const before = await snapshot();
    await assert.rejects(() => save(payload), pattern);
    assert.deepEqual(
      await snapshot(),
      before,
      'Rejected booking edit must roll back header, lines, and payments'
    );
    assert.equal(
      await db('sync_queue').where({ id: payload.idempotency_key }).first('id'),
      undefined
    );
  };
  const settlement = {
    expected_advance_net: 0,
    advance_net: 60,
    payment_account_id: paymentAccountId,
    expected_security_net: 0,
    security_net: 20,
    security_account_id: securityAccountId,
    expected_deposit_amount: 0,
    deposit_amount: 50,
    payment_date: date,
  };

  // This account fails after the advance insert inside the transaction, not in header validation.
  await rejectsWithoutWrites(
    makePayload({
      customer_notes: 'Must roll back',
      edit_settlement: {
        ...settlement,
        security_account_id: uuid(),
      },
    }),
    /Unknown or inactive security account/
  );

  const successful = makePayload({
    customer_notes: 'Committed with money',
    edit_settlement: settlement,
  });
  await save(successful);
  const committed = await snapshot();
  assert.equal(committed.order.customer_notes, 'Committed with money');
  assert.equal(Number(committed.order.deposit_amount), 50);
  assert.equal(Number(committed.order.total_amount), 120);
  assert.equal(Number(committed.order.paid_amount), 60);
  assert.equal(Number(committed.order.balance), 60);
  assert.equal(committed.payments.length, 2);
  assert.equal(Number(committed.payments.find((row) => row.category === 'advance').amount), 60);
  assert.equal(Number(committed.payments.find((row) => row.category === 'deposit').amount), 20);
  assert.equal(committed.line.tailor_notes, 'Edited line note');
  const replayed = await save(successful);
  assert.equal(replayed.command_replayed, true);
  assert.deepEqual(
    await snapshot(),
    committed,
    'Identical booking edit retry must not post any money twice'
  );
  await assert.rejects(
    () => save({ ...successful, customer_notes: 'Changed reused command' }),
    /different|match|reused|conflict/i
  );
  assert.deepEqual(await snapshot(), committed);

  await rejectsWithoutWrites(
    makePayload({
      edit_settlement: {
        expected_advance_net: 0,
        advance_net: 70,
        payment_account_id: paymentAccountId,
        payment_date: date,
      },
    }),
    /Advance receipts changed/
  );
  await rejectsWithoutWrites(
    makePayload({
      edit_settlement: {
        expected_security_net: 0,
        security_net: 30,
        security_account_id: securityAccountId,
        payment_date: date,
      },
    }),
    /Security receipts changed/
  );
  await rejectsWithoutWrites(
    makePayload({
      edit_settlement: {
        expected_security_net: 20,
        security_net: 60,
        security_account_id: securityAccountId,
        payment_date: date,
      },
    }),
    /sufficient Security Amount/
  );
  await rejectsWithoutWrites(
    makePayload({
      edit_settlement: {
        expected_advance_net: 60,
        advance_net: 200,
        payment_account_id: paymentAccountId,
        payment_date: date,
      },
    }),
    /pending bill amount/
  );
  await rejectsWithoutWrites(
    makePayload({
      edit_settlement: {
        expected_deposit_amount: 0,
        deposit_amount: 70,
        payment_date: date,
      },
    }),
    /Security Amount changed/
  );

  await save(
    makePayload({
      edit_settlement: {
        expected_security_net: 20,
        security_net: 10,
        security_account_id: securityAccountId,
        payment_date: date,
      },
    })
  );
  const partiallyRefunded = await snapshot();
  assert.equal(partiallyRefunded.payments.length, 3);
  assert.equal(
    Number(partiallyRefunded.payments.find((row) => row.category === 'deposit_refund').amount),
    10
  );
  assert.equal(await getOrdinarySecurityNet(db, shopId, orderId), 10);

  await save(makePayload({ customer_notes: 'Notes-only edit after refund' }));
  assert.deepEqual(
    (await snapshot()).payments,
    partiallyRefunded.payments,
    'An ordinary booking edit must not recollect refunded security'
  );
  await save(
    makePayload({
      customer_notes: 'Explicit unchanged net after refund',
      edit_settlement: {
        expected_security_net: 10,
        security_net: 10,
        payment_date: date,
      },
    })
  );
  assert.deepEqual(
    (await snapshot()).payments,
    partiallyRefunded.payments,
    'An unchanged desired security total must not collect toward the configured deposit again'
  );
  assert.equal(await getOrdinarySecurityNet(db, shopId, orderId), 10);
  assert.equal(Number((await snapshot()).order.deposit_amount), 50);
  console.info(
    'Actual booking edit atomicity, retry, stale-net/cap, and partial-refund fixtures passed.'
  );
}
