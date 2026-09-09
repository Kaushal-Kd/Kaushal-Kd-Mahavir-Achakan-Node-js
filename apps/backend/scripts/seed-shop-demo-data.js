/**
 * Seed realistic demo data for a single shop (dashboard + list pages).
 *
 * Usage:
 *   node scripts/seed-shop-demo-data.js
 *   node scripts/seed-shop-demo-data.js --force
 *   SEED_DEMO_SHOP_ID=<uuid> node scripts/seed-shop-demo-data.js
 */
import {
  addDays,
  resolveFullProductCode,
  todayIndiaISODate,
  toLocalISODate,
} from '@wrs/shared';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';

import knex from '../src/db/knex.js';
import { createCustomOrder } from '../src/modules/custom-orders/service.js';
import { createCustomer } from '../src/modules/customers/service.js';
import {
  batchUpdateOrderStatusFlags,
  createOrder,
  getOrder,
} from '../src/modules/orders/service.js';
import * as paymentAccountsService from '../src/modules/payment-accounts/service.js';
import { insertOrderPayment } from '../src/modules/payments/orderStatusAtPayment.js';
import { recomputeOrderPayment } from '../src/modules/payments/recomputeOrderPayment.js';
import { createProduct } from '../src/modules/products/service.js';
import { createSale } from '../src/modules/sales/service.js';
import * as securityAccountsService from '../src/modules/security-accounts/service.js';

const DEMO_MARKER = 'DEMO_SEED';
const DEMO_SETTING_KEY = 'demo_seed_v1';
const DEFAULT_SHOP_ID = 'f24390c9-8a37-4e46-bdc4-d0571995bc7c';

const SHOP_ID = process.env.SEED_DEMO_SHOP_ID || DEFAULT_SHOP_ID;
const FORCE = process.argv.includes('--force');

const TODAY = todayIndiaISODate();
const day = (offset) => toLocalISODate(addDays(TODAY, offset));

const PRODUCT_NAMES = [
  'Royal Sherwani Gold',
  'Classic Sherwani Ivory',
  'Designer Lehenga Red',
  'Bridal Lehenga Maroon',
  'Indo-Western Suit Navy',
  'Jodhpuri Suit Black',
  'Kurta Set Cream',
  'Pathani Suit Grey',
  'Wedding Gown White',
  'Anarkali Suit Pink',
  'Bandhgala Blue',
  'Achkan Maroon',
  'Churidar Set Beige',
  'Tuxedo Black',
  'Blazer Set Charcoal',
  'Kids Sherwani Blue',
  'Kids Lehenga Green',
  'Mermaid Gown Peach',
  'Palazzo Set Mint',
  'Sharara Set Gold',
  'Sangeet Outfit Purple',
  'Reception Suit Silver',
  'Engagement Kurta Teal',
  'Haldi Outfit Yellow',
  'Mehendi Outfit Orange',
];

const SELL_ONLY_NAMES = [
  'Demo Turban Pack',
  'Demo Stole Set',
  'Demo Jewellery Box',
  'Demo Mojdi Pair',
];

const ACCESSORY_NAMES = [
  'Turban Red',
  'Turban Gold',
  'Mojdi Brown',
  'Mojdi White',
  'Stole Maroon',
  'Stole Cream',
  'Brooch Set',
  'Kamarbandh Gold',
  'Dupatta Net',
  'Pagdi Pink',
  'Jewellery Set',
  'Safa Blue',
];

const CUSTOMER_FIRST_NAMES = [
  'Raj',
  'Amit',
  'Vikram',
  'Rahul',
  'Karan',
  'Arjun',
  'Priya',
  'Neha',
  'Anjali',
  'Pooja',
  'Sneha',
  'Divya',
  'Rohan',
  'Suresh',
  'Manish',
  'Kunal',
  'Harsh',
  'Nikhil',
  'Deepak',
  'Sanjay',
];

function log(msg) {
  console.info(`[seed:demo] ${msg}`);
}

