import { createHash, randomUUID } from 'node:crypto';
import {
  allocateGstGross,
  calculateGstAllocation,
  gstFinancialYear,
  gstInvoiceIssueSchema,
  gstinSchema,
} from '@wrs/shared';

import knex from '../../db/knex.js';
import { requireShopAdministrator } from '../../lib/requireShopAdministrator.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}
export const gstPayloadHash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const indiaDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const sourceTable = (type) => (type === 'sale' ? 'sales' : 'orders');

function eligibleQuery(db, shopId, type) {
  const q = db(`${sourceTable(type)} as b`)
    .where('b.shop_id', shopId)
    .where('b.bill_type', 'kaccha')
    .whereNotIn('b.status', ['cancelled', 'draft'])
    .where('b.total_amount', '>', 0)
    .where('b.tax_total', 0)
    .whereNotExists(
      db('gst_invoices as gi')
        .select(db.raw('1'))
        .where('gi.shop_id', shopId)
        .where('gi.source_type', type)
        .whereRaw('gi.source_id = b.id')
    );
  if (type === 'booking') q.where('b.is_deleted', false);
  return q;
}

export async function listGstCandidates(shopId, actorId, query) {
  await requireShopAdministrator(knex, shopId, actorId);
  const type = query.source || 'booking';
  const isSale = type === 'sale';
  const q = eligibleQuery(knex, shopId, type).whereBetween(
    isSale ? 'b.sale_date' : 'b.booking_date',
    [query.from, query.to]
  );
  if (!isSale)
    q.leftJoin('customers as c', function joinCustomer() {
      this.on('c.id', '=', 'b.customer_id').andOn('c.shop_id', '=', 'b.shop_id');
    });
  const customerName = isSale
    ? 'b.customer_name'
    : knex.raw("COALESCE(NULLIF(TRIM(b.pickup_name), ''), c.name)");
  if (query.max_amount) q.where('b.total_amount', '<=', query.max_amount);
  if (query.search)
    q.where((b) =>
      b
        .where(isSale ? 'b.sale_number' : 'b.order_number', 'like', `%${query.search}%`)
        .orWhere(customerName, 'like', `%${query.search}%`)
    );
  const count = await q.clone().count({ total: '*' }).first();
  const rows = await q
    .clone()
    .select(
      'b.id',
      'b.total_amount',
      `${isSale ? 'b.sale_number' : 'b.order_number'} as source_number`,
      `${isSale ? 'b.sale_date' : 'b.booking_date'} as source_date`,
      knex.raw('? as customer_name', [isSale ? knex.ref(customerName) : customerName])
    )
    .orderBy(isSale ? 'b.sale_date' : 'b.booking_date', 'desc')
    .orderBy('b.id')
    .limit(query.per_page)
    .offset((query.page - 1) * query.per_page);
  return {
    rows: rows.map((row) => ({ ...row, source_type: type })),
    meta: {
      total: Number(count.total),
      total_pages: Math.ceil(Number(count.total) / query.per_page),
    },
  };
}

