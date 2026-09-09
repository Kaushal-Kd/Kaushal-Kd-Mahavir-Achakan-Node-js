import { buildPurchaseNumber, normalizeOrderNumberPrefix } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function parseImageUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function serializeImageUrls(urls) {
  const arr = Array.isArray(urls) ? urls.filter(Boolean) : [];
  return arr.length ? JSON.stringify(arr) : null;
}

function withParsedImageUrls(purchase) {
  if (!purchase) return purchase;
  return { ...purchase, image_urls: parseImageUrls(purchase.image_urls) };
}

function normGroup(g) {
  return String(g || '').trim().toLowerCase();
}

async function nextPurchaseBillNumber(trx, shopId) {
  const row = await trx('purchases').where({ shop_id: shopId }).max('bill_no as max_bill').first();
  return Number(row?.max_bill || 0) + 1;
}

async function assertPaymentAccountGroup(trx, shopId, accountId, allowedGroups, label) {
  const id = String(accountId || '').trim().slice(0, 80);
  if (!id) throw badRequest(`${label} is required`);
  const pa = await trx('payment_accounts').where({ shop_id: shopId, id, is_active: true }).first();
  if (!pa) throw badRequest(`Invalid ${label}`);
  const group = normGroup(pa.account_group);
  const allowed = allowedGroups.map(normGroup);
  if (!allowed.includes(group)) {
    throw badRequest(`${label} must be a ${allowedGroups.join(' or ')} account`);
  }
  return id;
}

async function restorePurchaseItemInventory(trx, shopId, items, options = {}) {
  const updateAccessoryStock = options.updateAccessoryStock !== false;
  for (const item of items || []) {
    const qty = Number(item.qty || 1);
    if (item.accessory_id) {
      if (!updateAccessoryStock) continue;
      const row = await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId, is_active: true })
        .first('id', 'qty');
      if (!row) continue;
      const nextQty = Number(row.qty || 0) - qty;
      if (nextQty < 0) throw badRequest('Cannot restore purchase: accessory stock would go negative');
      await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId })
        .update({ qty: nextQty, updated_at: trx.fn.now() });
    }
    if (item.product_id) {
      const row = await trx('products')
        .where({ id: item.product_id, shop_id: shopId, is_active: true })
        .first('id', 'qty');
      if (!row) continue;
      const nextQty = Number(row.qty || 0) - qty;
      if (nextQty < 0) throw badRequest('Cannot restore purchase: product stock would go negative');
      await trx('products')
        .where({ id: item.product_id, shop_id: shopId })
        .update({ qty: nextQty, updated_at: trx.fn.now() });
    }
  }
}

async function receivePurchaseItemInventory(trx, shopId, items, options = {}) {
  const updateAccessoryStock = options.updateAccessoryStock !== false;
  for (const item of items || []) {
    const qty = Number(item.qty || 1);
    if (item.accessory_id) {
      if (!updateAccessoryStock) continue;
      const row = await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId, is_active: true })
        .first('id');
      if (!row) throw badRequest('Accessory not found for inventory update');
      await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId })
        .increment('qty', qty);
    }
    if (item.product_id) {
      const row = await trx('products')
        .where({ id: item.product_id, shop_id: shopId, is_active: true })
        .first('id');
      if (!row) throw badRequest('Product not found for inventory update');
      await trx('products')
        .where({ id: item.product_id, shop_id: shopId })
        .increment('qty', qty);
    }
  }
}

async function loadPurchaseItemsWithCatalog(db, purchaseId) {
  return db('purchase_items as pi')
    .leftJoin('accessories as a', 'a.id', 'pi.accessory_id')
    .leftJoin('products as p', 'p.id', 'pi.product_id')
    .where('pi.purchase_id', purchaseId)
    .orderBy('pi.created_at')
    .select('pi.*', db.raw('COALESCE(a.qty, p.qty, 0) as catalog_qty'));
}

async function assertPurchaseAdvancePayment(trx, shopId, data) {
  const advanceAmt = round2(Number(data.advance || 0));
  const advAcc = data.advance_account_id ? String(data.advance_account_id).trim().slice(0, 80) : null;
  if (advanceAmt > 0 && !advAcc) {
    throw badRequest('Advance payment account is required when advance amount is greater than zero');
  }
  if (advanceAmt > 0 && advAcc) {
    await assertPaymentAccountGroup(trx, shopId, advAcc, ['Bank Accounts', 'Cash Accounts'], 'Advance account');
  }
  return { advanceAmt, advAcc };
}