export function buildRentOrderPayload({
  customer,
  product,
  bookingDate,
  pickupDate,
  returnDate,
  extras = {},
}) {
  const price = Number(product.price_rent || 2500);
  const subtotal = price;
  return {
    customer_id: customer.id,
    booking_date: bookingDate,
    pickup_date: pickupDate,
    return_date: returnDate,
    pickup_name: customer.name.replace(/^Demo /, ''),
    pickup_number: customer.phone1,
    contact_phone1: customer.phone1,
    items: [
      {
        product_id: product.id,
        name_snapshot: product.name,
        qty: 1,
        price,
        discount: 0,
        type: 'rent',
        item_type: 'product',
      },
    ],
    subtotal,
    discount_total: 0,
    tax_total: 0,
    extra_charges: 0,
    total_amount: subtotal,
    bill_type: 'kaccha',
    gst_enabled: false,
    status: 'booked',
    reference_name: DEMO_MARKER,
    ...extras,
  };
}

export function resolveDemoProductStoredCode(code, size) {
  return resolveFullProductCode(code, size);
}

async function applyStagePlan(shopId, orderId, userId, plan) {
  const order = await getOrder(shopId, orderId);
  const itemIds = (order.items || []).map((i) => i.id);
  if (!itemIds.length) return;

  const steps = [];
  if (plan === 'collected') {
    for (const id of itemIds) steps.push({ item_id: id, field: 'item_to_collect', value: true });
  } else if (plan === 'prepared') {
    for (const id of itemIds) {
      steps.push({ item_id: id, field: 'item_to_collect', value: true });
      steps.push({ item_id: id, field: 'prepared', value: true });
    }
  } else if (plan === 'delivered') {
    for (const id of itemIds) {
      steps.push({ item_id: id, field: 'item_to_collect', value: true });
      steps.push({ item_id: id, field: 'prepared', value: true });
      steps.push({ item_id: id, field: 'delivered', value: true });
    }
  } else if (plan === 'returned') {
    for (const id of itemIds) {
      steps.push({ item_id: id, field: 'item_to_collect', value: true });
      steps.push({ item_id: id, field: 'prepared', value: true });
      steps.push({ item_id: id, field: 'delivered', value: true });
      steps.push({ item_id: id, field: 'received', value: true });
    }
  }

  if (steps.length) {
    await batchUpdateOrderStatusFlags(shopId, orderId, steps, userId);
  }
}

async function resolveUserId(shopId) {
  const link = await knex('users_shops').where({ shop_id: shopId }).orderBy('is_default', 'desc').first();
  if (link?.user_id) return link.user_id;
  const shop = await knex('shops').where({ id: shopId }).first();
  if (shop?.owner_user_id) return shop.owner_user_id;
  const user = await knex('users').orderBy('created_at', 'asc').first();
  return user?.id || null;
}

async function isAlreadySeeded(shopId) {
  const row = await knex('settings').where({ shop_id: shopId, key: DEMO_SETTING_KEY }).first();
  return Boolean(row);
}

