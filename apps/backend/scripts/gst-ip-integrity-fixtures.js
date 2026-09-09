import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { todayIndiaISODate } from '@wrs/shared';
import serviceDb from '../src/db/knex.js';
import {
  getGstCandidate,
  issueGstInvoices,
  listGstCandidates,
  listIssuedGstInvoices,
  getIssuedGstInvoice,
} from '../src/modules/gst/invoiceService.js';
import {
  applyShopIpCommand,
  resolveShopIpAccess,
} from '../src/modules/ip-whitelist/shopService.js';
import {
  cancelOrder,
  deleteOrder,
  updateOrder,
  adjustOrderDiscountTotal,
} from '../src/modules/orders/service.js';
import { cancelSale, deleteSale, updateSale } from '../src/modules/sales/service.js';
import gstRoutes from '../src/modules/gst/routes.js';
import ipRoutes from '../src/modules/ip-whitelist/routes.js';
import authRoutes from '../src/modules/auth/routes.js';
import authPlugin from '../src/plugins/auth.js';
import auditPlugin from '../src/plugins/audit.js';
import errorHandlerPlugin from '../src/plugins/errorHandler.js';
import paymentRoutes from '../src/modules/payments/routes.js';

export async function runGstIpIntegrityFixtures({ db }) {
  assert.equal(process.env.WRS_TEST_MYSQL_INTEGRATION, '1');
  assert.equal(db.client.config.connection.database, process.env.WRS_TEST_DB_NAME);
  assert.equal(serviceDb.client.config.connection.database, process.env.WRS_TEST_DB_NAME);
  const shops = [randomUUID(), randomUUID()];
  const gstin = '24ABCDE1234F1Z5';
  const date = todayIndiaISODate();
  for (const id of shops)
    await db('shops').insert({
      id,
      shop_name: 'GST test shop',
      company_name: 'GST test supplier',
      address: 'Synthetic address',
      gstin,
    });
  const actors = [
    { id: randomUUID(), role: 'shop_admin', shop: shops[0] },
    { id: randomUUID(), role: 'shop_admin', shop: shops[1] },
    { id: randomUUID(), role: 'viewer', shop: shops[0] },
    { id: randomUUID(), role: 'super_admin', shop: shops[0] },
  ];
  for (const actor of actors) {
    await db('users').insert({
      id: actor.id,
      role: actor.role,
      name: 'GST/IP fixture actor',
      email: `${actor.id}@example.test`,
      password_hash: 'Unused synthetic fixture hash',
      is_active: true,
    });
    await db('users_shops').insert({ user_id: actor.id, shop_id: actor.shop });
  }
  const customer = randomUUID();
  await db('customers').insert({
    id: customer,
    shop_id: shops[0],
    name: 'GST test customer',
    phone1: '9888999000',
    address: 'Synthetic customer address',
  });
  let number = 1;
  const create = async (type = 'booking', amount = 10000, shopId = shops[0]) => {
    const id = randomUUID();
    const no = number++;
    if (type === 'sale') {
      await db('sales').insert({
        id,
        shop_id: shopId,
        sale_number: `S-${no}`,
        bill_no: no,
        bill_type: 'kaccha',
        sale_date: date,
        customer_name: 'GST test customer',
        address: 'Synthetic customer address',
        total_amount: amount,
        subtotal: amount,
        net_amount: amount,
      });
      await db('sale_items').insert({
        id: randomUUID(),
        sale_id: id,
        shop_id: shopId,
        name_snapshot: 'Sale component',
        qty: 1,
        price: amount,
        taxable_price: amount,
        total_amount: amount,
        net_price: amount,
      });
    } else {
      await db('orders').insert({
        id,
        shop_id: shopId,
        customer_id: shopId === shops[0] ? customer : null,
        order_number: `B-${no}`,
        bill_no: no,
        booking_date: date,
        pickup_date: date,
        bill_type: 'kaccha',
        gst_enabled: false,
        status: 'booked',
        total_amount: amount,
        subtotal: amount,
        deposit_amount: 3000,
        pickup_name: 'GST test customer',
        contact_address: 'Synthetic customer address',
      });
      await db('order_items').insert({
        id: randomUUID(),
        order_id: id,
        shop_id: shopId,
        name_snapshot: 'Rent component',
        qty: 1,
        price: amount,
        line_total: amount,
      });
    }
    return id;
  };
  const allocation = async (id, type = 'booking', shop = shops[0], actor = actors[0].id) => {
    const source = await getGstCandidate(shop, actor, type, id);
    return {
      source_type: type,
      source_id: id,
      source_fingerprint: source.source_fingerprint,
      percentage: 20,
      recipient_gstin: '',
      place_of_supply: '24',
      components: source.lines.map((line) => ({
        line_key: line.line_key,
        description: 'Reviewed taxable component',
        hsn_sac: type === 'sale' ? '6203' : '997329',
        gst_gross: line.gross_amount / 5,
        tax_rate: 5,
        non_gst_reason: 'Documented exempt component for synthetic test',
      })),
    };
  };
  const command = (invoices) => ({ idempotency_key: randomUUID(), max_amount: 10000, invoices });
  const rent = await create();
  const sale = await create('sale');
  const tooLarge = await create('booking', 10000.01);
  const query = {
    from: date,
    to: date,
    page: 1,
    per_page: 100,
    source: 'booking',
    max_amount: 10000,
  };
  const eligible = await listGstCandidates(shops[0], actors[0].id, query);
  assert.ok(eligible.rows.some((r) => r.id === rent));
  assert.ok(!eligible.rows.some((r) => r.id === tooLarge));
  const body = command([await allocation(rent), await allocation(sale, 'sale')]);
  const beforePayments = await db('payments')
    .where({ shop_id: shops[0] })
    .count({ count: '*' })
    .first();
  const attempts = await Promise.all([
    issueGstInvoices(shops[0], actors[0].id, body),
    issueGstInvoices(shops[0], actors[0].id, body),
  ]);
  assert.equal(attempts.filter((r) => r.replayed).length, 1);
  assert.equal(attempts[0].invoices.length, 2);
  const invoices = await db('gst_invoices').where({ shop_id: shops[0] }).orderBy('invoice_number');
  assert.equal(new Set(invoices.map((r) => r.invoice_number)).size, 2);
  for (const row of invoices) {
    assert.match(row.invoice_number, /^GST\/\d{2}-\d{2}\/\d{5,6}$/);
    assert.equal(Number(row.grand_total), 2000);
    assert.equal(Number(row.tax_total), 95.24);
  }
  assert.equal(Number((await db('orders').where({ id: rent }).first()).total_amount), 10000);
  assert.equal(Number((await db('orders').where({ id: rent }).first()).deposit_amount), 3000);
  assert.deepEqual(
    await db('payments').where({ shop_id: shops[0] }).count({ count: '*' }).first(),
    beforePayments
  );
  assert.ok(
    !(await listGstCandidates(shops[0], actors[0].id, query)).rows.some((r) => r.id === rent)
  );
  await assert.rejects(
    issueGstInvoices(shops[0], actors[0].id, { ...body, max_amount: 15000 }),
    (e) => e.statusCode === 409
  );
  await assert.rejects(issueGstInvoices(shops[0], actors[3].id, body), (e) => e.statusCode === 409);
  await assert.rejects(
    issueGstInvoices(shops[0], actors[0].id, { ...body, idempotency_key: randomUUID() }),
    (e) => e.statusCode === 409
  );
  const a = await create();
  const b = await create();
  const batch = command([await allocation(a), await allocation(b)]);
  await db('orders').where({ id: b }).update({ total_amount: 9000 });
  const beforeCounter = await db('gst_invoice_sequences').where({ gstin }).first();
  await assert.rejects(
    issueGstInvoices(shops[0], actors[0].id, batch),
    (e) => e.statusCode === 409
  );
  assert.equal((await db('gst_invoices').whereIn('source_id', [a, b])).length, 0);
  assert.equal(
    (await db('gst_invoice_sequences').where({ gstin }).first()).last_number,
    beforeCounter.last_number
  );
  const other = await create('sale', 10000, shops[1]);
  const parallel = await Promise.all([
    issueGstInvoices(shops[0], actors[0].id, command([await allocation(a)])),
    issueGstInvoices(
      shops[1],
      actors[1].id,
      command([await allocation(other, 'sale', shops[1], actors[1].id)])
    ),
  ]);
  assert.notEqual(parallel[0].invoices[0].invoice_number, parallel[1].invoices[0].invoice_number);
  for (const operation of [
    () => updateOrder(shops[0], rent, { items: [] }, actors[0].id),
    () => cancelOrder(shops[0], rent, actors[0].id),
    () => deleteOrder(shops[0], rent, actors[0].id),
    () => adjustOrderDiscountTotal(shops[0], rent, 500, actors[0].id),
    () => updateSale(shops[0], sale, {}, actors[0].id),
    () => cancelSale(shops[0], sale, actors[0].id),
    () => deleteSale(shops[0], sale),
  ])
    await assert.rejects(operation, (e) => e.statusCode === 409);
  assert.equal(
    Number(
      (await listIssuedGstInvoices(shops[0], actors[0].id, { ...query, source: undefined })).summary
        .grand_total
    ),
    6000
  );
  await assert.rejects(
    getIssuedGstInvoice(shops[1], actors[1].id, invoices[0].id),
    (e) => e.statusCode === 404
  );

  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(auditPlugin);
  await app.register(gstRoutes, { prefix: '/api/gst' });
  await app.register(ipRoutes, { prefix: '/api/ip-whitelist' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(paymentRoutes, { prefix: '/api/payments' });
  await app.ready();
  const headers = (actor, shop = actor.shop) => ({
    authorization: `Bearer ${app.jwt.sign({ sub: actor.id })}`,
    'x-shop-id': shop,
  });
  try {
    const paidRent = await create('booking', 8500);
    await db('order_items').where({ order_id: paidRent }).update({ price: 5000, line_total: 5000 });
    await db('order_items').insert({
      id: randomUUID(),
      order_id: paidRent,
      shop_id: shops[0],
      name_snapshot: 'Second test rental',
      qty: 1,
      price: 3500,
      line_total: 3500,
    });
    await db('orders').where({ id: paidRent }).update({ status: 'returned' });
    const receipt = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: headers(actors[0]),
      payload: {
        order_id: paidRent,
        customer_id: customer,
        payment_type: 'cash',
        category: 'final',
        amount: 8500,
        payment_date: date,
      },
    });
    assert.equal(receipt.statusCode, 200, receipt.body);
    const paidBefore = await db('orders').where({ id: paidRent }).first();
    const receiptsBefore = await db('payments').where({ order_id: paidRent }).orderBy('id');
    assert.equal(Number(paidBefore.paid_amount), 8500);

    const savedSupplier = await db('shops').where({ id: shops[0] }).first('gstin', 'address');
    await db('shops').where({ id: shops[0] }).update({ gstin: null, address: null });
    const blockedReview = await app.inject({
      method: 'POST',
      url: '/api/gst/invoices/preview',
      headers: headers(actors[0]),
      payload: command([await allocation(paidRent)]),
    });
    assert.equal(blockedReview.statusCode, 400, blockedReview.body);
    assert.match(blockedReview.json().error.message, /supplier GSTIN and address/);
    assert.equal((await db('gst_invoices').where({ source_id: paidRent })).length, 0);
    await db('shops').where({ id: shops[0] }).update(savedSupplier);

    const paidCommand = command([await allocation(paidRent)]);
    const reviewed = await app.inject({
      method: 'POST',
      url: '/api/gst/invoices/preview',
      headers: headers(actors[0]),
      payload: paidCommand,
    });
    assert.equal(reviewed.statusCode, 200, reviewed.body);
    const reviewedInvoice = reviewed.json().data.invoices[0];
    assert.equal(reviewedInvoice.grand_total, 1700);
    assert.equal(reviewedInvoice.taxable_value, 1619.05);
    assert.equal(reviewedInvoice.tax_total, 80.95);
    assert.equal(reviewedInvoice.non_gst_amount, 6800);
    assert.equal((await db('gst_invoices').where({ source_id: paidRent })).length, 0);
    const issued = await app.inject({
      method: 'POST',
      url: '/api/gst/invoices',
      headers: headers(actors[0]),
      payload: paidCommand,
    });
    assert.equal(issued.statusCode, 200, issued.body);
    const issuedId = issued.json().data.invoices[0].id;
    const opened = await app.inject({
      url: `/api/gst/invoices/${issuedId}`,
      headers: headers(actors[0]),
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json().data.grand_total, 1700);
    assert.equal(opened.json().data.source_id, paidRent);
    assert.equal(opened.json().data.invoice_date, date);
    assert.deepEqual(await db('orders').where({ id: paidRent }).first(), paidBefore);
    assert.deepEqual(
      await db('payments').where({ order_id: paidRent }).orderBy('id'),
      receiptsBefore
    );
    const replayedIssue = await app.inject({
      method: 'POST',
      url: '/api/gst/invoices',
      headers: headers(actors[0]),
      payload: paidCommand,
    });
    assert.equal(replayedIssue.statusCode, 200, replayedIssue.body);
    assert.equal(replayedIssue.json().data.invoices[0].id, issuedId);
    console.info(
      'GST HTTP: paid/returned 8500 booking, missing supplier setup, read-only review, 1700 issuance, document lookup and payment preservation passed.'
    );

    assert.equal(
      (await app.inject({ url: '/api/gst/invoices', query, headers: headers(actors[2]) }))
        .statusCode,
      403
    );
    assert.equal(
      (await app.inject({ url: '/api/ip-whitelist/', headers: headers(actors[0]) })).statusCode,
      403
    );
    const own = await app.inject({ url: '/api/ip-whitelist/shop', headers: headers(actors[0]) });
    assert.equal(own.statusCode, 200, own.body);
    assert.ok(!own.json().data.users.some((u) => u.id === actors[1].id));
    assert.equal(
      (await app.inject({ url: '/api/ip-whitelist/shop', headers: headers(actors[0], shops[1]) }))
        .statusCode,
      403
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/select-shop',
          headers: headers(actors[0]),
          payload: { shop_id: shops[1] },
        })
      ).statusCode,
      403
    );
    const ipCommand = {
      idempotency_key: randomUUID(),
      expected_revision: 0,
      policy: { kind: 'shop', enabled: true, allowed_ranges: ['127.0.0.1'] },
    };
    const saved = await app.inject({
      method: 'POST',
      url: `/api/ip-whitelist/shop/${shops[0]}/commands`,
      headers: headers(actors[0]),
      payload: ipCommand,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(
      (await applyShopIpCommand(shops[0], actors[0].id, '127.0.0.1', ipCommand)).replayed,
      true
    );
    await assert.rejects(
      applyShopIpCommand(shops[0], actors[0].id, '127.0.0.1', {
        ...ipCommand,
        idempotency_key: randomUUID(),
      }),
      (e) => e.statusCode === 409
    );
    await assert.rejects(
      applyShopIpCommand(shops[0], actors[0].id, '127.0.0.1', {
        idempotency_key: randomUUID(),
        expected_revision: 1,
        policy: { kind: 'shop', enabled: true, allowed_ranges: ['192.0.2.1'] },
      }),
      (e) => e.statusCode === 409
    );
    await assert.rejects(
      applyShopIpCommand(shops[0], actors[0].id, '127.0.0.1', {
        idempotency_key: randomUUID(),
        expected_revision: 1,
        policy: { kind: 'user', user_id: actors[1].id, mode: 'anywhere', allowed_ranges: [] },
      }),
      (e) => e.statusCode === 403
    );
    const disallowed = await app.inject({
      url: '/api/auth/me',
      headers: headers(actors[0]),
      remoteAddress: '192.0.2.20',
    });
    assert.equal(disallowed.statusCode, 403, disallowed.body);
    assert.equal(
      (
        await app.inject({
          url: '/api/auth/me',
          headers: headers(actors[3]),
          remoteAddress: '192.0.2.20',
        })
      ).statusCode,
      200
    );
    await db('users_shops').insert({ user_id: actors[0].id, shop_id: shops[1] });
    const staffPolicy = await app.inject({
      method: 'POST',
      url: `/api/ip-whitelist/shop/${shops[0]}/commands`,
      headers: headers(actors[0]),
      payload: {
        idempotency_key: randomUUID(),
        expected_revision: 1,
        policy: {
          kind: 'user',
          user_id: actors[2].id,
          mode: 'restricted',
          allowed_ranges: ['192.0.2.20'],
        },
      },
    });
    assert.equal(staffPolicy.statusCode, 200, staffPolicy.body);
    for (const [ip, status] of [
      ['127.0.0.1', 403],
      ['192.0.2.20', 200],
    ]) {
      const response = await app.inject({
        url: '/api/auth/me',
        headers: headers(actors[2]),
        remoteAddress: ip,
      });
      assert.equal(response.statusCode, status, response.body);
    }
    const resetStaffPolicy = await app.inject({
      method: 'POST',
      url: `/api/ip-whitelist/shop/${shops[0]}/commands`,
      headers: headers(actors[0]),
      payload: {
        idempotency_key: randomUUID(),
        expected_revision: 2,
        policy: { kind: 'user', user_id: actors[2].id, mode: 'inherit', allowed_ranges: [] },
      },
    });
    assert.equal(resetStaffPolicy.statusCode, 200, resetStaffPolicy.body);
    for (const [ip, status] of [
      ['127.0.0.1', 200],
      ['192.0.2.20', 403],
    ]) {
      const response = await app.inject({
        url: '/api/auth/me',
        headers: headers(actors[2]),
        remoteAddress: ip,
      });
      assert.equal(response.statusCode, status, response.body);
    }
    assert.equal(
      (await resolveShopIpAccess(db, shops[0], actors[0].id, '192.0.2.20')).allowed,
      false
    );
    assert.equal(
      (await resolveShopIpAccess(db, shops[1], actors[0].id, '192.0.2.20')).allowed,
      true
    );
  } finally {
    await app.close();
  }
  const bulkShop = randomUUID();
  await db('shops').insert({
    id: bulkShop,
    shop_name: 'GST bulk test',
    company_name: 'GST test supplier',
    address: 'Synthetic address',
    gstin,
  });
  await db('users_shops').insert({ shop_id: bulkShop, user_id: actors[1].id });
  const bulkIds = [];
  for (let i = 0; i < 100; i += 1) bulkIds.push(await create('sale', 10000, bulkShop));
  const selectedTwenty = await Promise.all(
    bulkIds.slice(0, 20).map((id) => allocation(id, 'sale', bulkShop, actors[1].id))
  );
  assert.equal(
    (await issueGstInvoices(bulkShop, actors[1].id, command(selectedTwenty))).invoices.length,
    20
  );
  assert.equal(
    (await listGstCandidates(bulkShop, actors[1].id, { ...query, source: 'sale' })).meta.total,
    80
  );
  assert.equal(
    Number(
      (await db('sales').where({ shop_id: bulkShop }).sum({ total: 'total_amount' }).first()).total
    ),
    1000000
  );
  assert.equal(
    Number(
      (await listIssuedGstInvoices(bulkShop, actors[1].id, { ...query, source: 'sale' })).summary
        .grand_total
    ),
    40000
  );
  console.info(
    'GST/IP: inclusive allocations, atomic batches, replay, shared numbering, source locks, tenant isolation, IP revisions and recovery checks passed.'
  );
}