async function syncPurchaseAdvancePayment(trx, shopId, purchaseId, data, userId) {
  const { advanceAmt, advAcc } = await assertPurchaseAdvancePayment(trx, shopId, data);
  await trx('payments')
    .where({ shop_id: shopId, purchase_id: purchaseId, is_deleted: false })
    .update({ is_deleted: true, deleted_at: trx.fn.now() });
  if (advanceAmt <= 0) return;
  await trx('payments').insert({
    id: uuid(),
    shop_id: shopId,
    order_id: null,
    sale_id: null,
    purchase_id: purchaseId,
    customer_id: null,
    received_by: userId || null,
    payment_type: 'cash',
    category: 'advance',
    amount: advanceAmt,
    payment_date: data.purchase_date,
    transaction_id: null,
    notes: null,
    payment_account_id: advAcc,
    security_account_id: null,
  });
}

async function voidPurchasePayments(trx, shopId, purchaseId) {
  await trx('payments')
    .where({ shop_id: shopId, purchase_id: purchaseId, is_deleted: false })
    .update({ is_deleted: true, deleted_at: trx.fn.now() });
}

function buildBaseQuery(shopId) {
  return knex('purchases as p')
    .where({ 'p.shop_id': shopId })
    .leftJoin('users as u', 'u.id', 'p.created_by')
    .leftJoin('payment_accounts as va', function joinVendor() {
      this.on('va.shop_id', '=', 'p.shop_id').andOn('va.id', '=', 'p.vendor_account_id');
    })
    .leftJoin('payment_accounts as pa', function joinPurchase() {
      this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.purchase_account_id');
    })
    .select(
      'p.*',
      knex.raw('u.name as created_by_name'),
      knex.raw('va.name as vendor_account_name'),
      knex.raw('pa.name as purchase_account_name'),
      knex.raw(
        '(SELECT COALESCE(SUM(pi.qty), 0) FROM purchase_items pi WHERE pi.purchase_id = p.id) as total_qty'
      )
    );
}

async function loadPurchasePayments(db, shopId, purchaseId) {
  const hasCol = await db.schema.hasColumn('payments', 'purchase_id');
  if (!hasCol) return [];
  return db('payments as pay')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'pay.shop_id').andOn('pa.id', '=', 'pay.payment_account_id');
    })
    .where({ 'pay.shop_id': shopId, 'pay.purchase_id': purchaseId, 'pay.is_deleted': false })
    .orderBy('pay.payment_date', 'desc')
    .select(
      'pay.id',
      'pay.amount',
      'pay.payment_date',
      'pay.created_at',
      'pay.category',
      'pay.payment_type',
      'pay.payment_account_id',
      'pay.transaction_id',
      'pay.notes',
      db.raw('COALESCE(pa.name, ?) as payment_account_name', [''])
    );
}

async function getPurchaseWithTrx(trx, shopId, id) {
  const purchase = await trx('purchases as p')
    .where({ 'p.id': id, 'p.shop_id': shopId })
    .leftJoin('users as u', 'u.id', 'p.created_by')
    .leftJoin('payment_accounts as va', function joinVendor() {
      this.on('va.shop_id', '=', 'p.shop_id').andOn('va.id', '=', 'p.vendor_account_id');
    })
    .leftJoin('payment_accounts as pa', function joinPurchase() {
      this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.purchase_account_id');
    })
    .select(
      'p.*',
      trx.raw('u.name as created_by_name'),
      trx.raw('va.name as vendor_account_name'),
      trx.raw('pa.name as purchase_account_name')
    )
    .first();
  if (!purchase) return null;
  const items = await loadPurchaseItemsWithCatalog(trx, id);
  const payments = await loadPurchasePayments(trx, shopId, id);
  return withParsedImageUrls({ ...purchase, items, payments });
}

function mapItemRows(purchaseId, shopId, items) {
  return (items || []).map((item) => ({
    id: uuid(),
    purchase_id: purchaseId,
    shop_id: shopId,
    item_type: item.item_type || 'item',
    product_id: item.product_id || null,
    accessory_id: item.accessory_id || null,
    name_snapshot: item.name_snapshot,
    qty: Number(item.qty || 1),
    price: round2(item.price),
    discount: round2(item.discount),
    taxable_price: round2(item.taxable_price),
    cgst_percent: round2(item.cgst_percent),
    cgst_amount: round2(item.cgst_amount),
    sgst_percent: round2(item.sgst_percent),
    sgst_amount: round2(item.sgst_amount),
    igst_percent: round2(item.igst_percent),
    igst_amount: round2(item.igst_amount),
    net_price: round2(item.net_price),
    total_amount: round2(item.total_amount),
  }));
}

export async function getPurchaseById(shopId, purchaseId) {
  const row = await buildBaseQuery(shopId).where('p.id', purchaseId).first();
  if (!row) return null;
  const items = await loadPurchaseItemsWithCatalog(knex, purchaseId);
  const payments = await loadPurchasePayments(knex, shopId, purchaseId);
  return { ...row, items, payments };
}