async function cleanDemoData(shopId) {
  log('Cleaning existing demo data...');

  const demoCustomerIds = await knex('customers')
    .where({ shop_id: shopId })
    .andWhere('name', 'like', 'Demo %')
    .pluck('id');

  const demoOrderIds = await knex('orders')
    .where({ shop_id: shopId })
    .where(function markDemoOrders() {
      this.where({ reference_name: DEMO_MARKER });
      if (demoCustomerIds.length) {
        this.orWhereIn('customer_id', demoCustomerIds);
      }
    })
    .pluck('id');

  const demoSaleIds = await knex('sales').where({ shop_id: shopId, remark: DEMO_MARKER }).pluck('id');

  const demoCustomOrderIds = await knex('custom_orders')
    .where({ shop_id: shopId, remarks: DEMO_MARKER })
    .pluck('id');

  await knex.transaction(async (trx) => {
    if (demoOrderIds.length) {
      await trx('payments').whereIn('order_id', demoOrderIds).delete();

      const hasCreditApps = await trx.schema.hasTable('credit_note_applications');
      if (hasCreditApps) {
        await trx('credit_note_applications').whereIn('order_id', demoOrderIds).delete();
      }
      const hasCreditNotes = await trx.schema.hasTable('credit_notes');
      if (hasCreditNotes) {
        await trx('credit_notes').whereIn('source_order_id', demoOrderIds).delete();
      }
      const hasSecurityCharges = await trx.schema.hasTable('security_charges');
      if (hasSecurityCharges) {
        await trx('security_charges').whereIn('order_id', demoOrderIds).delete();
      }

      await trx('order_edit_logs').whereIn('order_id', demoOrderIds).delete();
      await trx('order_items').whereIn('order_id', demoOrderIds).delete();
      await trx('order_accessories').whereIn('order_id', demoOrderIds).delete();
      await trx('orders').whereIn('id', demoOrderIds).delete();
    }

    if (demoSaleIds.length) {
      await trx('payments').whereIn('sale_id', demoSaleIds).delete();
      await trx('sale_items').whereIn('sale_id', demoSaleIds).delete();
      await trx('sales').whereIn('id', demoSaleIds).delete();
    }

    if (demoCustomOrderIds.length) {
      await trx('custom_orders').whereIn('id', demoCustomOrderIds).delete();
    }

    await trx('reminders')
      .where({ shop_id: shopId })
      .andWhere('description', 'like', '[Demo]%')
      .delete();

    await trx('products').where({ shop_id: shopId }).andWhere('code', 'like', 'DEMO-%').delete();
    await trx('accessories').where({ shop_id: shopId }).andWhere('code', 'like', 'DEMO-%').delete();
    await trx('customers').where({ shop_id: shopId }).andWhere('name', 'like', 'Demo %').delete();
    await trx('categories').where({ shop_id: shopId }).andWhere('label', 'like', 'demo-%').delete();

    await trx('settings').where({ shop_id: shopId, key: DEMO_SETTING_KEY }).delete();
  });

  log('Cleanup complete.');
}

async function ensureCategories(shopId) {
  const existing = await knex('categories')
    .where({ shop_id: shopId })
    .whereIn('label', ['demo-sherwani', 'demo-lehenga', 'demo-suit', 'demo-gown', 'demo-turban', 'demo-footwear'])
    .select('label', 'id', 'category_type');

  const byLabel = new Map(existing.map((r) => [`${r.category_type}:${r.label}`, r]));

  const specs = [
    { label: 'demo-sherwani', category_type: 'product' },
    { label: 'demo-lehenga', category_type: 'product' },
    { label: 'demo-suit', category_type: 'product' },
    { label: 'demo-gown', category_type: 'product' },
    { label: 'demo-turban', category_type: 'accessory' },
    { label: 'demo-footwear', category_type: 'accessory' },
  ];

  const out = { product: [], accessory: [] };
  for (const spec of specs) {
    const key = `${spec.category_type}:${spec.label}`;
    let row = byLabel.get(key);
    if (!row) {
      const id = uuid();
      await knex('categories').insert({
        id,
        shop_id: shopId,
        label: spec.label,
        category_type: spec.category_type,
        sort_order: 0,
        is_active: true,
      });
      row = { id, label: spec.label, category_type: spec.category_type };
    }
    out[spec.category_type].push(row);
  }
  return out;
}

