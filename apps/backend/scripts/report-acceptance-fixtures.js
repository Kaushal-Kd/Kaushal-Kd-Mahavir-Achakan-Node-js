import assert from 'node:assert/strict';

import { resolvePaymentOrderStatus } from '@wrs/shared';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';

import serviceDb from '../src/db/knex.js';
import { listBookedProducts } from '../src/modules/orders/service.js';
import { listSecurityDue } from '../src/modules/payments/securityDueService.js';
import { listSecurityTransactions } from '../src/modules/payments/securityTransactionsService.js';
import { getIncomeExpenseReport } from '../src/modules/reports/incomeExpenseService.js';
import { sqlPaymentOrderStatusSelect } from '../src/modules/reports/orderPaymentReportHelpers.js';
import { getSalesmanReport } from '../src/modules/reports/salesmanReportService.js';

export async function runReportAcceptanceFixtures({
  db,
  shopId,
  customerId,
  paymentAccountId,
  securityAccountId,
  incomeAccountId,
  expenseAccountId,
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
    throw new Error('Report fixtures require the explicitly selected disposable MySQL database');
  }
  const token = `RPT-${uuid().slice(0, 8)}`;
  const range = { from: '2031-04-01', to: '2031-04-03', search: token };
  const bankId = uuid();
  const vendorId = uuid();
  await db('payment_accounts').insert([
    {
      id: bankId,
      shop_id: shopId,
      name: 'Report bank',
      account_group: 'Bank Accounts',
      is_active: true,
    },
    {
      id: vendorId,
      shop_id: shopId,
      name: 'Report vendor',
      account_group: 'Vendors',
      is_active: true,
    },
  ]);
  const order = await createOrder();
  await db('orders')
    .where({ id: order.orderId })
    .update({
      order_number: `${token}-O`,
      booking_date: range.from,
      pickup_date: '2031-04-02',
      return_date: range.to,
      status: 'returned',
      delivered_at: '2031-04-02 09:00:00',
      returned_at: '2031-04-03 09:00:00',
    });
  const payment = async (amount, category, stage, day, extra = {}) => {
    const id = uuid();
    await db('payments').insert({
      id,
      shop_id: shopId,
      order_id: order.orderId,
      customer_id: customerId,
      amount,
      category,
      payment_stage: stage,
      payment_type: 'cash',
      payment_account_id: paymentAccountId,
      payment_date: day,
      created_at: `${day} 10:00:00`,
      notes: token,
      ...extra,
    });
    return id;
  };
  const bookingPayment = await payment(11, 'advance', 'booking', range.from);
  const deliveryPayment = await payment(13, 'partial', 'delivery', '2031-04-02', {
    payment_account_id: bankId,
  });
  const returnPayment = await payment(17, 'final', 'return', range.to);
  await payment(19, 'deposit', 'booking', range.from, {
    payment_account_id: null,
    security_account_id: securityAccountId,
  });
  await payment(131, 'deposit', 'booking', range.from, { payment_account_id: bankId });
  await payment(7, 'deposit_refund', 'return', range.to, { payment_account_id: bankId });
  await payment(5, 'refund', 'return', range.to);
  const purchaseId = uuid();
  const saleId = uuid();
  await db('purchases').insert({
    id: purchaseId,
    shop_id: shopId,
    purchase_number: `${token}-PU`,
    bill_no: 990001,
    purchase_date: range.from,
    vendor_account_id: vendorId,
    purchase_account_id: expenseAccountId,
    total_amount: 100,
  });
  await db('sales').insert({
    id: saleId,
    shop_id: shopId,
    sale_number: `${token}-S`,
    bill_no: 990001,
    sale_date: range.from,
    customer_name: token,
    total_amount: 100,
  });
  await db('sale_items').insert({
    id: uuid(),
    shop_id: shopId,
    sale_id: saleId,
    name_snapshot: 'Three sale units',
    qty: 3,
    price: 10,
  });
  const saleCount = await getSalesmanReport(shopId, {
    from: range.from,
    to: range.to,
    type: 'sale',
  });
  assert.equal(
    saleCount.summary.product_count,
    3,
    'Sale product counts are units, consistently with booking products'
  );
  await payment(43, 'partial', null, '2031-04-02', { order_id: null, purchase_id: purchaseId });
  await payment(47, 'partial', null, '2031-04-02', { order_id: null, sale_id: saleId });
  await payment(7, 'refund', null, range.to, { order_id: null, sale_id: saleId });
  const incomeId = uuid();
  const expenseId = uuid();
  const rvId = uuid();
  const pvId = uuid();
  await db('income_entries').insert([
    {
      id: incomeId,
      shop_id: shopId,
      income_account_id: incomeAccountId,
      payment_account_id: paymentAccountId,
      name: token,
      details: token,
      bill_no: 990100,
      income_number: `${token}-IN`,
      entry_date: range.from,
      amount: 23,
    },
    {
      id: uuid(),
      shop_id: shopId,
      income_account_id: incomeAccountId,
      payment_account_id: paymentAccountId,
      name: 'Excluded report row',
      details: 'Different search token',
      bill_no: 990101,
      income_number: `EXCLUDED-${uuid().slice(0, 8)}`,
      entry_date: range.from,
      amount: 29,
    },
  ]);
  await db('expense_entries').insert({
    id: expenseId,
    shop_id: shopId,
    expense_account_id: expenseAccountId,
    payment_account_id: paymentAccountId,
    name: token,
    details: token,
    bill_no: 990100,
    expense_number: `${token}-EX`,
    entry_date: range.from,
    amount: 31,
  });
  await db('receipt_vouchers').insert({
    id: rvId,
    shop_id: shopId,
    voucher_number: `${token}-RV`,
    debit_account_id: paymentAccountId,
    credit_account_id: vendorId,
    entry_date: range.from,
    amount: 37,
    remarks: token,
  });
  await db('payment_vouchers').insert({
    id: pvId,
    shop_id: shopId,
    voucher_number: `${token}-PV`,
    credit_account_id: paymentAccountId,
    debit_account_id: vendorId,
    bill_kind: 'purchase',
    bill_id: purchaseId,
    entry_date: range.from,
    amount: 41,
    remarks: token,
  });

  const expectedTypes = {
    all: [148, 127],
    booking_payment: [41, 5],
    order_payment_booked: [11, 0],
    order_payment_delivered: [13, 0],
    order_payment_returned: [17, 5],
    sale_payment: [47, 7],
    purchase: [0, 43],
    income_entry: [23, 0],
    expense_entry: [0, 31],
    receipt_voucher: [37, 0],
    payment_voucher: [0, 41],
  };
  for (const [transaction_type, [income, expense]] of Object.entries(expectedTypes)) {
    const report = await getIncomeExpenseReport(shopId, { ...range, transaction_type });
    assert.equal(report.summary.income_total, income, `${transaction_type}: matching income total`);
    assert.equal(
      report.summary.expense_total,
      expense,
      `${transaction_type}: matching expense total`
    );
    assert.equal(
      report.income_rows.reduce((sum, row) => sum + row.amount, 0),
      income
    );
    assert.equal(
      report.expense_rows.reduce((sum, row) => sum + row.amount, 0),
      expense
    );
  }
  const all = await getIncomeExpenseReport(shopId, range);
  for (const [id, stage] of [
    [bookingPayment, 'Booked'],
    [deliveryPayment, 'Delivered'],
    [returnPayment, 'Returned'],
  ]) {
    assert.match(
      all.income_rows.find((row) => row.source_id === id).details,
      new RegExp(`BOOKING - ${stage}`)
    );
  }
  assert.equal(all.income_rows.find((row) => row.source_id === incomeId).bill_no, `${token}-IN`);
  assert.equal(all.expense_rows.find((row) => row.source_id === expenseId).bill_no, `${token}-EX`);
  const receipt = all.income_rows.find((row) => row.source_id === rvId);
  assert.equal(receipt.reference_kind, 'receipt_voucher');
  assert.equal(receipt.voucher_id, rvId);
  const voucher = all.expense_rows.find((row) => row.source_id === pvId);
  assert.equal(voucher.reference_kind, 'payment_voucher');
  assert.equal(voucher.voucher_id, pvId);
  assert.equal(voucher.linked_bill_id, purchaseId);
  assert.equal(voucher.linked_bill_number, `${token}-PU`);
  assert.equal(all.expense_rows.find((row) => row.sale_id === saleId).bill_no, `${token}-S`);
  const bankOnly = await getIncomeExpenseReport(shopId, { ...range, payment_account_id: bankId });
  assert.equal(bankOnly.summary.income_total, 13);
  assert.equal(bankOnly.summary.expense_total, 0);
  const absent = await getIncomeExpenseReport(shopId, { ...range, search: `${token}-not-found` });
  assert.equal(absent.summary.income_total + absent.summary.expense_total, 0);
  const dateOnly = await getIncomeExpenseReport(shopId, { ...range, from: range.to, to: range.to });
  assert.equal(dateOnly.summary.income_total, 17);
  assert.equal(dateOnly.summary.expense_total, 12);
  const linkedSearch = await getIncomeExpenseReport(shopId, {
    ...range,
    search: `${token}-PU`,
    transaction_type: 'payment_voucher',
  });
  assert.equal(linkedSearch.summary.expense_total, 41);

  const legacy = await createOrder();
  await db('orders')
    .where({ id: legacy.orderId })
    .update({
      order_number: `${token}-LEG`,
      status: 'returned',
      delivered_at: null,
      returned_at: null,
      packed_at: null,
    });
  const legacyRows = [
    { id: uuid(), created_at: '2031-04-01 01:00:00', order_status_at_payment: 'returned' },
    { id: uuid(), created_at: '2031-04-01 02:00:00', order_status_at_payment: null },
  ];
  for (const row of legacyRows)
    await payment(1, 'partial', null, range.from, {
      ...row,
      order_id: legacy.orderId,
      notes: `${token}-LEG`,
    });
  for (const [index, row] of legacyRows.entries()) {
    const status = resolvePaymentOrderStatus({
      ...row,
      order_status: 'returned',
      is_follow_up_order_payment: index > 0,
    });
    const report = await getIncomeExpenseReport(shopId, {
      ...range,
      search: `${token}-LEG`,
      transaction_type: `order_payment_${status}`,
    });
    assert.ok(
      report.income_rows.some((entry) => entry.source_id === row.id),
      'SQL stage filter agrees with displayed legacy stage'
    );
  }
  await db('orders').where({ id: legacy.orderId }).update({
    status: 'in_preparation',
    delivered_at: '2031-04-02 01:00:00',
  });
  const handoverId = await payment(1, 'partial', null, range.from, {
    order_id: legacy.orderId,
    created_at: '2031-04-01 20:30:00',
    notes: `${token}-HANDOVER`,
  });
  const storedHandover = await serviceDb('payments as p')
    .join('orders as o', 'o.id', 'p.order_id')
    .where({ 'p.id': handoverId, 'p.shop_id': shopId })
    .select('p.created_at', 'o.delivered_at', sqlPaymentOrderStatusSelect(serviceDb))
    .first();
  assert.equal(
    storedHandover.created_at.toISOString(),
    '2031-04-01T20:30:00.000Z',
    'Fixture inserts must use a UTC MySQL session, not only driver timezone Z'
  );
  assert.equal(
    storedHandover.delivered_at.toISOString(),
    '2031-04-02T01:00:00.000Z',
    'Fixture and application connections must agree on the stored delivery instant'
  );
  assert.equal(
    storedHandover.payment_order_status,
    'delivered',
    'Raw SQL classifies the verified UTC instants before date/search filters'
  );
  const handoverStatus = resolvePaymentOrderStatus({
    created_at: new Date('2031-04-01T20:30:00Z'),
    delivered_at: new Date('2031-04-02T01:00:00Z'),
    order_status: 'in_preparation',
    is_follow_up_order_payment: true,
  });
  assert.equal(handoverStatus, 'delivered');
  const handover = await getIncomeExpenseReport(shopId, {
    ...range,
    search: `${token}-HANDOVER`,
    transaction_type: 'order_payment_delivered',
  });
  assert.equal(
    handover.income_rows[0]?.source_id,
    handoverId,
    'Legacy same-India-day delivery inference agrees with SQL across a UTC midnight'
  );

  const many = Array.from({ length: 501 }, (_, index) => ({
    id: uuid(),
    shop_id: shopId,
    income_account_id: incomeAccountId,
    payment_account_id: paymentAccountId,
    name: `${token}-SORT`,
    details: String(index),
    bill_no: 990200 + index,
    income_number: `${token}-SORT-${index}`,
    entry_date: '2031-05-01',
    amount: 1,
    created_at: new Date(Date.UTC(2031, 4, 1, 0, 0, index)),
  }));
  await db.batchInsert('income_entries', [...many].reverse(), 100);
  const oldest = await getIncomeExpenseReport(shopId, {
    from: '2031-05-01',
    to: '2031-05-01',
    search: `${token}-SORT`,
    sort_dir: 'asc',
    transaction_type: 'income_entry',
  });
  assert.equal(oldest.income_rows.length, 500);
  assert.equal(oldest.income_rows[0].source_id, many[0].id);
  assert.equal(oldest.income_rows[499].source_id, many[499].id);
  assert.equal(oldest.summary.income_total, 501);

  const legacyReceipts = Array.from({ length: 501 }, (_, index) => ({
    id: uuid(),
    shop_id: shopId,
    order_id: order.orderId,
    customer_id: customerId,
    amount: 1,
    category: 'partial',
    payment_stage: 'booking',
    payment_type: 'cash',
    payment_account_id: null,
    payment_date: '2031-05-02',
    notes: `${token}-LEGACY-RENT`,
    created_at: new Date(Date.UTC(2031, 4, 2, 0, 0, index)),
  }));
  const deposits = legacyReceipts.map((row) => ({
    ...row,
    id: uuid(),
    amount: 10,
    category: 'deposit',
    payment_account_id: bankId,
    notes: `${token}-DEPOSIT`,
  }));
  await db.batchInsert('payments', [...legacyReceipts, ...deposits], 100);
  const cappedRent = await getIncomeExpenseReport(shopId, {
    from: '2031-05-02',
    to: '2031-05-02',
    search: token,
  });
  assert.equal(
    cappedRent.summary.income_total,
    501,
    'Security classification uses payment category before uncapped totals'
  );
  assert.equal(cappedRent.income_rows.length, 500);
  assert.equal(
    cappedRent.income_rows.reduce((total, row) => total + row.amount, 0),
    500
  );
  assert.ok(
    cappedRent.income_rows.every((row) => row.payment_account === ''),
    'Legitimate legacy rent receipts without an account remain visible'
  );
  const depositsOnly = await getIncomeExpenseReport(shopId, {
    from: '2031-05-02',
    to: '2031-05-02',
    search: `${token}-DEPOSIT`,
  });
  assert.equal(depositsOnly.summary.income_total, 0);
  assert.equal(depositsOnly.income_rows.length, 0);

  await verifySecurityReports({ db, shopId, customerId, securityAccountId, createOrder, token });
  await verifySalesmanReports({ db, shopId, createProduct, createOrder, token });
  console.info(
    'Finance filters/status/references, security dates/quantities, and salesman commission report fixtures passed.'
  );
}