export async function listPurchases(shopId, query) {
  const qb = buildBaseQuery(shopId);

  if (query.status) qb.andWhere('p.status', query.status);
  if (query.from) qb.andWhere('p.purchase_date', '>=', query.from);
  if (query.to) qb.andWhere('p.purchase_date', '<=', query.to);
  if (query.pending_only === 'true' || query.pending_only === true) {
    qb.andWhereRaw('p.total_amount > p.advance');
  }

  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-p.purchase_date',
    search_fields: ['p.purchase_number', 'va.name'],
  });
}

export async function createPurchase(shopId, data, userId) {
  return knex.transaction(async (trx) => {
    const vendorAccountId = await assertPaymentAccountGroup(
      trx,
      shopId,
      data.vendor_account_id,
      ['Vendors'],
      'Vendor account'
    );
    const purchaseAccountId = await assertPaymentAccountGroup(
      trx,
      shopId,
      data.purchase_account_id,
      ['Purchase'],
      'Purchase account'
    );

    const billNo = await nextPurchaseBillNumber(trx, shopId);
    const shopRow = await trx('shops').where({ id: shopId }).select('order_number_prefix').first();
    const shopPrefix = normalizeOrderNumberPrefix(shopRow?.order_number_prefix);
    const prefix = shopPrefix ? `P${shopPrefix}` : 'P';
    const purchaseNumber = buildPurchaseNumber({ prefix, sequence: billNo });

    const updateAccessoryStock = data.update_accessory_stock !== false;

    const id = uuid();
    await trx('purchases').insert({
      id,
      shop_id: shopId,
      purchase_number: purchaseNumber,
      bill_no: billNo,
      purchase_date: data.purchase_date,
      vendor_account_id: vendorAccountId,
      purchase_account_id: purchaseAccountId,
      terms_days: Math.max(0, Math.floor(Number(data.terms_days) || 0)),
      update_accessory_stock: updateAccessoryStock,
      remark: data.remark || null,
      discount_type: data.discount_type || 'flat',
      discount_value: round2(data.discount_value),
      discount_amount: round2(data.discount_amount),
      subtotal: round2(data.subtotal),
      cgst_total: round2(data.cgst_total),
      sgst_total: round2(data.sgst_total),
      igst_total: round2(data.igst_total),
      tax_total: round2(data.tax_total),
      net_amount: round2(data.net_amount),
      total_amount: round2(data.total_amount),
      advance: round2(data.advance),
      advance_account_id: data.advance_account_id || null,
      image_urls: serializeImageUrls(data.image_urls),
      created_by: userId || null,
    });

    const itemRows = mapItemRows(id, shopId, data.items);
    if (itemRows.length) await trx('purchase_items').insert(itemRows);

    await receivePurchaseItemInventory(trx, shopId, data.items || [], { updateAccessoryStock });
    await syncPurchaseAdvancePayment(trx, shopId, id, data, userId);

    return getPurchaseWithTrx(trx, shopId, id);
  });
}

export async function updatePurchase(shopId, purchaseId, data, userId) {
  return knex.transaction(async (trx) => {
    const existing = await trx('purchases').where({ id: purchaseId, shop_id: shopId }).first();
    if (!existing) throw notFound('Purchase not found');
    if (existing.status === 'cancelled') throw badRequest('Cannot edit cancelled purchase');

    const vendorAccountId = await assertPaymentAccountGroup(
      trx,
      shopId,
      data.vendor_account_id,
      ['Vendors'],
      'Vendor account'
    );
    const purchaseAccountId = await assertPaymentAccountGroup(
      trx,
      shopId,
      data.purchase_account_id,
      ['Purchase'],
      'Purchase account'
    );

    const updateAccessoryStock = data.update_accessory_stock !== false;
    const oldUpdateAccessoryStock = existing.update_accessory_stock !== 0 && existing.update_accessory_stock !== false;

    const oldItems = await trx('purchase_items').where({ purchase_id: purchaseId });
    await restorePurchaseItemInventory(trx, shopId, oldItems, {
      updateAccessoryStock: oldUpdateAccessoryStock,
    });
    await trx('purchase_items').where({ purchase_id: purchaseId }).delete();

    await trx('purchases').where({ id: purchaseId }).update({
      purchase_date: data.purchase_date,
      vendor_account_id: vendorAccountId,
      purchase_account_id: purchaseAccountId,
      terms_days: Math.max(0, Math.floor(Number(data.terms_days) || 0)),
      update_accessory_stock: updateAccessoryStock,
      remark: data.remark || null,
      discount_type: data.discount_type || 'flat',
      discount_value: round2(data.discount_value),
      discount_amount: round2(data.discount_amount),
      subtotal: round2(data.subtotal),
      cgst_total: round2(data.cgst_total),
      sgst_total: round2(data.sgst_total),
      igst_total: round2(data.igst_total),
      tax_total: round2(data.tax_total),
      net_amount: round2(data.net_amount),
      total_amount: round2(data.total_amount),
      advance: round2(data.advance),
      advance_account_id: data.advance_account_id || null,
      image_urls: serializeImageUrls(data.image_urls),
      updated_at: trx.fn.now(),
    });

    const newItemRows = mapItemRows(purchaseId, shopId, data.items);
    if (newItemRows.length) await trx('purchase_items').insert(newItemRows);

    await receivePurchaseItemInventory(trx, shopId, data.items || [], { updateAccessoryStock });
    await syncPurchaseAdvancePayment(trx, shopId, purchaseId, data, userId);

    return getPurchaseWithTrx(trx, shopId, purchaseId);
  });
}