async function ensureAccounts(shopId) {
  let paymentAccount = await knex('payment_accounts')
    .where({ shop_id: shopId, name: 'Demo Cash Counter' })
    .first();
  if (!paymentAccount) {
    paymentAccount = await paymentAccountsService.create(shopId, {
      name: 'Demo Cash Counter',
      account_group: 'cash accounts',
      opening_balance: 0,
    });
  } else if (String(paymentAccount.account_group || '').trim().toLowerCase() !== 'cash accounts') {
    await knex('payment_accounts')
      .where({ shop_id: shopId, id: paymentAccount.id })
      .update({ account_group: 'cash accounts', updated_at: knex.fn.now() });
    paymentAccount = await knex('payment_accounts').where({ shop_id: shopId, id: paymentAccount.id }).first();
  }

  let securityAccount = await knex('security_accounts')
    .where({ shop_id: shopId, name: 'Demo Security Cash' })
    .first();
  if (!securityAccount) {
    securityAccount = await securityAccountsService.create(shopId, {
      name: 'Demo Security Cash',
      account_type: 'cash',
    });
  }

  return { paymentAccount, securityAccount };
}

async function seedCatalog(shopId, categories) {
  const rentProducts = [];
  for (let i = 0; i < PRODUCT_NAMES.length; i += 1) {
    const code = `DEMO-P-${String(i + 1).padStart(3, '0')}`;
    const size = ['M', 'L', 'XL', 'XXL'][i % 4];
    const storedCode = resolveDemoProductStoredCode(code, size);
    const existing = await knex('products').where({ shop_id: shopId, code: storedCode }).first();
    if (existing) {
      rentProducts.push(existing);
      continue;
    }
    const category = categories.product[i % categories.product.length];
    const row = await createProduct(shopId, {
      shop_id: shopId,
      category_id: category.id,
      name: PRODUCT_NAMES[i],
      code,
      type: 'rent',
      color: ['Gold', 'Red', 'Blue', 'Black', 'White'][i % 5],
      size,
      price_rent: 2000 + (i % 8) * 500,
      price_sell: 8000 + (i % 6) * 1000,
      qty: 5,
      is_active: true,
    });
    rentProducts.push(row);
  }

  const sellProducts = [];
  for (let i = 0; i < SELL_ONLY_NAMES.length; i += 1) {
    const code = `DEMO-S-${String(i + 1).padStart(3, '0')}`;
    const existing = await knex('products').where({ shop_id: shopId, code }).first();
    if (existing) {
      sellProducts.push(existing);
      continue;
    }
    const category = categories.product[i % categories.product.length];
    const row = await createProduct(shopId, {
      shop_id: shopId,
      category_id: category.id,
      name: SELL_ONLY_NAMES[i],
      code,
      type: 'sell',
      price_rent: 0,
      price_sell: 1200 + i * 400,
      qty: 20,
      is_active: true,
    });
    sellProducts.push(row);
  }

  const accessories = [];
  for (let i = 0; i < ACCESSORY_NAMES.length; i += 1) {
    const code = `DEMO-A-${String(i + 1).padStart(3, '0')}`;
    const existing = await knex('accessories').where({ shop_id: shopId, code }).first();
    if (existing) {
      accessories.push(existing);
      continue;
    }
    const category = categories.accessory[i % categories.accessory.length];
    const lowStock = i < 2;
    const id = uuid();
    await knex('accessories').insert({
      id,
      shop_id: shopId,
      category_id: category.id,
      code,
      name: ACCESSORY_NAMES[i],
      qty: lowStock ? 2 : 15,
      spare_qty: 0,
      threshold: lowStock ? 5 : 3,
      unit: 'pcs',
      price_rent: 200 + i * 50,
      price_sell: 800 + i * 100,
      purchase_price: 0,
      default_type: i % 3 === 0 ? 'both' : 'rent',
      default_order_status: 'regular',
      is_active: true,
    });
    const row = await knex('accessories').where({ id }).first();
    accessories.push(row);
  }

  const customers = [];
  for (let i = 0; i < CUSTOMER_FIRST_NAMES.length; i += 1) {
    const name = `Demo ${CUSTOMER_FIRST_NAMES[i]} ${['Patel', 'Shah', 'Mehta', 'Desai', 'Joshi'][i % 5]}`;
    const phone1 = `98765${String(10000 + i).slice(-5)}`;
    const existing = await knex('customers').where({ shop_id: shopId, phone1 }).first();
    if (existing) {
      customers.push(existing);
      continue;
    }
    const row = await createCustomer(shopId, {
      shop_id: shopId,
      name,
      phone1,
      whatsapp: phone1,
      address: `${10 + i}, Demo Street, Ahmedabad`,
      is_active: true,
    });
    customers.push(row);
  }

  return { products: rentProducts, sellProducts, accessories, customers };
}

