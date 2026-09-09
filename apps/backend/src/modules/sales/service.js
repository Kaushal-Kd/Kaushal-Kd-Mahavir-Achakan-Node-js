import { assertNoIssuedGstInvoice } from '../../lib/gstInvoiceLock.js';
import {
  accessoryRentableQty,
  buildSaleNumber,
  formatAccessoryQtyExceededMessage,
  normalizeOrderNumberPrefix,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { assertSellProductLinesAvailable } from '../products/service.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function saleItemsToSellAssertLines(items) {
  return (items || [])
    .filter((it) => it.product_id)
    .map((it) => ({
      item_type: 'product',
      type: 'sell',
      product_id: it.product_id,
      qty: Number(it.qty || 1),
      name_snapshot: it.name_snapshot,
    }));
}

async function nextSaleBillNumber(trx, shopId) {
  const row = await trx('sales').where({ shop_id: shopId }).max('bill_no as max_bill').first();
  return Number(row?.max_bill || 0) + 1;
}

async function restoreSaleItemInventory(trx, shopId, items) {
  for (const item of items || []) {
    const qty = Number(item.qty || 1);
    if (item.accessory_id) {
      await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId })
        .increment('qty', qty);
    }
    if (item.product_id) {
      const row = await trx('products')
        .where({ id: item.product_id, shop_id: shopId })
        .first('id', 'qty', 'status');
      if (!row) continue;
      const nextQty = Number(row.qty || 0) + qty;
      const patch = { qty: nextQty, updated_at: trx.fn.now() };
      if (String(row.status || '').toLowerCase() === 'sold') {
        patch.status = 'available';
      }
      await trx('products').where({ id: item.product_id, shop_id: shopId }).update(patch);
    }
  }
}

async function consumeSaleItemInventory(trx, shopId, items) {
  for (const item of items || []) {
    const qty = Number(item.qty || 1);
    if (item.accessory_id) {
      const row = await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId, is_active: true })
        .first('id', 'qty', 'spare_qty', 'damaged_qty', 'name');
      if (!row) throw badRequest('Accessory not found for inventory update');
      const spareQty = Math.max(0, Number(row.spare_qty || 0));
      const damagedQty = Math.max(0, Number(row.damaged_qty || 0));
      // Damaged stock is held back the same way the spare reserve is — a sale
      // must not be able to eat into either.
      const reservedQty = spareQty + damagedQty;
      const rentable = accessoryRentableQty(row);
      const nextQty = Number(row.qty || 0) - qty;
      if (nextQty < reservedQty) {
        throw badRequest(
          formatAccessoryQtyExceededMessage(
            row.name || 'Accessory',
            qty,
            rentable,
            spareQty,
            'sell',
            damagedQty
          )
        );
      }
      if (nextQty < 0) throw badRequest('Insufficient accessory stock for sale item');
      await trx('accessories')
        .where({ id: item.accessory_id, shop_id: shopId })
        .update({ qty: nextQty, updated_at: trx.fn.now() });
    }
    if (item.product_id) {
      const row = await trx('products')
        .where({ id: item.product_id, shop_id: shopId, is_active: true })
        .first('id', 'qty', 'status');
      if (!row) throw badRequest('Product not found for inventory update');
      const status = String(row.status || 'available').toLowerCase();
      if (status === 'repair' || status === 'lost' || status === 'sold') {
        throw badRequest(`Product cannot be sold (status: ${status})`);
      }
      const nextQty = Number(row.qty || 0) - qty;
      if (nextQty < 0) throw badRequest('Insufficient product stock for sale item');
      const patch = { qty: Math.max(0, nextQty), updated_at: trx.fn.now() };
      if (nextQty <= 0) patch.status = 'sold';
      await trx('products').where({ id: item.product_id, shop_id: shopId }).update(patch);
    }
  }
}

async function loadSaleItemsWithCatalog(db, saleId) {
  return db('sale_items as si')
    .leftJoin('accessories as a', 'a.id', 'si.accessory_id')
    .leftJoin('products as p', 'p.id', 'si.product_id')
    .where('si.sale_id', saleId)
    .orderBy('si.created_at')
    .select('si.*', db.raw('COALESCE(a.qty, p.qty, 0) + si.qty as catalog_qty'));
}