export async function loadGstSource(db, shopId, type, id, lock = false) {
  const query = db(sourceTable(type)).where({ shop_id: shopId, id });
  const row = await (lock ? query.forUpdate() : query).first();
  if (!row || row.is_deleted) throw notFound('Original bill not found');
  if (
    row.bill_type !== 'kaccha' ||
    ['cancelled', 'draft'].includes(row.status) ||
    Number(row.tax_total) !== 0 ||
    Number(row.total_amount) <= 0
  )
    throw conflict('Select an active, non-GST original bill with a positive amount');
  if (await db('gst_invoices').where({ shop_id: shopId, source_id: id, source_type: type }).first())
    throw conflict('This original bill already has a GST invoice');
  const supplierRow = await db('shops').where({ id: shopId }).first();
  const customer = row.customer_id
    ? await db('customers').where({ id: row.customer_id, shop_id: shopId }).first()
    : null;
  const supplier = {
    name: supplierRow.company_name || supplierRow.shop_name,
    address: supplierRow.address || '',
    gstin: String(supplierRow.gstin || '')
      .trim()
      .toUpperCase(),
    state: supplierRow.state || '',
    phone: supplierRow.phone || '',
  };
  const isSale = type === 'sale';
  const primary = await db(isSale ? 'sale_items' : 'order_items')
    .where(isSale ? { sale_id: id, shop_id: shopId } : { order_id: id, shop_id: shopId })
    .orderBy('id');
  const accessories = isSale
    ? []
    : await db('order_accessories').where({ order_id: id, shop_id: shopId }).orderBy('id');
  const lines = [
    ...primary.map((item) => ({ ...item, line_key: `item:${item.id}` })),
    ...accessories.map((item) => ({ ...item, line_key: `accessory:${item.id}` })),
  ].map((item) => ({
    line_key: item.line_key,
    name: item.name_snapshot,
    code: item.code_snapshot || '',
    qty: Number(item.qty),
    price: Number(item.price),
    discount: Number(item.discount),
    gross_amount: Number(isSale ? item.total_amount : item.line_total),
  }));
  if (!isSale && Number(row.extra_charges) > 0)
    lines.push({
      line_key: 'extra_charges',
      name: 'Additional charges',
      code: '',
      qty: 1,
      price: Number(row.extra_charges),
      discount: 0,
      gross_amount: Number(row.extra_charges),
    });
  if (
    !lines.length ||
    !lines.some((line) => line.gross_amount > 0) ||
    lines.some((line) => !Number.isFinite(line.gross_amount) || line.gross_amount < 0)
  )
    throw badRequest('The original bill needs valid item amounts before GST allocation');
  const amounts = allocateGstGross(
    Number(row.total_amount),
    lines.map((line) => line.gross_amount)
  );
  const source = {
    source_type: type,
    source_id: id,
    source_number: isSale ? row.sale_number : row.order_number,
    total_amount: Number(row.total_amount),
    customer_id: row.customer_id || null,
    customer_name: isSale ? row.customer_name : row.pickup_name || customer?.name || '',
    customer_address: (isSale ? row.address : row.contact_address) || customer?.address || '',
    customer_phone:
      (isSale ? row.contact_no : row.contact_phone1 || row.pickup_number) || customer?.phone1 || '',
    supplier,
    lines: lines.map((line, index) => ({ ...line, gross_amount: amounts[index] })),
  };
  return { ...source, source_fingerprint: gstPayloadHash(source) };
}

export async function getGstCandidate(shopId, actorId, type, id) {
  await requireShopAdministrator(knex, shopId, actorId);
  return loadGstSource(knex, shopId, type, id);
}

async function prepare(db, shopId, body, lock = false) {
  const results = [];
  for (const input of [...body.invoices].sort((a, b) =>
    `${a.source_type}:${a.source_id}`.localeCompare(`${b.source_type}:${b.source_id}`)
  )) {
    const source = await loadGstSource(db, shopId, input.source_type, input.source_id, lock);
    if (source.source_fingerprint !== input.source_fingerprint)
      throw conflict(
        `Bill ${source.source_number} or its invoice identity changed. Refresh and review again.`
      );
    if (source.total_amount > body.max_amount)
      throw conflict(`Bill ${source.source_number} exceeds the selected amount limit`);
    if (!gstinSchema.safeParse(source.supplier.gstin).success || !source.supplier.address.trim())
      throw badRequest('Configure the supplier GSTIN and address before issuing GST invoices');
    if (!source.customer_name.trim() || !source.customer_address.trim())
      throw badRequest('Save the customer name and address on the original bill first');
    if (input.recipient_gstin && input.recipient_gstin.slice(0, 2) !== input.place_of_supply)
      throw badRequest('Recipient GSTIN and place of supply must have the same state code');
    try {
      results.push({
        ...source,
        ...calculateGstAllocation(source, input),
        recipient_gstin: input.recipient_gstin,
        place_of_supply: input.place_of_supply,
      });
    } catch (error) {
      throw badRequest(`${source.source_number}: ${error.message}`);
    }
  }
  return results;
}

export async function previewGstInvoices(shopId, actorId, payload) {
  await requireShopAdministrator(knex, shopId, actorId);
  return { invoices: await prepare(knex, shopId, validate(gstInvoiceIssueSchema, payload)) };
}

function replayBatch(row, shopId, actorId, hash) {
  if (row.shop_id !== shopId || row.actor_id !== actorId || row.payload_hash !== hash)
    throw conflict('This request key belongs to a different GST issuance');
}