async function createDemoOrder(shopId, userId, payload, stagePlan) {
  const order = await createOrder(shopId, payload, userId);
  if (stagePlan && stagePlan !== 'none') {
    await applyStagePlan(shopId, order.id, userId, stagePlan);
  }
  return getOrder(shopId, order.id);
}

async function seedOrders(shopId, userId, { products, customers, paymentAccount, securityAccount }) {
  const created = [];
  let productIdx = 0;
  const nextProduct = () => {
    const p = products[productIdx % products.length];
    productIdx += 1;
    return p;
  };
  const customerAt = (i) => customers[i % customers.length];

  const scenarios = [
    ...Array.from({ length: 3 }, (_, i) => ({
      customer: customerAt(i),
      product: nextProduct(),
      booking_date: TODAY,
      pickup_date: day(3 + i),
      return_date: day(7 + i),
      stage: 'none',
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      customer: customerAt(3 + i),
      product: nextProduct(),
      booking_date: day(-5 - i),
      pickup_date: TODAY,
      return_date: day(4 + i),
      stage: i < 2 ? 'none' : 'delivered',
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      customer: customerAt(7 + i),
      product: nextProduct(),
      booking_date: day(-10 - i),
      pickup_date: day(-6 - i),
      return_date: TODAY,
      stage: i === 0 ? 'delivered' : 'returned',
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      customer: customerAt(10 + i),
      product: nextProduct(),
      booking_date: day(-12 - i),
      pickup_date: day(-1 - (i % 7)),
      return_date: day(5 + i),
      stage: ['none', 'collected', 'prepared', 'prepared', 'none'][i],
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      customer: customerAt(15 + i),
      product: nextProduct(),
      booking_date: day(-20 - i),
      pickup_date: day(-14 - i),
      return_date: day(-1 - (i % 10)),
      stage: 'delivered',
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      customer: customerAt(i),
      product: nextProduct(),
      booking_date: day(-2 - i),
      pickup_date: day(2 + i),
      return_date: day(8 + i),
      stage: 'none',
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      customer: customerAt(4 + i),
      product: nextProduct(),
      booking_date: day(-3 - i),
      pickup_date: day(4 + i),
      return_date: day(10 + i),
      stage: 'collected',
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      customer: customerAt(8 + i),
      // Reuse products that earlier scenarios did not place into the washing queue.
      product: products[(19 + i) % products.length],
      booking_date: day(-30 * (1 + Math.floor(i / 2)) - i),
      pickup_date: day(-30 * (1 + Math.floor(i / 2)) - i + 3),
      return_date: day(-30 * (1 + Math.floor(i / 2)) - i + 7),
      stage: i % 3 === 0 ? 'returned' : i % 3 === 1 ? 'delivered' : 'none',
    })),
  ];

  for (let i = 0; i < scenarios.length; i += 1) {
    const s = scenarios[i];
    const extras = {};
    if (i % 4 === 0) {
      extras.advance_amount = 500;
      extras.advance_account_id = paymentAccount.id;
    }
    if (i % 5 === 0) {
      extras.deposit_amount = 1000;
      extras.paid_security_amt = true;
      extras.security_account_id = securityAccount.id;
    }

    const payload = buildRentOrderPayload({
      customer: s.customer,
      product: s.product,
      bookingDate: s.booking_date,
      pickupDate: s.pickup_date,
      returnDate: s.return_date,
      extras,
    });

    const order = await createDemoOrder(shopId, userId, payload, s.stage);
    created.push(order);
  }

  return created;
}

