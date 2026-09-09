import { badRequest } from '../../utils/errors.js';

/**
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {{ payment_account_id?: string | null; security_account_id?: string | null }} body
 */
export async function assertLedgerRefs(trx, shopId, body) {
  const pa = body.payment_account_id ? String(body.payment_account_id).trim().slice(0, 80) : null;
  const sa = body.security_account_id ? String(body.security_account_id).trim().slice(0, 80) : null;
  if (pa) {
    const row = await trx('payment_accounts').where({ shop_id: shopId, id: pa, is_active: true }).first();
    if (!row) throw badRequest('Unknown or inactive payment account');
  }
  if (sa) {
    const row = await trx('security_accounts').where({ shop_id: shopId, id: sa, is_active: true }).first();
    if (!row) throw badRequest('Unknown or inactive security account');
  }
}
