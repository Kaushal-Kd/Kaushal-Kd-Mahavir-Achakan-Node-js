import { collectIndianPhones, normalizePhone, round2 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import { badRequest } from '../../utils/errors.js';
import { insertOrderPayment } from '../payments/orderStatusAtPayment.js';
import { getOrdinarySecurityHeld } from '../security-charges/ledgerService.js';

/**
 * @param {import('knex').Knex|import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string[]} phones — normalized 10-digit Indian mobiles
 * @returns {Promise<string[]>}
 */
export async function resolveCustomerIdsByPhones(trx, shopId, phones) {
  const list = collectIndianPhones(...(phones || []));
  if (list.length === 0) return [];

  const rows = await trx('customers')
    .where({ shop_id: shopId, is_active: true })
    .where(function matchPhones() {
      for (let i = 0; i < list.length; i += 1) {
        const p = list[i];
        if (i === 0) {
          this.where('phone1', p).orWhere('phone2', p);
        } else {
          this.orWhere('phone1', p).orWhere('phone2', p);
        }
      }
    })
    .select('id');

  return [...new Set(rows.map((r) => r.id))];
}

function summarizeOpenCreditNotes(rows) {
  let open = 0;
  const notes = [];
  for (const r of rows) {
    const remaining = round2(Math.max(0, Number(r.amount) - Number(r.amount_applied || 0)));
    if (remaining > 0) {
      open = round2(open + remaining);
      notes.push({ ...r, remaining });
    }
  }
  notes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { open_balance: open, notes };
}

export async function sumPaymentsByCategory(trx, orderId, category) {
  const row = await trx('payments')
    .where({ order_id: orderId, is_deleted: false, category })
    .sum({ total: 'amount' })
    .first();
  return round2(Number(row?.total || 0));
}

export async function getAdvanceNetPaid(trx, orderId) {
  const advance = await sumPaymentsByCategory(trx, orderId, 'advance');
  const refunded = await sumPaymentsByCategory(trx, orderId, 'refund');
  const creditIssued = await sumPaymentsByCategory(trx, orderId, 'credit_note_issue');
  return round2(Math.max(0, advance - refunded - creditIssued));
}

export async function getSecurityHeld(trx, orderId) {
  const order = await trx('orders').where({ id: orderId }).first('shop_id');
  return order ? getOrdinarySecurityHeld(trx, order.shop_id, orderId) : 0;
}

export function buildCreditNoteNumber(billNo, sequence) {
  return `CN${billNo}-${sequence}`;
}

export async function nextCreditNoteSequence(trx, shopId, sourceOrderId) {
  const row = await trx('credit_notes')
    .where({ shop_id: shopId, source_order_id: sourceOrderId })
    .count({ n: '*' })
    .first();
  return Number(row?.n || 0) + 1;
}

export async function getCustomerOpenCreditBalance(trx, shopId, customerId) {
  const rows = await trx('credit_notes')
    .where({ shop_id: shopId, customer_id: customerId })
    .whereNull('settled_at')
    .select('id', 'customer_id', 'amount', 'amount_applied', 'note_number', 'created_at');
  return summarizeOpenCreditNotes(rows);
}

/**
 * Open credit for any customer whose phone1 or phone2 matches the given contact numbers.
 * @param {import('knex').Knex|import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string[]} phones
 */
export async function getOpenCreditBalanceByPhones(trx, shopId, phones) {
  const customerIds = await resolveCustomerIdsByPhones(trx, shopId, phones);
  if (customerIds.length === 0) {
    return { open_balance: 0, notes: [], matched_customer_ids: [], matched_customers: [] };
  }

  const customerRows = await trx('customers')
    .where({ shop_id: shopId, is_active: true })
    .whereIn('id', customerIds)
    .select('id', 'name', 'phone1', 'phone2');

  const rows = await trx('credit_notes as cn')
    .leftJoin('customers as c', function joinC() {
      this.on('c.id', '=', 'cn.customer_id').andOn('c.shop_id', '=', 'cn.shop_id');
    })
    .where({ 'cn.shop_id': shopId })
    .whereIn('cn.customer_id', customerIds)
    .whereNull('cn.settled_at')
    .select(
      'cn.id',
      'cn.customer_id',
      'cn.amount',
      'cn.amount_applied',
      'cn.note_number',
      'cn.created_at',
      'c.phone1 as customer_phone1',
      'c.phone2 as customer_phone2'
    );

  const lookup = collectIndianPhones(...(phones || []));
  const enriched = rows.map((r) => {
    const p1 = normalizePhone(r.customer_phone1);
    const p2 = normalizePhone(r.customer_phone2);
    const linked_phone = lookup.find((p) => p === p1 || p === p2) || p1 || p2 || null;
    return {
      id: r.id,
      customer_id: r.customer_id,
      amount: r.amount,
      amount_applied: r.amount_applied,
      note_number: r.note_number,
      created_at: r.created_at,
      linked_phone,
    };
  });

  const { open_balance, notes } = summarizeOpenCreditNotes(enriched);

  const balanceByCustomerId = new Map();
  for (const note of notes) {
    const cid = note.customer_id;
    balanceByCustomerId.set(cid, round2((balanceByCustomerId.get(cid) || 0) + note.remaining));
  }

  const matched_customers = customerRows.map((c) => ({
    id: c.id,
    name: c.name,
    phone1: c.phone1 || null,
    phone2: c.phone2 || null,
    open_balance: balanceByCustomerId.get(c.id) || 0,
  }));

  return { open_balance, notes, matched_customer_ids: customerIds, matched_customers };
}

/**
 * Apply customer credit to an order (FIFO open notes).
 * @param {import('knex').Knex.Transaction} trx
 */
export async function applyCreditsFromCustomer(
  trx,
  shopId,
  customerId,
  orderId,
  amount,
  userId,
  paymentDate
) {
  const applyAmt = round2(Number(amount || 0));
  if (applyAmt <= 0) return;

  const { open_balance: openBalance } = await getCustomerOpenCreditBalance(trx, shopId, customerId);
  if (applyAmt > openBalance) {
    throw badRequest(`Credit apply amount cannot exceed open balance (${openBalance})`);
  }

  let remaining = applyAmt;
  const openNotes = await trx('credit_notes')
    .where({ shop_id: shopId, customer_id: customerId })
    .whereNull('settled_at')
    .orderBy('created_at', 'asc');

  for (const note of openNotes) {
    if (remaining <= 0) break;
    const noteRemaining = round2(
      Math.max(0, Number(note.amount) - Number(note.amount_applied || 0))
    );
    if (noteRemaining <= 0) continue;

    const slice = round2(Math.min(remaining, noteRemaining));
    await trx('credit_note_applications').insert({
      id: uuid(),
      shop_id: shopId,
      credit_note_id: note.id,
      order_id: orderId,
      amount: slice,
    });
    await trx('credit_notes')
      .where({ id: note.id })
      .update({
        amount_applied: trx.raw('ROUND(COALESCE(amount_applied, 0) + ?, 2)', [slice]),
        updated_at: trx.fn.now(),
      });

    await insertOrderPayment(trx, shopId, {
      id: uuid(),
      shop_id: shopId,
      order_id: orderId,
      customer_id: customerId,
      received_by: userId || null,
      payment_type: 'cash',
      category: 'credit_note_apply',
      amount: slice,
      payment_date: paymentDate,
      transaction_id: null,
      notes: `Credit note ${note.note_number}`,
      payment_account_id: null,
      security_account_id: null,
    });

    remaining = round2(remaining - slice);
  }

  if (remaining > 0) {
    throw badRequest('Could not apply full credit amount');
  }
}

/**
 * Apply credit FIFO across open notes for all customers matching contact numbers.
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} orderCustomerId — booking customer on the new order (payment rows)
 */
export async function applyCreditsFromPhones(
  trx,
  shopId,
  phones,
  orderCustomerId,
  orderId,
  amount,
  userId,
  paymentDate
) {
  const applyAmt = round2(Number(amount || 0));
  if (applyAmt <= 0) return;

  const { open_balance: openBalance } = await getOpenCreditBalanceByPhones(trx, shopId, phones);
  if (applyAmt > openBalance) {
    throw badRequest(`Credit apply amount cannot exceed open balance (${openBalance})`);
  }

  const customerIds = await resolveCustomerIdsByPhones(trx, shopId, phones);
  if (customerIds.length === 0) {
    throw badRequest('No customer found for the given contact numbers');
  }

  let remaining = applyAmt;
  const openNotes = await trx('credit_notes')
    .where({ shop_id: shopId })
    .whereIn('customer_id', customerIds)
    .whereNull('settled_at')
    .orderBy('created_at', 'asc');

  for (const note of openNotes) {
    if (remaining <= 0) break;
    const noteRemaining = round2(
      Math.max(0, Number(note.amount) - Number(note.amount_applied || 0))
    );
    if (noteRemaining <= 0) continue;

    const slice = round2(Math.min(remaining, noteRemaining));
    await trx('credit_note_applications').insert({
      id: uuid(),
      shop_id: shopId,
      credit_note_id: note.id,
      order_id: orderId,
      amount: slice,
    });
    await trx('credit_notes')
      .where({ id: note.id })
      .update({
        amount_applied: trx.raw('ROUND(COALESCE(amount_applied, 0) + ?, 2)', [slice]),
        updated_at: trx.fn.now(),
      });

    await insertOrderPayment(trx, shopId, {
      id: uuid(),
      shop_id: shopId,
      order_id: orderId,
      customer_id: orderCustomerId,
      received_by: userId || null,
      payment_type: 'cash',
      category: 'credit_note_apply',
      amount: slice,
      payment_date: paymentDate,
      transaction_id: null,
      notes: `Credit note ${note.note_number}`,
      payment_account_id: null,
      security_account_id: null,
    });

    remaining = round2(remaining - slice);
  }

  if (remaining > 0) {
    throw badRequest('Could not apply full credit amount');
  }
}

export async function issueCreditNoteOnCancel(
  trx,
  shopId,
  order,
  amount,
  remarks,
  userId,
  paymentDate
) {
  const creditAmt = round2(Number(amount || 0));
  if (creditAmt <= 0) return null;

  const seq = await nextCreditNoteSequence(trx, shopId, order.id);
  const billNo = Number(order.bill_no ?? 0);
  const noteNumber = buildCreditNoteNumber(billNo, seq);
  const cnId = uuid();

  await insertOrderPayment(trx, shopId, {
    id: uuid(),
    shop_id: shopId,
    order_id: order.id,
    customer_id: order.customer_id,
    received_by: userId || null,
    payment_type: 'cash',
    category: 'credit_note_issue',
    amount: creditAmt,
    payment_date: paymentDate,
    transaction_id: null,
    notes: `Credit note ${noteNumber}`,
    payment_account_id: null,
    security_account_id: null,
  });

  await trx('credit_notes').insert({
    id: cnId,
    shop_id: shopId,
    customer_id: order.customer_id,
    source_order_id: order.id,
    note_number: noteNumber,
    bill_no: billNo,
    amount: creditAmt,
    amount_applied: 0,
    remarks: remarks || 'Bill cancelled',
    created_by: userId || null,
  });

  return { id: cnId, note_number: noteNumber, amount: creditAmt };
}
