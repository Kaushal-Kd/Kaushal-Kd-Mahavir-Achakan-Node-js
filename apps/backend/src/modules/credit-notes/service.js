import { round2 } from '@wrs/shared';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { createIncomeEntry } from '../income-entries/service.js';

import { getCustomerOpenCreditBalance, getOpenCreditBalanceByPhones } from './helpers.js';

export function buildCreditNotesListQuery(shopId) {
  return knex('credit_notes as cn')
    .where({ 'cn.shop_id': shopId })
    .leftJoin('customers as c', function joinC() {
      this.on('c.id', '=', 'cn.customer_id').andOn('c.shop_id', '=', 'cn.shop_id');
    })
    .leftJoin('orders as o', function joinO() {
      this.on('o.id', '=', 'cn.source_order_id').andOn('o.shop_id', '=', 'cn.shop_id');
    })
    .select(
      'cn.id',
      'cn.shop_id',
      'cn.customer_id',
      'cn.source_order_id',
      'cn.note_number',
      'cn.bill_no',
      'cn.amount',
      'cn.amount_applied',
      'cn.amount_settled',
      'cn.remarks',
      'cn.settled_at',
      'cn.settle_remarks',
      'cn.created_at',
      'cn.updated_at',
      knex.raw('c.name as customer_name'),
      knex.raw('c.phone1 as customer_phone'),
      knex.raw('o.order_number')
    );
}

export async function listCreditNotes(shopId, query) {
  const qb = buildCreditNotesListQuery(shopId);

  if (query.entry_date) {
    qb.whereRaw('DATE(cn.created_at) = ?', [query.entry_date]);
  }
  if (query.settled === true) {
    qb.where(function settledOrFullyApplied() {
      this.whereNotNull('cn.settled_at').orWhereRaw(
        'ROUND(COALESCE(cn.amount_applied, 0), 2) >= ROUND(cn.amount, 2)'
      );
    });
  } else if (query.settled === false) {
    qb.whereNull('cn.settled_at').whereRaw(
      'ROUND(COALESCE(cn.amount_applied, 0), 2) < ROUND(cn.amount, 2)'
    );
  }

  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-cn.created_at',
    search_fields: [
      'cn.note_number',
      'cn.remarks',
      'c.name',
      'c.phone1',
      'o.order_number',
    ],
  });
}

export async function getCustomerCreditBalance(shopId, customerId) {
  const customer = await knex('customers').where({ id: customerId, shop_id: shopId }).first();
  if (!customer) throw notFound('Customer not found');
  return knex.transaction(async (trx) => getCustomerOpenCreditBalance(trx, shopId, customerId));
}

/** @param {string} shopId @param {{ phones: string[] }} query */
export async function getCreditBalanceByPhones(shopId, query) {
  const phones = query.phones || [];
  return knex.transaction(async (trx) => getOpenCreditBalanceByPhones(trx, shopId, phones));
}

export async function settleCreditNote(shopId, id, body, authUserId = null) {
  const row = await knex('credit_notes').where({ id, shop_id: shopId }).first();
  if (!row) throw notFound('Credit note not found');
  if (row.settled_at) {
    return buildCreditNotesListQuery(shopId).where('cn.id', id).first();
  }

  const remarks = body.settle_remarks != null ? String(body.settle_remarks).trim() : '';
  const settlementType = body.settlement_type || 'income'; // 'income' or 'refund'
  const applied = round2(Number(row.amount_applied || 0));
  const issued = round2(Number(row.amount));
  const remaining = round2(Math.max(0, issued - applied));

  // Update credit note as settled
  await knex('credit_notes')
    .where({ id })
    .update({
      settled_at: knex.fn.now(),
      amount_settled: remaining,
      settle_remarks: remarks === '' ? null : remarks,
      updated_at: knex.fn.now(),
    });

  // Handle settlement based on type
  if (remaining > 0) {
    try {
      if (settlementType === 'refund' && body.refund_account_id) {
        // Create refund payment entry
        const { v4: uuidv4 } = await import('uuid');
        await knex('payments').insert({
          id: uuidv4(),
          shop_id: shopId,
          payment_account_id: body.refund_account_id,
          customer_id: row.customer_id || null,
          amount: remaining,
          payment_method: 'refund',
          reference_number: `CN-REFUND-${row.note_number || id.slice(0, 8)}`,
          notes: remarks || `Refund for credit note ${row.note_number}`,
          created_by: authUserId || null,
          created_at: new Date(),
          updated_at: new Date(),
        });
      } else {
        // Create income entry for settled amount (default behavior)
        const defaultIncomeAccount = await knex('income_accounts')
          .where({ shop_id: shopId })
          .whereRaw("LOWER(name) LIKE LOWER('%credit%')")
          .first('id');

        if (defaultIncomeAccount) {
          await createIncomeEntry(shopId, authUserId, {
            income_account_id: defaultIncomeAccount.id,
            payment_account_id: body.payment_account_id || null,
            name: `Credit Note Settlement - ${row.note_number || 'CN'}`,
            entry_date: new Date().toISOString().split('T')[0],
            amount: remaining,
            details: remarks || `Settled credit note ${row.note_number}`,
          });
        }
      }
    } catch (err) {
      // Log but don't fail - settlement should succeed even if entry creation fails
      console.error('Error creating settlement entry for credit note:', err?.message);
    }
  }

  return buildCreditNotesListQuery(shopId).where('cn.id', id).first();
}

export function formatListRow(row) {
  if (!row) return row;
  const amount = round2(Number(row.amount));
  const amountApplied = round2(Number(row.amount_applied || 0));
  const amountSettled = round2(Number(row.amount_settled || 0));
  const openRemaining = round2(Math.max(0, amount - amountApplied));
  const remaining = row.settled_at ? 0 : openRemaining;
  return {
    ...row,
    amount,
    amount_applied: amountApplied,
    amount_settled: amountSettled,
    remaining,
    open_remaining: openRemaining,
  };
}