async function seedExtraPayments(shopId, userId, orders, paymentAccount, securityAccount) {
  const rentCategories = ['advance', 'partial', 'final'];
  let paymentCount = 0;

  await knex.transaction(async (trx) => {
    for (let i = 0; i < orders.length && paymentCount < 15; i += 1) {
      const order = orders[i];
      const category = rentCategories[i % rentCategories.length];
      const amount = Math.min(500 + (i % 5) * 300, Number(order.total_amount || 0));
      if (amount <= 0) continue;

      await insertOrderPayment(trx, shopId, {
        id: uuid(),
        shop_id: shopId,
        order_id: order.id,
        customer_id: order.customer_id,
        received_by: userId,
        payment_type: 'cash',
        category,
        amount,
        payment_date: day(-(i % 60)),
        payment_account_id: paymentAccount.id,
        security_account_id: null,
        transaction_id: null,
        notes: DEMO_MARKER,
      });
      await recomputeOrderPayment(trx, shopId, order.id);
      paymentCount += 1;
    }

    const depositOrders = orders.filter((o) => Number(o.deposit_amount || 0) > 0).slice(0, 3);
    for (const order of depositOrders.slice(0, 2)) {
      await insertOrderPayment(trx, shopId, {
        id: uuid(),
        shop_id: shopId,
        order_id: order.id,
        customer_id: order.customer_id,
        received_by: userId,
        payment_type: 'cash',
        category: 'deposit_refund',
        amount: Math.min(500, Number(order.deposit_amount || 0)),
        payment_date: day(-2),
        security_account_id: securityAccount.id,
        payment_account_id: null,
        transaction_id: null,
        notes: DEMO_MARKER,
      });
    }
  });
}

async function seedSales(shopId, userId, { sellProducts, accessories, paymentAccount }) {
  const sellItems = [
    ...sellProducts,
    ...accessories.filter((a) => a.default_type === 'sell' || a.default_type === 'both').slice(0, 2),
  ];
  if (!sellItems.length) return [];

  const sales = [];
  for (let i = 0; i < 8; i += 1) {
    const item = sellItems[i % sellItems.length];
    const isProduct = String(item.code || '').startsWith('DEMO-S-');
    const price = isProduct ? Number(item.price_sell || 5000) : Number(item.price_sell || 800);
    const saleDate = i < 3 ? TODAY : day(-(i * 3));

    const sale = await createSale(
      shopId,
      {
        sale_date: saleDate,
        customer_name: `Demo Sale Customer ${i + 1}`,
        contact_no: `987660${String(1000 + i).slice(-4)}`,
        remark: DEMO_MARKER,
        subtotal: price,
        discount_amount: 0,
        cgst_total: 0,
        sgst_total: 0,
        igst_total: 0,
        tax_total: 0,
        net_amount: price,
        total_amount: price,
        advance: i % 2 === 0 ? price : Math.round(price / 2),
        advance_account_id: paymentAccount.id,
        items: [
          {
            item_type: 'item',
            product_id: isProduct ? item.id : null,
            accessory_id: isProduct ? null : item.id,
            name_snapshot: item.name,
            qty: 1,
            price,
            discount: 0,
            taxable_price: price,
            cgst_percent: 0,
            cgst_amount: 0,
            sgst_percent: 0,
            sgst_amount: 0,
            igst_percent: 0,
            igst_amount: 0,
            net_price: price,
            total_amount: price,
          },
        ],
      },
      userId
    );
    sales.push(sale);
  }
  return sales;
}