async function verifySecurityReports({
  db,
  shopId,
  customerId,
  securityAccountId,
  createOrder,
  token,
}) {
  const states = ['delivered', 'partially_returned', 'returned'];
  const orders = [];
  for (const [index, state] of states.entries()) {
    const order = await createOrder();
    orders.push(order);
    const day = `2031-06-0${index + 1}`;
    await db('orders')
      .where({ id: order.orderId })
      .update({ order_number: `${token}-SEC${index}`, pickup_date: day, status: state });
    await db('order_items')
      .where({ id: order.itemId })
      .update({ stage_flags: JSON.stringify({ delivered: true, received: index > 0 }) });
    if (index === 1)
      await db('order_accessories').insert({
        id: uuid(),
        shop_id: shopId,
        order_id: order.orderId,
        name_snapshot: 'Partial missing quantity',
        qty: 3,
        type: 'rent',
        price: 0,
        missing: true,
        missing_qty: 1,
        stage_flags: JSON.stringify({ delivered: true, received: true }),
      });
    await db('payments').insert({
      id: uuid(),
      shop_id: shopId,
      order_id: order.orderId,
      customer_id: customerId,
      payment_type: 'cash',
      category: 'deposit',
      amount: 100,
      payment_date: day,
      security_account_id: securityAccountId,
    });
  }
  const due = await listSecurityDue(shopId, {
    from: '2031-06-01',
    to: '2031-06-03',
    search: `${token}-SEC`,
    per_page: 500,
  });
  assert.equal(due.data.length, 3);
  for (const [index, order] of orders.entries())
    assert.equal(
      due.data.find((row) => row.order_id === order.orderId).derived_status,
      states[index]
    );
  const one = await listSecurityDue(shopId, {
    from: '2031-06-02',
    to: '2031-06-02',
    search: `${token}-SEC1`,
  });
  assert.equal(one.data.length, 1);
  assert.equal(one.summary.total_pending, 100);
  const none = await listSecurityDue(shopId, {
    from: '2031-06-01',
    to: '2031-06-03',
    search: `${token}-absent`,
  });
  assert.equal(none.summary.total_collected, 0);
  const transactions = await listSecurityTransactions(shopId, {
    from: '2031-06-01',
    to: '2031-06-03',
    security_account_id: securityAccountId,
  });
  assert.equal(transactions.data.length, 3);
  assert.equal(transactions.summary.total_received, 300);
  const booked = await listBookedProducts(shopId, {
    from: '2031-06-01',
    to: '2031-06-03',
    search: `${token}-SEC`,
  });
  assert.equal(booked.data.length, 3);
  const middle = await listBookedProducts(shopId, {
    from: '2031-06-02',
    to: '2031-06-02',
    search: `${token}-SEC`,
  });
  assert.equal(middle.data.length, 1);
}

