import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import serviceDb from '../src/db/knex.js';
import { invalidateAuthCacheForUser } from '../src/lib/authCache.js';
import authRoutes from '../src/modules/auth/routes.js';
import orderRoutes from '../src/modules/orders/routes.js';
import { getOrder } from '../src/modules/orders/service.js';
import receiptVoucherRoutes from '../src/modules/receipt-vouchers/routes.js';
import { createReceiptVoucher } from '../src/modules/receipt-vouchers/service.js';
import auditPlugin from '../src/plugins/audit.js';
import authPlugin from '../src/plugins/auth.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import { hashPassword } from '../src/utils/password.js';

export async function runHttpAcceptanceFixtures({
  db,
  shopId,
  paymentAccountId,
  createProduct,
  createOrder,
}) {
  assert.equal(process.env.WRS_TEST_MYSQL_INTEGRATION, '1');
  assert.equal(db.client.config.connection.database, process.env.WRS_TEST_DB_NAME);
  assert.equal(serviceDb.client.config.connection.database, process.env.WRS_TEST_DB_NAME);
  assert.match(process.env.WRS_TEST_DB_NAME, /test/);
  const otherShop = randomUUID();
  await db('shops').insert({
    id: otherShop,
    company_name: 'HTTP isolation',
    shop_name: 'HTTP isolation',
  });
  const password = 'Synthetic-http-acceptance-1!';
  const passwordHash = await hashPassword(password);
  const actors = [
    { id: randomUUID(), shop: shopId, role: 'shop_admin', phone: '9888000001' },
    { id: randomUUID(), shop: shopId, role: 'salesman', phone: '9888000002' },
    { id: randomUUID(), shop: otherShop, role: 'shop_admin', phone: '9888000003' },
  ];
  for (const actor of actors) {
    await db('users').insert({
      id: actor.id,
      name: 'HTTP acceptance actor',
      role: actor.role,
      email: `${actor.id}@example.test`,
      login_phone: actor.phone,
      phone: actor.phone,
      password_hash: passwordHash,
      is_active: true,
    });
    await db('users_shops').insert({
      user_id: actor.id,
      shop_id: actor.shop,
      is_default: true,
      permissions_overridden: true,
      permissions: JSON.stringify({
        booking: { view: true, edit: false },
        vouchers: { view: false },
      }),
    });
  }
  const partyAccount = randomUUID();
  await db('payment_accounts').insert({
    id: partyAccount,
    shop_id: shopId,
    name: 'HTTP synthetic party',
    account_group: 'Parties',
    is_active: true,
  });
  const receipt = await createReceiptVoucher(shopId, actors[0].id, {
    debit_account_id: paymentAccountId,
    credit_account_id: partyAccount,
    entry_date: '2026-09-06',
    amount: 27,
    remarks: 'HTTP fixture only',
  });
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(orderRoutes, { prefix: '/api/orders' });
  await app.register(receiptVoucherRoutes, { prefix: '/api/receipt-vouchers' });
  await app.ready();
  const login = (identity, enteredPassword = password) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        identity,
        password: enteredPassword,
        device_id: 'synthetic-http',
        device_name: 'HTTP acceptance',
      },
    });
  try {
    assert.equal((await login(actors[0].phone, 'Wrong-synthetic-password')).statusCode, 401);
    for (const actor of actors) {
      const response = await login(`+91 ${actor.phone}`);
      assert.equal(response.statusCode, 200, response.body);
      const body = response.json().data;
      assert.equal(body.user.id, actor.id);
      assert.equal(body.user.password_hash, undefined);
      actor.headers = { authorization: `Bearer ${body.access_token}`, 'x-shop-id': actor.shop };
    }
    const url = `/api/receipt-vouchers/${receipt.id}`;
    assert.equal((await app.inject({ url })).statusCode, 401);
    const own = await app.inject({ url, headers: actors[0].headers });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(own.json().data.id, receipt.id);
    assert.equal(Number(own.json().data.amount), 27);
    assert.equal((await app.inject({ url, headers: actors[1].headers })).statusCode, 403);
    assert.equal((await app.inject({ url, headers: actors[2].headers })).statusCode, 404);
    assert.equal(
      (await app.inject({ url, headers: { ...actors[2].headers, 'x-shop-id': shopId } }))
        .statusCode,
      403
    );
    assert.equal(
      (await app.inject({ url: '/api/receipt-vouchers/not-a-uuid', headers: actors[0].headers }))
        .statusCode,
      400
    );

    const booking = await createOrder({ productId: await createProduct(1) });
    const before = await getOrder(shopId, booking.orderId);
    const payload = {
      idempotency_key: randomUUID(),
      expected_state_token: before.checklist_state_token,
      stage_updates: [
        { item_id: booking.itemId, item_type: 'item', field: 'prepared', value: true },
      ],
    };
    const command = (headers, body) =>
      app.inject({
        method: 'POST',
        url: `/api/orders/${booking.orderId}/checklist-command`,
        headers,
        payload: body,
      });
    assert.equal((await command(actors[1].headers, payload)).statusCode, 403);
    assert.equal(await db('sync_queue').where({ id: payload.idempotency_key }).first(), undefined);
    const saved = await command(actors[0].headers, payload);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().replayed, false);
    const replay = await command(actors[0].headers, payload);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().replayed, true);
    assert.equal(
      (await command(actors[0].headers, { ...payload, idempotency_key: randomUUID() })).statusCode,
      409
    );
    await db('users').where({ id: actors[0].id }).update({ is_active: false });
    invalidateAuthCacheForUser(actors[0].id);
    assert.equal((await app.inject({ url, headers: actors[0].headers })).statusCode, 401);
    assert.equal((await login(actors[0].phone)).statusCode, 401);
    assert.equal(
      Number((await db('receipt_vouchers').where({ id: receipt.id }).first()).amount),
      27
    );
    process.stdout.write(
      'HTTP acceptance: phone login, inactive/wrong-password rejection, receipt lookup, shop/permission boundaries and checklist replay passed.\n'
    );
  } finally {
    await app.close();
    for (const actor of actors) invalidateAuthCacheForUser(actor.id);
  }
}
