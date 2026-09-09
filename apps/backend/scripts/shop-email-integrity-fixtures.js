import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import serviceDb from '../src/db/knex.js';
import { decryptEmailPassword } from '../src/lib/emailSecret.js';
import { invalidateAuthCacheForUser } from '../src/lib/authCache.js';
import { requestAdminPasswordOtp, confirmAdminPasswordOtp } from '../src/modules/auth/service.js';
import authRoutes from '../src/modules/auth/routes.js';
import shopEmailRoutes from '../src/modules/shop-email/routes.js';
import { createShopEmailService } from '../src/modules/shop-email/service.js';
import auditPlugin from '../src/plugins/audit.js';
import authPlugin from '../src/plugins/auth.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

export async function runShopEmailIntegrityFixtures({ db }) {
  assert.equal(process.env.WRS_TEST_MYSQL_INTEGRATION, '1');
  assert.equal(db.client.config.connection.database, process.env.WRS_TEST_DB_NAME);
  assert.equal(serviceDb.client.config.connection.database, process.env.WRS_TEST_DB_NAME);
  assert.match(process.env.WRS_TEST_DB_NAME, /test/);
  const shops = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, id] of shops.entries())
    await db('shops').insert({
      id,
      shop_name: `Email test ${index}`,
      company_name: 'Synthetic email fixtures',
    });
  const userPassword = 'Synthetic-email-admin-1!';
  const originalHash = await hashPassword(userPassword);
  const actors = [
    { id: randomUUID(), role: 'super_admin', shop: shops[0] },
    { id: randomUUID(), role: 'shop_admin', shop: shops[0] },
    { id: randomUUID(), role: 'shop_admin', shop: shops[1] },
    { id: randomUUID(), role: 'salesman', shop: shops[0] },
  ];
  for (const actor of actors) {
    actor.email = `${actor.id}@example.test`;
    await db('users').insert({
      id: actor.id,
      role: actor.role,
      name: 'Synthetic email actor',
      email: actor.email,
      password_hash: originalHash,
      is_active: true,
    });
    await db('users_shops').insert({ user_id: actor.id, shop_id: actor.shop, is_default: true });
  }
  let encryptionKey = randomBytes(32).toString('base64');
  let clock = new Date();
  let deliveryFailure = false;
  let pendingDelivery = null;
  const messages = [];
  const emailService = createShopEmailService({
    database: db,
    getKey: () => encryptionKey,
    now: () => clock,
    deliver: async (settings, message) => {
      if (deliveryFailure)
        throw Object.assign(new Error('Provider echoed VERY-SECRET-SYNTHETIC'), { code: 'EAUTH' });
      messages.push({ settings, message });
      if (pendingDelivery) await pendingDelivery;
      return { accepted: true };
    },
  });
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(shopEmailRoutes, { prefix: '/api/shop-email-settings', emailService });
  await app.ready();
  const request = (method, shopId, actor, payload, suffix = '') =>
    app.inject({
      method,
      url: `/api/shop-email-settings/${shopId}${suffix}`,
      headers: actor
        ? { authorization: `Bearer ${app.jwt.sign({ sub: actor.id })}`, 'x-shop-id': actor.shop }
        : {},
      ...(payload ? { payload } : {}),
    });
  const body = {
    host: 'smtp.example.test',
    port: 587,
    username: 'sender-a@example.test',
    from_email: 'sender-a@example.test',
    password: 'Synthetic SMTP A!',
    expected_revision: null,
  };
  let saved;
  try {
    assert.equal((await request('GET', shops[0])).statusCode, 401);
    assert.equal((await request('GET', shops[0], actors[3])).statusCode, 403);
    const initial = await request('GET', shops[0], actors[0]);
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.json().data.configured, false);
    assert.equal((await request('PUT', shops[0], actors[1], body)).statusCode, 403);
    assert.equal(
      (await request('POST', shops[0], actors[1], { expected_revision: randomUUID() }, '/test'))
        .statusCode,
      403
    );
    assert.equal((await request('GET', shops[0], actors[2])).statusCode, 400);
    assert.equal(
      (await request('GET', shops[0], { ...actors[2], shop: shops[0] })).statusCode,
      403
    );
    assert.equal(
      (await request('PUT', shops[0], actors[0], { ...body, port: 25 })).statusCode,
      400
    );
    assert.equal(
      (await request('PUT', shops[0], actors[0], { ...body, password: '' })).statusCode,
      400
    );
    const created = await request('PUT', shops[0], actors[0], body);
    assert.equal(created.statusCode, 200, created.body);
    saved = created.json().data;
    assert.equal(saved.configured, true);
    assert.equal(created.body.includes(body.password), false);
    assert.equal(saved.password_ciphertext, undefined);
    assert.equal(saved.password, undefined);
    const stored = await db('shop_email_settings').where({ shop_id: shops[0] }).first();
    assert.notEqual(stored.password_ciphertext, body.password);
    assert.equal(
      decryptEmailPassword(stored.password_ciphertext, shops[0], encryptionKey),
      body.password
    );
    const shopAdminView = (await request('GET', shops[0], actors[1])).json().data;
    assert.equal(shopAdminView.configured, true);
    assert.equal(shopAdminView.username, undefined);
    assert.equal(shopAdminView.host, undefined);
    assert.equal((await request('PUT', shops[0], actors[0], body)).statusCode, 409);
    const updated = await request('PUT', shops[0], actors[0], {
      ...body,
      password: '',
      expected_revision: saved.revision,
    });
    assert.equal(updated.statusCode, 200, updated.body);
    saved = updated.json().data;
    assert.equal(
      decryptEmailPassword(
        (await db('shop_email_settings').where({ shop_id: shops[0] }).first()).password_ciphertext,
        shops[0],
        encryptionKey
      ),
      body.password
    );
    const otherSuper = { ...actors[0], shop: shops[1] };
    assert.equal(
      (
        await request('PUT', shops[1], otherSuper, {
          ...body,
          from_email: 'sender-b@example.test',
          password: 'Synthetic SMTP B!',
        })
      ).statusCode,
      200
    );
    assert.equal((await emailService.getReadiness(shops[2])).configured, false);
    await assert.rejects(
      emailService.sendPasswordOtp(shops[2], {
        to: actors[0].email,
        otp: '123456',
        expiresInMinutes: 10,
      }),
      /not configured for this shop/
    );
    assert.equal(
      (
        await request(
          'POST',
          shops[0],
          actors[0],
          { expected_revision: saved.revision, to: 'outsider@example.test' },
          '/test'
        )
      ).statusCode,
      400
    );
    const sends = await Promise.all([
      request('POST', shops[0], actors[0], { expected_revision: saved.revision }, '/test'),
      request('POST', shops[0], actors[0], { expected_revision: saved.revision }, '/test'),
    ]);
    assert.deepEqual(sends.map((r) => r.statusCode).sort(), [200, 429]);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message.to, actors[0].email);
    assert.equal(messages[0].settings.from_email, body.from_email);
    assert.equal(
      (await emailService.getSettings(shops[0], actors[0])).last_test_status,
      'accepted'
    );
    const sendEmail = ({ shopId, ...message }) => emailService.sendPasswordOtp(shopId, message);
    const otpArgs = {
      requester: actors[1],
      targetUserId: actors[1].id,
      currentPassword: userPassword,
      shopId: shops[0],
    };
    await assert.rejects(
      requestAdminPasswordOtp({ ...otpArgs, currentPassword: 'wrong' }, { sendEmail }),
      /Current password/
    );
    await assert.rejects(
      requestAdminPasswordOtp({ ...otpArgs, shopId: shops[1] }, { sendEmail }),
      /access/
    );
    await assert.rejects(
      requestAdminPasswordOtp(
        { requester: actors[0], targetUserId: actors[2].id, shopId: shops[0] },
        { sendEmail }
      ),
      /does not belong/
    );
    const challenge = await requestAdminPasswordOtp(otpArgs, { sendEmail });
    const otpMessage = messages.at(-1);
    assert.equal(otpMessage.message.to, actors[1].email);
    assert.equal(otpMessage.settings.password, body.password);
    assert.equal(otpMessage.settings.from_email, body.from_email);
    const otp = otpMessage.message.text.match(/OTP is (\d{6})/)[1];
    assert.equal(
      (
        await db('password_otp_challenges').where({ id: challenge.challenge_id }).first()
      ).otp_hash.includes(otp),
      false
    );
    await assert.rejects(requestAdminPasswordOtp(otpArgs, { sendEmail }), /wait one minute/);
    await confirmAdminPasswordOtp({
      requester: actors[1],
      challengeId: challenge.challenge_id,
      otp,
      newPassword: 'Synthetic-email-new-2!',
    });
    assert.equal(
      await verifyPassword(
        'Synthetic-email-new-2!',
        (await db('users').where({ id: actors[1].id }).first()).password_hash
      ),
      true
    );
    const superChallenge = await requestAdminPasswordOtp(
      {
        requester: actors[0],
        targetUserId: actors[0].id,
        currentPassword: userPassword,
        shopId: shops[1],
      },
      { sendEmail }
    );
    assert.equal(messages.at(-1).settings.password, 'Synthetic SMTP B!');
    assert.equal(messages.at(-1).message.to, actors[0].email);
    assert.ok(superChallenge.challenge_id);
    const beforeFailedChallenge = Number(
      (
        await db('password_otp_challenges')
          .where({ target_user_id: actors[2].id })
          .count('* as n')
          .first()
      ).n
    );
    deliveryFailure = true;
    await assert.rejects(
      requestAdminPasswordOtp(
        {
          requester: actors[2],
          targetUserId: actors[2].id,
          currentPassword: userPassword,
          shopId: shops[1],
        },
        { sendEmail }
      ),
      /login was rejected/
    );
    assert.equal(
      Number(
        (
          await db('password_otp_challenges')
            .where({ target_user_id: actors[2].id })
            .count('* as n')
            .first()
        ).n
      ),
      beforeFailedChallenge
    );
    clock = new Date(clock.getTime() + 61000);
    const failed = await request(
      'POST',
      shops[0],
      actors[0],
      { expected_revision: saved.revision },
      '/test'
    );
    assert.equal(failed.statusCode, 400);
    assert.equal(failed.body.includes('VERY-SECRET-SYNTHETIC'), false);
    assert.equal((await emailService.getSettings(shops[0], actors[0])).last_test_status, 'failed');
    deliveryFailure = false;
    const key = encryptionKey;
    encryptionKey = '';
    assert.equal((await emailService.getReadiness(shops[0])).configured, false);
    assert.equal(
      (await request('PUT', shops[0], actors[0], { ...body, expected_revision: saved.revision }))
        .statusCode,
      400
    );
    await assert.rejects(
      emailService.sendPasswordOtp(shops[0], { to: actors[0].email, otp: '123456' }),
      /SHOP_SMTP_ENCRYPTION_KEY/
    );
    encryptionKey = key;
    clock = new Date(clock.getTime() + 61000);
    let finishSend;
    pendingDelivery = new Promise((resolve) => {
      finishSend = resolve;
    });
    let started;
    const previousCount = messages.length;
    const inFlight = emailService.sendTest(shops[0], actors[0], {
      expected_revision: saved.revision,
    });
    for (let tries = 0; tries < 100 && messages.length === previousCount; tries += 1)
      await new Promise((resolve) => setTimeout(resolve, 5));
    started = messages.length > previousCount;
    if (!started) {
      finishSend();
      await inFlight;
      throw new Error('Synthetic send did not start');
    }
    const replacement = await emailService.saveSettings(shops[0], actors[0], {
      ...body,
      password: 'Replacement SMTP!',
      expected_revision: saved.revision,
    });
    finishSend();
    await inFlight;
    pendingDelivery = null;
    assert.equal(
      (await emailService.getSettings(shops[0], actors[0])).last_test_status,
      null,
      'Old test completion must not verify replacement credentials'
    );
    assert.equal(replacement.revision !== saved.revision, true);
    const logs = await db('audit_logs')
      .where({ entity: 'shop_email_settings', shop_id: shops[0] })
      .select('old_value', 'new_value');
    const serialized = JSON.stringify(logs);
    assert.equal(serialized.includes(body.password), false);
    assert.equal(serialized.includes('password_ciphertext'), false);
    assert.ok(logs.length >= 3);
    const initialSaves = await Promise.allSettled([
      emailService.saveSettings(shops[2], actors[0], body),
      emailService.saveSettings(shops[2], actors[0], {
        ...body,
        password: 'Concurrent second secret',
      }),
    ]);
    assert.equal(initialSaves.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      initialSaves.find((result) => result.status === 'rejected').reason.statusCode,
      409
    );
    console.info(
      'Shop email: encryption, masked reads, role/shop isolation, stale saves, durable test limit, OTP routing/rollback and test-revision races passed with a fake sender.'
    );
  } finally {
    await app.close();
    for (const actor of actors) invalidateAuthCacheForUser(actor.id);
  }
}