async function verifySalesmanReports({ db, shopId, createProduct, createOrder, token }) {
  const salesmen = [uuid(), uuid()];
  const passwordHash = await bcrypt.hash('Synthetic-report-fixture-only', 12);
  for (const [index, id] of salesmen.entries()) {
    await db('users').insert({
      id,
      name: `${token}-Salesman${index}`,
      email: `${id}@example.test`,
      password_hash: passwordHash,
      role: 'salesman',
      is_active: false,
    });
    await db('users_shops').insert({
      shop_id: shopId,
      user_id: id,
      commission_basis: 'booking',
      commission_rate: 10,
    });
  }
  const categoryIds = [uuid(), uuid()];
  await db('categories').insert(
    categoryIds.map((id, index) => ({
      id,
      shop_id: shopId,
      label: `${token}-Category${index}`,
      category_type: 'product',
    }))
  );
  const firstProduct = await createProduct(10);
  const first = await createOrder({ productId: firstProduct });
  const secondProduct = await createProduct(10);
  const second = await createOrder({ productId: secondProduct });
  await db('products').where({ id: firstProduct }).update({ category_id: categoryIds[0] });
  await db('products').where({ id: secondProduct }).update({ category_id: categoryIds[1] });
  await db('orders')
    .whereIn('id', [first.orderId, second.orderId])
    .update({ sales_person_id: salesmen[0], booking_date: '2031-07-01', status: 'delivered' });
  await db('orders')
    .where({ id: first.orderId })
    .update({ subtotal: 200, booking_discount_amount: 20, discount_total: 20, total_amount: 180 });
  await db('order_items')
    .where({ id: first.itemId })
    .update({ sales_person_id: salesmen[0], price: 100 });
  await db('order_items').insert({
    id: uuid(),
    shop_id: shopId,
    order_id: first.orderId,
    product_id: firstProduct,
    sales_person_id: salesmen[1],
    name_snapshot: 'Second salesman product',
    qty: 1,
    price: 100,
    line_total: 100,
    type: 'rent',
  });
  const reportQuery = { from: '2031-07-01', to: '2031-07-01', type: 'booking' };
  const filtered = await getSalesmanReport(shopId, {
    ...reportQuery,
    sales_person_id: salesmen[1],
  });
  assert.equal(filtered.summary.product_amount, 100);
  assert.equal(
    filtered.summary.bill_discount,
    10,
    'A salesman filter preserves their proportional bill discount'
  );
  const category = await getSalesmanReport(shopId, {
    ...reportQuery,
    sales_person_id: salesmen[0],
    category_id: categoryIds[0],
  });
  assert.equal(
    category.summary.commission_amount,
    10,
    'A category filter must not count another-category booking on the same date'
  );
  assert.equal(category.summary.bill_count, 1);
  await db('order_items')
    .where({ order_id: first.orderId })
    .update({ sales_person_id: salesmen[1] });
  const bookingOwner = await getSalesmanReport(shopId, {
    ...reportQuery,
    sales_person_id: salesmen[0],
    category_id: categoryIds[0],
  });
  assert.equal(bookingOwner.summary.product_count, 0);
  assert.equal(
    bookingOwner.summary.commission_amount,
    10,
    'Category-filtered booking commission follows the owner even when all products are assigned elsewhere'
  );
  await db('order_items')
    .where({ order_id: first.orderId })
    .update({ sales_person_id: salesmen[0] });
  await db('users_shops')
    .where({ shop_id: shopId, user_id: salesmen[0] })
    .update({ commission_basis: 'product' });
  const products = await getSalesmanReport(shopId, {
    ...reportQuery,
    sales_person_id: salesmen[0],
    category_id: categoryIds[0],
  });
  assert.equal(products.summary.commission_amount, 20);
  await db('orders').where({ id: first.orderId }).update({ sales_person_id: salesmen[1] });
  await db('order_items')
    .where({ order_id: first.orderId })
    .update({ sales_person_id: salesmen[1] });
  const oldOwner = await getSalesmanReport(shopId, {
    ...reportQuery,
    sales_person_id: salesmen[0],
    category_id: categoryIds[0],
  });
  const newOwner = await getSalesmanReport(shopId, {
    ...reportQuery,
    sales_person_id: salesmen[1],
    category_id: categoryIds[0],
  });
  assert.equal(oldOwner.summary.commission_amount, 0);
  assert.equal(newOwner.summary.commission_amount, 10);
}