async function assertSaleAdvancePayment(trx, shopId, data) {
  const advanceAmt = round2(Number(data.advance || 0));
  const advAcc = data.advance_account_id ? String(data.advance_account_id).trim().slice(0, 80) : null;
  if (advanceAmt > 0 && !advAcc) {
    throw badRequest('Advance payment account is required when advance amount is greater than zero');
  }
  if (advanceAmt > 0 && advAcc) {
    const pa = await trx('payment_accounts')
      .where({ shop_id: shopId, id: advAcc, is_active: true })
      .first();
    if (!pa) throw badRequest('Invalid advance payment account');
    const group = String(pa.account_group || '').trim().toLowerCase();
    if (group !== 'bank accounts' && group !== 'cash accounts') {
      throw badRequest('Advance payment account must be a bank or cash account');
    }
  }
  return { advanceAmt, advAcc };
}

async function syncSaleAdvancePayment(trx, shopId, saleId, data, userId) {
  const { advanceAmt, advAcc } = await assertSaleAdvancePayment(trx, shopId, data);
  await trx('payments')
    .where({ shop_id: shopId, sale_id: saleId, is_deleted: false })
    .update({ is_deleted: true, deleted_at: trx.fn.now() });
  if (advanceAmt <= 0) return;
  await trx('payments').insert({
    id: uuid(),
    shop_id: shopId,
    order_id: null,
    sale_id: saleId,
    customer_id: data.customer_id || null,
    received_by: userId || null,
    payment_type: 'cash',
    category: 'advance',
    amount: advanceAmt,
    payment_date: data.sale_date,
    transaction_id: null,
    notes: null,
    payment_account_id: advAcc,
    security_account_id: null,
  });
}

async function voidSaleAdvancePayments(trx, shopId, saleId) {
  await trx('payments')
    .where({ shop_id: shopId, sale_id: saleId, is_deleted: false })
    .update({ is_deleted: true, deleted_at: trx.fn.now() });
}

async function resolveSalesPersonId(trx, shopId, salesPersonId) {
  const candidate = salesPersonId || null;
  if (!candidate) return null;
  const row = await trx('users as u')
    .join('users_shops as us', 'us.user_id', 'u.id')
    .where({ 'us.shop_id': shopId, 'u.id': candidate, 'u.is_active': true })
    .first('u.id');
  if (!row) throw badRequest('Invalid salesman for this shop');
  return candidate;
}

function buildBaseQuery(shopId) {
  return knex('sales as s')
    .where({ 's.shop_id': shopId })
    .leftJoin('users as u', 'u.id', 's.created_by')
    .leftJoin('users as sp', 'sp.id', 's.sales_person_id')
    .select(
      's.*',
      knex.raw('u.name as created_by_name'),
      knex.raw('sp.name as sales_person_name'),
      knex.raw('(SELECT COALESCE(SUM(si.qty), 0) FROM sale_items si WHERE si.sale_id = s.id) as total_qty')
    );
}

function applySalesListSearch(qb, search) {
  const term = String(search || '').trim();
  if (!term) return qb;
  const like = `%${term}%`;
  qb.andWhere((b) => {
    b.where('s.customer_name', 'like', like)
      .orWhere('s.contact_no', 'like', like)
      .orWhere('s.sale_number', 'like', like)
      .orWhereExists(function saleItemProductMatch() {
        this.select(knex.raw('1'))
          .from('sale_items as si')
          .leftJoin('products as p', 'p.id', 'si.product_id')
          .whereRaw('si.sale_id = s.id')
          .where((sub) => {
            sub
              .where('si.name_snapshot', 'like', like)
              .orWhere('p.code', 'like', like)
              .orWhere('p.name', 'like', like);
          });
      });
  });
  return qb;
}

export async function getSaleById(shopId, saleId) {
  const sale = await buildBaseQuery(shopId).where('s.id', saleId).first();
  if (!sale) return null;
  const items = await loadSaleItemsWithCatalog(knex, saleId);
  const payments = await loadSalePayments(knex, shopId, saleId);
  return { ...sale, items, payments };
}

export async function listSales(shopId, query) {
  const qb = buildBaseQuery(shopId);

  if (query.status) qb.andWhere('s.status', query.status);
  if (query.from) qb.andWhere('s.sale_date', '>=', query.from);
  if (query.to) qb.andWhere('s.sale_date', '<=', query.to);
  if (query.pending_only === 'true' || query.pending_only === true) {
    qb.andWhereRaw('s.total_amount > s.advance');
  }

  applySalesListSearch(qb, query.search);

  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    sort: query.sort || '-s.sale_date',
  });
}