export async function issueGstInvoices(shopId, actorId, payload) {
  const body = validate(gstInvoiceIssueSchema, payload);
  await requireShopAdministrator(knex, shopId, actorId);
  const hash = gstPayloadHash(body);
  return knex.transaction(async (trx) => {
    // Lock the shop before the batch key so simultaneous first requests serialize without duplicate inserts.
    await trx('shops').where({ id: shopId }).forUpdate().first();
    const previous = await trx('gst_invoice_batches').where({ id: body.idempotency_key }).first();
    if (previous) {
      replayBatch(previous, shopId, actorId, hash);
      return {
        invoices: await trx('gst_invoices').where({ batch_id: previous.id }),
        replayed: true,
      };
    }
    const snapshots = await prepare(trx, shopId, body, true);
    const invoiceDate = indiaDate();
    const year = gstFinancialYear(invoiceDate);
    const gstin = snapshots[0].supplier.gstin;
    await trx('gst_invoice_sequences')
      .insert({ gstin, financial_year: year, last_number: 0 })
      .onConflict(['gstin', 'financial_year'])
      .ignore();
    const sequence = await trx('gst_invoice_sequences')
      .where({ gstin, financial_year: year })
      .forUpdate()
      .first();
    let number = Number(sequence.last_number);
    await trx('gst_invoice_batches').insert({
      id: body.idempotency_key,
      shop_id: shopId,
      actor_id: actorId,
      payload_hash: hash,
    });
    const invoices = [];
    for (const snapshot of snapshots) {
      let invoiceNumber;
      // Existing direct GST bills can already use this prefix; never reuse their identifiers.
      do {
        number += 1;
        if (number > 999999) throw conflict('GST invoice number series is exhausted');
        invoiceNumber = `GST/${year}/${String(number).padStart(5, '0')}`;
      } while (
        (await trx('orders as o')
          .join('shops as s', 's.id', 'o.shop_id')
          .whereRaw('UPPER(TRIM(s.gstin)) = ?', [gstin])
          .where('o.order_number', invoiceNumber)
          .first('o.id')) ||
        (await trx('sales as o')
          .join('shops as s', 's.id', 'o.shop_id')
          .whereRaw('UPPER(TRIM(s.gstin)) = ?', [gstin])
          .where('o.sale_number', invoiceNumber)
          .first('o.id'))
      );
      const id = randomUUID();
      const document = {
        ...snapshot,
        id,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        issued_by: actorId,
      };
      const invoice = {
        id,
        batch_id: body.idempotency_key,
        shop_id: shopId,
        source_type: snapshot.source_type,
        source_id: snapshot.source_id,
        source_number: snapshot.source_number,
        customer_name: snapshot.customer_name,
        supplier_gstin: gstin,
        financial_year: year,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        original_total: snapshot.total_amount,
        percentage: snapshot.percentage,
        ...Object.fromEntries(
          [
            'grand_total',
            'taxable_value',
            'tax_total',
            'cgst',
            'sgst',
            'igst',
            'non_gst_amount',
          ].map((key) => [key, snapshot[key]])
        ),
        snapshot: JSON.stringify(document),
      };
      await trx('gst_invoices').insert(invoice);
      invoices.push({ ...invoice, snapshot: document });
    }
    await trx('gst_invoice_sequences')
      .where({ gstin, financial_year: year })
      .update({ last_number: number });
    return { invoices, replayed: false };
  });
}

export async function listIssuedGstInvoices(shopId, actorId, query) {
  await requireShopAdministrator(knex, shopId, actorId);
  const q = knex('gst_invoices')
    .where({ shop_id: shopId })
    .whereBetween('invoice_date', [query.from, query.to]);
  if (query.source) q.where('source_type', query.source);
  if (query.max_amount) q.where('original_total', '<=', query.max_amount);
  if (query.search)
    q.where((b) =>
      b
        .where('invoice_number', 'like', `%${query.search}%`)
        .orWhere('source_number', 'like', `%${query.search}%`)
        .orWhere('customer_name', 'like', `%${query.search}%`)
    );
  const summary = await q
    .clone()
    .count({ total: '*' })
    .sum({ grand_total: 'grand_total', taxable_value: 'taxable_value', tax_total: 'tax_total' })
    .first();
  const rows = await q
    .clone()
    .select(
      'id',
      'invoice_number',
      'invoice_date',
      'source_type',
      'source_id',
      'source_number',
      'customer_name',
      'percentage',
      'original_total',
      'grand_total',
      'taxable_value',
      'tax_total',
      'cgst',
      'sgst',
      'igst'
    )
    .orderBy('created_at', 'desc')
    .orderBy('invoice_number', 'desc')
    .limit(query.per_page)
    .offset((query.page - 1) * query.per_page);
  return {
    rows,
    summary,
    meta: {
      total: Number(summary.total),
      total_pages: Math.ceil(Number(summary.total) / query.per_page),
    },
  };
}

export async function getIssuedGstInvoice(shopId, actorId, id) {
  await requireShopAdministrator(knex, shopId, actorId);
  const row = await knex('gst_invoices').where({ shop_id: shopId, id }).first();
  if (!row) throw notFound('GST invoice not found');
  return parse(row.snapshot);
}