async function seedCustomOrders(shopId, userId, { customers, categories }) {
  const statuses = [
    'in_progress',
    'with_tailor',
    'trial',
    'retrial',
    'completed',
    'in_progress',
    'with_tailor',
    'trial',
    'in_progress',
    'completed',
  ];
  const created = [];

  for (let i = 0; i < statuses.length; i += 1) {
    const customer = customers[i % customers.length];
    const row = await createCustomOrder(
      shopId,
      {
        status: statuses[i],
        customer_name: customer.name.replace(/^Demo /, ''),
        customer_phone: customer.phone1,
        customer_address: customer.address,
        order_date: day(-(i * 4)),
        marriage_date: day(20 + i),
        trial_date: i < 2 ? TODAY : day(5 + i),
        design_name: `Demo Design ${i + 1}`,
        category_id: categories.product[i % categories.product.length]?.id || null,
        product_name: `Custom Outfit ${i + 1}`,
        color: ['Red', 'Gold', 'Blue'][i % 3],
        size: ['M', 'L', 'XL'][i % 3],
        remarks: DEMO_MARKER,
        measurements: {},
      },
      userId
    );
    created.push(row);
  }
  return created;
}

async function seedReminders(shopId, userId) {
  const user = userId ? await knex('users').where({ id: userId }).first() : null;
  const assignee = user?.name || 'Shop Staff';
  const times = ['9:00 AM', '11:30 AM', '2:00 PM'];

  for (let i = 0; i < 3; i += 1) {
    await knex('reminders').insert({
      id: uuid(),
      shop_id: shopId,
      description: `[Demo] Follow up with customer ${i + 1} for fitting`,
      assignee,
      reminder_date: TODAY,
      reminder_time: times[i],
      is_completed: false,
    });
  }
}

async function markSeeded(shopId) {
  const existing = await knex('settings').where({ shop_id: shopId, key: DEMO_SETTING_KEY }).first();
  const value = new Date().toISOString();
  if (existing) {
    await knex('settings').where({ id: existing.id }).update({ value, updated_at: knex.fn.now() });
  } else {
    await knex('settings').insert({
      id: uuid(),
      shop_id: shopId,
      key: DEMO_SETTING_KEY,
      value,
      updated_at: knex.fn.now(),
    });
  }
}

async function main() {
  log(`Shop ID: ${SHOP_ID}`);

  const shop = await knex('shops').where({ id: SHOP_ID }).first();
  if (!shop) {
    console.error(`[seed:demo] Shop not found: ${SHOP_ID}`);
    process.exit(1);
  }

  log(`Shop: ${shop.shop_name || shop.company_name || SHOP_ID}`);

  if (await isAlreadySeeded(SHOP_ID) && !FORCE) {
    log('Demo data already seeded. Use --force to re-seed.');
    await knex.destroy();
    return;
  }

  if (FORCE) {
    await cleanDemoData(SHOP_ID);
  }

  const userId = await resolveUserId(SHOP_ID);
  if (!userId) {
    console.error('[seed:demo] No user found for this shop. Link a user via users_shops first.');
    process.exit(1);
  }

  log('Creating categories and accounts...');
  const categories = await ensureCategories(SHOP_ID);
  const { paymentAccount, securityAccount } = await ensureAccounts(SHOP_ID);

  log('Creating catalog (products, accessories, customers)...');
  const catalog = await seedCatalog(SHOP_ID, categories);
  log(
    `Catalog ready: ${catalog.products.length} rent products, ${catalog.sellProducts.length} sell products, ${catalog.accessories.length} accessories, ${catalog.customers.length} customers`
  );

  log('Creating orders...');
  const orders = await seedOrders(SHOP_ID, userId, {
    ...catalog,
    paymentAccount,
    securityAccount,
  });

  log('Creating extra payments...');
  await seedExtraPayments(SHOP_ID, userId, orders, paymentAccount, securityAccount);

  log('Creating sales...');
  await seedSales(SHOP_ID, userId, { ...catalog, paymentAccount });

  log('Creating custom orders...');
  await seedCustomOrders(SHOP_ID, userId, { ...catalog, categories });

  log('Creating reminders...');
  await seedReminders(SHOP_ID, userId);

  await markSeeded(SHOP_ID);

  log(`Done. Created ${orders.length} demo orders for ${shop.shop_name || 'shop'}.`);
  await knex.destroy();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (err) => {
    console.error('[seed:demo] Failed:', err);
    try {
      await knex.destroy();
    } catch {
      /* noop */
    }
    process.exit(1);
  });
}