export async function createSale(shopId, data, userId) {
  return knex.transaction(async (trx) => {
    const billNo = await nextSaleBillNumber(trx, shopId);

    const shopRow = await trx('shops')
      .where({ id: shopId })
      .select('order_number_prefix', 'gstin')
      .first();
    const shopPrefix = normalizeOrderNumberPrefix(shopRow?.order_number_prefix);
    const prefix = shopPrefix ? `S${shopPrefix}` : 'S';
    const saleNumber = buildSaleNumber({ prefix, sequence: billNo });

    const id = uuid();
    const billType = data.bill_type || (Number(data.tax_total || 0) > 0 ? 'gst' : 'kaccha');
    if (billType === 'gst' && !String(shopRow?.gstin || '').trim()) {
      throw badRequest('Configure the shop GSTIN before creating a GST Sale');
    }
    const salesPersonId = await resolveSalesPersonId(
      trx,
      shopId,
      data.sales_person_id || userId || null
    );
    await trx('sales').insert({
      id,
      shop_id: shopId,
      customer_id: data.customer_id || null,
      sale_number: saleNumber,
      bill_no: billNo,
      bill_type: billType,
      sale_date: data.sale_date,
      customer_name: data.customer_name,
      contact_no: data.contact_no || null,
      address: data.address || null,
      sales_person_id: salesPersonId,
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
      created_by: userId || null,
    });

    const itemRows = (data.items || []).map((item) => ({
      id: uuid(),
      sale_id: id,
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
    if (itemRows.length) await trx('sale_items').insert(itemRows);

    await assertSellProductLinesAvailable(shopId, { items: saleItemsToSellAssertLines(data.items) });
    await consumeSaleItemInventory(trx, shopId, data.items || []);
    await syncSaleAdvancePayment(trx, shopId, id, data, userId);

    return getSaleWithTrx(trx, shopId, id);
  });
}

export async function updateSale(shopId, saleId, data, userId) {
  return knex.transaction(async (trx) => {
    const existing = await trx('sales').where({ id: saleId, shop_id: shopId }).forUpdate().first();
    if (!existing) throw notFound('Sale not found');
    await assertNoIssuedGstInvoice(trx, shopId, saleId, 'sale');
    if (existing.status === 'cancelled') throw badRequest('Cannot edit cancelled sale');
    const billType = data.bill_type || existing.bill_type || (Number(data.tax_total || 0) > 0 ? 'gst' : 'kaccha');
    if (billType === 'gst') {
      const shop = await trx('shops').where({ id: shopId }).select('gstin').first();
      if (!String(shop?.gstin || '').trim()) {
        throw badRequest('Configure the shop GSTIN before saving a GST Sale');
      }
    }

    const oldItems = await trx('sale_items').where({ sale_id: saleId });
    await restoreSaleItemInventory(trx, shopId, oldItems);
    await trx('sale_items').where({ sale_id: saleId }).delete();

    const salesPersonId = await resolveSalesPersonId(trx, shopId, data.sales_person_id ?? null);
    await trx('sales').where({ id: saleId }).update({
      bill_type: billType,
      sale_date: data.sale_date,
      customer_name: data.customer_name,
      contact_no: data.contact_no || null,
      address: data.address || null,
      sales_person_id: salesPersonId,
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
      updated_at: trx.fn.now(),
    });

    const newItemRows = (data.items || []).map((item) => ({
      id: uuid(),
      sale_id: saleId,
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
    if (newItemRows.length) await trx('sale_items').insert(newItemRows);

    await assertSellProductLinesAvailable(shopId, { items: saleItemsToSellAssertLines(data.items) });
    await consumeSaleItemInventory(trx, shopId, data.items || []);
    await syncSaleAdvancePayment(trx, shopId, saleId, data, userId);

    return getSaleWithTrx(trx, shopId, saleId);
  });
}

export async function cancelSale(shopId, saleId, userId) {
  return knex.transaction(async (trx) => {
    const sale = await trx('sales').where({ id: saleId, shop_id: shopId }).forUpdate().first();
    if (!sale) throw notFound('Sale not found');
    await assertNoIssuedGstInvoice(trx, shopId, saleId, 'sale');
    if (sale.status === 'cancelled') throw badRequest('Sale already cancelled');

    const items = await trx('sale_items').where({ sale_id: saleId });
    await restoreSaleItemInventory(trx, shopId, items);
    await voidSaleAdvancePayments(trx, shopId, saleId);

    await trx('sales').where({ id: saleId }).update({
      status: 'cancelled',
      updated_at: trx.fn.now(),
    });

    return getSaleWithTrx(trx, shopId, saleId);
  });
}

export async function recordSalePayment(shopId, saleId, data, userId) {
  return knex.transaction(async (trx) => {
    const sale = await trx('sales').where({ id: saleId, shop_id: shopId }).first();
    if (!sale) throw notFound('Sale not found');
    if (sale.status === 'cancelled') throw badRequest('Cancelled sale cannot accept payments');

    const amount = round2(Number(data.amount || 0));
    if (amount <= 0) throw badRequest('Amount must be greater than zero');

    const payAcc = String(data.payment_account_id || '').trim().slice(0, 80);
    if (!payAcc) throw badRequest('Payment account is required');
    const account = await trx('payment_accounts')
      .where({ shop_id: shopId, id: payAcc, is_active: true })
      .first();
    if (!account) throw badRequest('Invalid payment account');
    const group = String(account.account_group || '').trim().toLowerCase();
    if (group !== 'bank accounts' && group !== 'cash accounts') {
      throw badRequest('Payment account must be a bank or cash account');
    }

    const paid = round2(Number(sale.advance || 0));
    const bill = round2(Number(sale.total_amount || 0));
    const pending = round2(Math.max(0, bill - paid));
    if (pending <= 0) throw badRequest('This sale has no pending amount');
    if (amount > pending) {
      throw badRequest(`Receive amount cannot be more than pending (${pending})`);
    }
    if (round2(paid + amount) > bill) {
      throw badRequest(`Total received cannot be more than bill amount (${bill})`);
    }

    const paymentDate = data.payment_date || sale.sale_date;
    const nextPaid = round2(paid + amount);
    const category = nextPaid >= bill ? 'final' : 'partial';

    await trx('payments').insert({
      id: uuid(),
      shop_id: shopId,
      order_id: null,
      sale_id: saleId,
      customer_id: sale.customer_id || null,
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

    await trx('sales').where({ id: saleId }).update({
      advance: nextPaid,
      advance_account_id: payAcc,
      updated_at: trx.fn.now(),
    });

    return getSaleWithTrx(trx, shopId, saleId);
  });
}

export async function deleteSale(shopId, saleId) {
  return knex.transaction(async (trx) => {
    const sale = await trx('sales').where({ id: saleId, shop_id: shopId }).forUpdate().first();
    if (!sale) throw notFound('Sale not found');
    await assertNoIssuedGstInvoice(trx, shopId, saleId, 'sale');

    if (sale.status !== 'cancelled') {
      const items = await trx('sale_items').where({ sale_id: saleId });
      await restoreSaleItemInventory(trx, shopId, items);
      await voidSaleAdvancePayments(trx, shopId, saleId);
    }

    await trx('sale_items').where({ sale_id: saleId }).delete();
    await trx('sales').where({ id: saleId }).delete();
    return sale;
  });
}

let _hasSaleIdColumn = null;
async function loadSalePayments(db, shopId, saleId) {
  if (_hasSaleIdColumn === null) {
    _hasSaleIdColumn = await db.schema.hasColumn('payments', 'sale_id');
  }
  if (!_hasSaleIdColumn) return [];
  return db('payments as p')
    .leftJoin('payment_accounts as pa', function joinPa() {
      this.on('pa.shop_id', '=', 'p.shop_id').andOn('pa.id', '=', 'p.payment_account_id');
    })
    .where({ 'p.shop_id': shopId, 'p.sale_id': saleId, 'p.is_deleted': false })
    .orderBy('p.payment_date', 'desc')
    .select(
      'p.id',
      'p.amount',
      'p.payment_date',
      'p.created_at',
      'p.category',
      'p.payment_type',
      'p.payment_account_id',
      'p.transaction_id',
      'p.notes',
      db.raw('COALESCE(pa.name, ?) as payment_account_name', [''])
    );
}

async function getSaleWithTrx(trx, shopId, id) {
  const sale = await trx('sales as s')
    .where({ 's.id': id, 's.shop_id': shopId })
    .leftJoin('users as u', 'u.id', 's.created_by')
    .leftJoin('users as sp', 'sp.id', 's.sales_person_id')
    .select('s.*', trx.raw('u.name as created_by_name'), trx.raw('sp.name as sales_person_name'))
    .first();
  if (!sale) return null;
  const items = await loadSaleItemsWithCatalog(trx, id);
  const payments = await loadSalePayments(trx, shopId, id);
  return { ...sale, items, payments };
}
