import { assertNoIssuedGstInvoice } from '../../lib/gstInvoiceLock.js';
import { round2 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { recomputeOrderPayment } from '../payments/recomputeOrderPayment.js';

function num(value) {
  return Number(value == null || value === '' ? 0 : value);
}

function parseFlags(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function paymentStatus(paid, total) {
  if (paid <= 0) return 'pending';
  if (paid < total) return 'partial';
  if (Math.abs(paid - total) < 0.005) return 'paid';
  return 'overpaid';
}

export function calculateKacchaBillTotals(row, sourceType) {
  const taxTotal = round2(num(row?.tax_total));
  if (sourceType === 'sale') {
    const netAmount = round2(Math.max(0, num(row?.net_amount) - taxTotal));
    const discountValue = Math.max(0, num(row?.discount_value));
    const discountAmount =
      row?.discount_type === 'percent'
        ? round2(netAmount * (discountValue / 100))
        : round2(Math.min(discountValue, netAmount));
    return {
      net_amount: netAmount,
      discount_amount: discountAmount,
      total_amount: round2(Math.max(0, netAmount - discountAmount)),
    };
  }

  const currentTotal = round2(num(row?.total_amount));
  const totalWithoutExclusiveTax = round2(
    Math.max(0, num(row?.subtotal) - num(row?.discount_total) + num(row?.extra_charges))
  );
  const taxWasInclusive = Math.abs(currentTotal - totalWithoutExclusiveTax) < 0.01;
  return {
    total_amount: taxWasInclusive
      ? currentTotal
      : round2(Math.max(0, currentTotal - taxTotal)),
  };
}

export async function listGstBills(shopId, query) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.min(500, Math.max(1, Number(query.per_page) || 50));
  const source = query.source === 'sale' ? 'sale' : 'booking';
  const isSale = source === 'sale';
  const salePayments = knex('payments as p')
    .where({ 'p.shop_id': shopId, 'p.is_deleted': false })
    .whereNotNull('p.sale_id')
    .groupBy('p.sale_id')
    .select(
      'p.sale_id',
      knex.raw(
        "COALESCE(SUM(CASE WHEN p.category IN ('advance','partial','final','credit_note_apply') THEN p.amount WHEN p.category IN ('refund','credit_note_issue') THEN -p.amount ELSE 0 END), 0) as paid_amount"
      )
    );
  const base = isSale
    ? knex('sales as b')
        .leftJoin(salePayments.as('pay'), 'pay.sale_id', 'b.id')
        .where({ 'b.shop_id': shopId, 'b.bill_type': 'gst' })
    : knex('orders as b')
        .leftJoin('customers as c', function joinCustomer() {
          this.on('c.id', '=', 'b.customer_id').andOn('c.shop_id', '=', 'b.shop_id');
        })
        .where({ 'b.shop_id': shopId, 'b.bill_type': 'gst', 'b.is_deleted': false });
  const dateColumn = isSale ? 'b.sale_date' : 'b.booking_date';
  base.whereBetween(dateColumn, [query.from, query.to]);
  if (query.status) base.andWhere('b.status', query.status);
  if (query.tax_mode === 'igst') {
    if (isSale) base.andWhere('b.igst_total', '>', 0);
    else base.andWhere('b.igst_bill', true);
  } else if (query.tax_mode === 'cgst_sgst') {
    if (isSale) base.andWhere((b) => b.where('b.cgst_total', '>', 0).orWhere('b.sgst_total', '>', 0));
    else base.andWhere('b.igst_bill', false);
  }
  const search = String(query.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    base.andWhere((qb) => {
      qb.where(isSale ? 'b.sale_number' : 'b.order_number', 'like', like)
        .orWhere(isSale ? 'b.customer_name' : 'b.pickup_name', 'like', like)
        .orWhere(isSale ? 'b.address' : 'b.contact_address', 'like', like);
      if (!isSale) qb.orWhere('c.name', 'like', like).orWhere('c.address', 'like', like);
    });
  }

  const [{ total }] = await base.clone().clearSelect().clearOrder().count({ total: 'b.id' });
  const summaryRow = await base
    .clone()
    .clearSelect()
    .clearOrder()
    .select(
      knex.raw('COALESCE(SUM(GREATEST(0, b.total_amount - b.tax_total)), 0) as taxable_value'),
      isSale
        ? knex.raw('COALESCE(SUM(b.cgst_total), 0) as cgst')
        : knex.raw('COALESCE(SUM(CASE WHEN b.igst_bill = 0 THEN b.tax_total / 2 ELSE 0 END), 0) as cgst'),
      isSale
        ? knex.raw('COALESCE(SUM(b.sgst_total), 0) as sgst')
        : knex.raw('COALESCE(SUM(CASE WHEN b.igst_bill = 0 THEN b.tax_total / 2 ELSE 0 END), 0) as sgst'),
      isSale
        ? knex.raw('COALESCE(SUM(b.igst_total), 0) as igst')
        : knex.raw('COALESCE(SUM(CASE WHEN b.igst_bill = 1 THEN b.tax_total ELSE 0 END), 0) as igst'),
      knex.raw('COALESCE(SUM(b.tax_total), 0) as tax_total'),
      knex.raw('COALESCE(SUM(b.total_amount), 0) as grand_total')
    )
    .first();
  const sortColumn = query.sort_by === 'bill_no' ? 'b.bill_no' : dateColumn;
  const sortDir = query.sort_dir === 'asc' ? 'asc' : 'desc';
  const rows = await base
    .clone()
    .select(
      'b.id',
      isSale ? 'b.sale_number as bill_number' : 'b.order_number as bill_number',
      'b.bill_no',
      `${dateColumn} as bill_date`,
      isSale
        ? 'b.customer_name as party_name'
        : knex.raw("COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(b.pickup_name), ''), ?) as party_name", ['']),
      isSale
        ? 'b.address'
        : knex.raw("COALESCE(NULLIF(TRIM(c.address), ''), NULLIF(TRIM(b.contact_address), ''), ?) as address", ['']),
      'b.tax_total',
      'b.total_amount',
      'b.status',
      ...(isSale
        ? [
            'b.cgst_total',
            'b.sgst_total',
            'b.igst_total',
            'b.subtotal',
            'b.discount_amount',
            'b.advance',
            knex.raw('COALESCE(pay.paid_amount, b.advance, 0) as actual_paid_amount'),
          ]
        : ['b.subtotal', 'b.discount_total', 'b.extra_charges', 'b.igst_bill', 'b.paid_amount', 'b.payment_status'])
    )
    .orderBy(sortColumn, sortDir)
    .orderBy('b.id', 'asc')
    .offset((page - 1) * perPage)
    .limit(perPage);

  const mapped = rows.map((row) => {
    const tax = round2(num(row.tax_total));
    const igst = isSale ? round2(num(row.igst_total)) : row.igst_bill ? tax : 0;
    const cgst = isSale ? round2(num(row.cgst_total)) : row.igst_bill ? 0 : round2(tax / 2);
    const sgst = isSale ? round2(num(row.sgst_total)) : row.igst_bill ? 0 : round2(tax - cgst);
    const totalAmount = round2(num(row.total_amount));
    const paid = round2(isSale ? num(row.actual_paid_amount) : num(row.paid_amount));
    return {
      ...row,
      source,
      taxable_value: round2(totalAmount - tax),
      cgst,
      sgst,
      igst,
      tax_total: tax,
      grand_total: totalAmount,
      paid_amount: paid,
      balance: round2(totalAmount - paid),
      payment_status: isSale ? paymentStatus(paid, totalAmount) : row.payment_status,
    };
  });
  const summary = {
    taxable_value: num(summaryRow?.taxable_value),
    cgst: num(summaryRow?.cgst),
    sgst: num(summaryRow?.sgst),
    igst: num(summaryRow?.igst),
    tax_total: num(summaryRow?.tax_total),
    grand_total: num(summaryRow?.grand_total),
  };
  for (const key of Object.keys(summary)) summary[key] = round2(summary[key]);
  return {
    rows: mapped,
    summary,
    meta: { page, per_page: perPage, total: Number(total || 0), total_pages: Math.ceil(Number(total || 0) / perPage) },
  };
}

async function netPayments(trx, shopId, key, id) {
  const row = await trx('payments')
    .where({ shop_id: shopId, [key]: id, is_deleted: false })
    .select(
      trx.raw("COALESCE(SUM(CASE WHEN category IN ('advance','partial','final','credit_note_apply') THEN amount ELSE 0 END), 0) as income"),
      trx.raw("COALESCE(SUM(CASE WHEN category IN ('refund','credit_note_issue') THEN amount ELSE 0 END), 0) as expense")
    )
    .first();
  return round2(num(row?.income) - num(row?.expense));
}

export async function convertGstBill({ shopId, sourceId, sourceType, userId, body, authorize }) {
  const replay = await knex('gst_bill_conversions')
    .where({ shop_id: shopId, idempotency_key: body.idempotency_key })
    .first();
  if (replay) return { conversion: replay, replayed: true };

  return knex.transaction(async (trx) => {
    const isSale = sourceType === 'sale';
    const table = isSale ? 'sales' : 'orders';
    const itemTable = isSale ? 'sale_items' : 'order_items';
    const row = await trx(table).where({ id: sourceId, shop_id: shopId }).forUpdate().first();
    if (!row || (!isSale && row.is_deleted)) throw notFound(isSale ? 'Sale not found' : 'Booking not found');
    const lockedReplay = await trx('gst_bill_conversions')
      .where({ shop_id: shopId, idempotency_key: body.idempotency_key })
      .first();
    if (lockedReplay) return { conversion: lockedReplay, replayed: true };
    await assertNoIssuedGstInvoice(trx, shopId, sourceId, sourceType);
    if (row.bill_type !== 'gst') throw conflict('This bill is already a Kaccha Bill');
    if (row.status === 'cancelled') throw badRequest('Cancelled bills cannot be converted');
    if (!body.admin_password) throw badRequest('Master Password is required for GST conversion');
    await authorize?.(body.admin_password);

    const items = await trx(itemTable)
      .where(isSale ? { sale_id: sourceId } : { order_id: sourceId })
      .forUpdate();
    if (!isSale) {
      const accessories = await trx('order_accessories').where({ order_id: sourceId }).forUpdate();
      const delivered = [...items, ...accessories].some((item) => parseFlags(item.stage_flags).delivered);
      if (delivered || ['delivered', 'partially_returned', 'returned', 'closed'].includes(row.status)) {
        throw badRequest('GST Booking can be converted only before delivery');
      }
      await trx('credit_note_applications').where({ order_id: sourceId }).forUpdate();
    }
    await trx('payments')
      .where({ shop_id: shopId, [isSale ? 'sale_id' : 'order_id']: sourceId, is_deleted: false })
      .forUpdate();

    const kacchaTotals = calculateKacchaBillTotals(row, sourceType);
    const newTotal = kacchaTotals.total_amount;
    const paid = await netPayments(trx, shopId, isSale ? 'sale_id' : 'order_id', sourceId);
    if (paid - newTotal > 0.005) {
      throw conflict('Cannot convert because existing payments or credits exceed the Kaccha Bill total');
    }
    const before = { ...row, items };
    if (isSale) {
      await trx('sale_items').where({ sale_id: sourceId }).update({
        net_price: trx.raw('GREATEST(0, total_amount - cgst_amount - sgst_amount - igst_amount)'),
        total_amount: trx.raw('GREATEST(0, total_amount - cgst_amount - sgst_amount - igst_amount)'),
        cgst_percent: 0,
        cgst_amount: 0,
        sgst_percent: 0,
        sgst_amount: 0,
        igst_percent: 0,
        igst_amount: 0,
      });
      await trx('sales').where({ id: sourceId }).update({
        bill_type: 'kaccha',
        cgst_total: 0,
        sgst_total: 0,
        igst_total: 0,
        tax_total: 0,
        net_amount: kacchaTotals.net_amount,
        discount_amount: kacchaTotals.discount_amount,
        total_amount: newTotal,
        updated_at: trx.fn.now(),
      });
    } else {
      await trx('order_items').where({ order_id: sourceId }).update({ tax: 0 });
      await trx('order_accessories').where({ order_id: sourceId }).update({ tax: 0 });
      await trx('orders').where({ id: sourceId }).update({
        bill_type: 'kaccha',
        gst_enabled: false,
        igst_bill: false,
        tax_total: 0,
        total_amount: newTotal,
        updated_at: trx.fn.now(),
      });
      await recomputeOrderPayment(trx, shopId, sourceId);
    }
    const after = await trx(table).where({ id: sourceId }).first();
    const afterItems = await trx(itemTable).where(isSale ? { sale_id: sourceId } : { order_id: sourceId });
    const conversion = {
      id: uuid(),
      shop_id: shopId,
      source_type: sourceType,
      source_id: sourceId,
      idempotency_key: body.idempotency_key,
      from_bill_type: 'gst',
      to_bill_type: 'kaccha',
      reason: body.reason,
      before_snapshot: JSON.stringify(before),
      after_snapshot: JSON.stringify({ bill: after, items: afterItems }),
      converted_by_user_id: userId,
      converted_at: trx.fn.now(),
    };
    await trx('gst_bill_conversions').insert(conversion);
    return { conversion, bill: after, replayed: false };
  });
}