export async function cancelPurchase(shopId, purchaseId, userId) {
  return knex.transaction(async (trx) => {
    const purchase = await trx('purchases').where({ id: purchaseId, shop_id: shopId }).first();
    if (!purchase) throw notFound('Purchase not found');
    if (purchase.status === 'cancelled') throw badRequest('Purchase already cancelled');

    const items = await trx('purchase_items').where({ purchase_id: purchaseId });
    const hadAccessoryStock = purchase.update_accessory_stock !== 0 && purchase.update_accessory_stock !== false;
    await restorePurchaseItemInventory(trx, shopId, items, { updateAccessoryStock: hadAccessoryStock });
    await voidPurchasePayments(trx, shopId, purchaseId);

    await trx('purchases').where({ id: purchaseId }).update({
      status: 'cancelled',
      updated_at: trx.fn.now(),
    });

    return getPurchaseWithTrx(trx, shopId, purchaseId);
  });
}

export async function recordPurchasePayment(shopId, purchaseId, data, userId) {
  return knex.transaction(async (trx) => {
    const purchase = await trx('purchases').where({ id: purchaseId, shop_id: shopId }).first();
    if (!purchase) throw notFound('Purchase not found');
    if (purchase.status === 'cancelled') throw badRequest('Cancelled purchase cannot accept payments');

    const amount = round2(Number(data.amount || 0));
    if (amount <= 0) throw badRequest('Amount must be greater than zero');

    const payAcc = await assertPaymentAccountGroup(
      trx,
      shopId,
      data.payment_account_id,
      ['Bank Accounts', 'Cash Accounts'],
      'Payment account'
    );

    const paid = round2(Number(purchase.advance || 0));
    const bill = round2(Number(purchase.total_amount || 0));
    const pending = round2(Math.max(0, bill - paid));
    if (pending <= 0) throw badRequest('This purchase has no pending amount');
    if (amount > pending) {
      throw badRequest(`Payment amount cannot be more than pending (${pending})`);
    }

    const paymentDate = data.payment_date || purchase.purchase_date;
    const nextPaid = round2(paid + amount);
    const category = nextPaid >= bill ? 'final' : 'partial';

    await trx('payments').insert({
      id: uuid(),
      shop_id: shopId,
      order_id: null,
      sale_id: null,
      purchase_id: purchaseId,
      customer_id: null,
      received_by: userId || null,
      payment_type: 'cash',
      category,
      amount,
      payment_date: paymentDate,
      transaction_id: null,
      notes: null,
      payment_account_id: payAcc,
      security_account_id: null,
    });

    await trx('purchases').where({ id: purchaseId }).update({
      advance: nextPaid,
      advance_account_id: payAcc,
      updated_at: trx.fn.now(),
    });

    return getPurchaseWithTrx(trx, shopId, purchaseId);
  });
}

export async function deletePurchase(shopId, purchaseId) {
  return knex.transaction(async (trx) => {
    const purchase = await trx('purchases').where({ id: purchaseId, shop_id: shopId }).first();
    if (!purchase) throw notFound('Purchase not found');

    if (purchase.status !== 'cancelled') {
      const items = await trx('purchase_items').where({ purchase_id: purchaseId });
      const hadAccessoryStock = purchase.update_accessory_stock !== 0 && purchase.update_accessory_stock !== false;
      await restorePurchaseItemInventory(trx, shopId, items, { updateAccessoryStock: hadAccessoryStock });
      await voidPurchasePayments(trx, shopId, purchaseId);
    }

    await trx('purchase_items').where({ purchase_id: purchaseId }).delete();
    await trx('purchases').where({ id: purchaseId }).delete();
    return purchase;
  });
}
