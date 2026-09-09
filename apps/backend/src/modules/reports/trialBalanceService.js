import knex from '../../db/knex.js';
import { getConditionDepositReconciliation } from '../security-charges/ledgerService.js';

function num(v) {
  return Number(v == null || v === '' ? 0 : v);
}

/**
 * Net Dr positive, net Cr negative for signed convention.
 * @param {number} signed
 */
function signedToAmountSide(signed) {
  const s = num(signed);
  if (Math.abs(s) < 1e-9) return { amount: 0, side: 'flat' };
  return {
    amount: Math.abs(s),
    side: s >= 0 ? 'Dr' : 'Cr',
  };
}

/**
 * Aggregates ledger legs (same rules as account ledger) per payment account.
 * Opening row = payment_accounts.opening_balance + movements before `from`.
 *
 * @param {string} shopId
 * @param {{ from: string; to: string }} query
 */
export async function getTrialBalanceReport(shopId, query) {
  const { from, to } = query;

  const innerUnionSql = `
    SELECT debit_account_id AS account_id, entry_date AS d, amount AS dr, 0 AS cr
      FROM journal_vouchers WHERE shop_id = ?
    UNION ALL
    SELECT credit_account_id, entry_date, 0, amount
      FROM journal_vouchers WHERE shop_id = ?
    UNION ALL
    SELECT debit_account_id, entry_date, amount, 0
      FROM receipt_vouchers WHERE shop_id = ?
    UNION ALL
    SELECT credit_account_id, entry_date, 0, amount
      FROM receipt_vouchers WHERE shop_id = ?
    UNION ALL
    SELECT debit_account_id, entry_date, amount, 0
      FROM payment_vouchers WHERE shop_id = ?
    UNION ALL
    SELECT credit_account_id, entry_date, 0, amount
      FROM payment_vouchers WHERE shop_id = ?
    UNION ALL
    SELECT payment_account_id, entry_date, amount, 0
      FROM income_entries ie WHERE shop_id = ? AND payment_account_id IS NOT NULL AND payment_account_id != ''
        AND NOT EXISTS (SELECT 1 FROM security_charge_operations co WHERE co.income_entry_id = ie.id AND co.shop_id = ie.shop_id)
    UNION ALL
    SELECT income_account_id, entry_date, 0, amount
      FROM income_entries WHERE shop_id = ?
    UNION ALL
    SELECT expense_account_id, entry_date, amount, 0
      FROM expense_entries WHERE shop_id = ?
    UNION ALL
    SELECT payment_account_id, entry_date, 0, amount
      FROM expense_entries WHERE shop_id = ? AND payment_account_id IS NOT NULL AND payment_account_id != ''
    UNION ALL
    SELECT payment_account_id, payment_date AS d, amount AS dr, 0 AS cr
      FROM payments
      WHERE shop_id = ? AND is_deleted = 0
        AND payment_account_id IS NOT NULL AND payment_account_id != ''
        AND purchase_id IS NULL
        AND category IN ('advance','partial','final','deposit')
    UNION ALL
    SELECT payment_account_id, payment_date, 0, amount
      FROM payments
      WHERE shop_id = ? AND is_deleted = 0
        AND payment_account_id IS NOT NULL AND payment_account_id != ''
        AND category IN ('refund','deposit_refund')
    UNION ALL
    SELECT payment_account_id, payment_date, 0, amount
      FROM payments
      WHERE shop_id = ? AND is_deleted = 0
        AND payment_account_id IS NOT NULL AND payment_account_id != ''
        AND purchase_id IS NOT NULL
        AND category IN ('advance','partial','final','deposit')
  `;

  const sql = `
    SELECT pa.id AS account_id,
           pa.name AS account_name,
           pa.opening_balance AS base_opening,
           COALESCE(m.before_dr, 0) AS before_dr,
           COALESCE(m.before_cr, 0) AS before_cr,
           COALESCE(m.curr_dr, 0) AS curr_dr,
           COALESCE(m.curr_cr, 0) AS curr_cr
    FROM payment_accounts pa
    LEFT JOIN (
      SELECT account_id,
        COALESCE(SUM(CASE WHEN d < ? THEN dr ELSE 0 END), 0) AS before_dr,
        COALESCE(SUM(CASE WHEN d < ? THEN cr ELSE 0 END), 0) AS before_cr,
        COALESCE(SUM(CASE WHEN d >= ? AND d <= ? THEN dr ELSE 0 END), 0) AS curr_dr,
        COALESCE(SUM(CASE WHEN d >= ? AND d <= ? THEN cr ELSE 0 END), 0) AS curr_cr
      FROM (${innerUnionSql}) movements
      GROUP BY account_id
    ) m ON m.account_id = pa.id
    WHERE pa.shop_id = ? AND pa.is_active = 1
    ORDER BY pa.name ASC
  `;

  const bindings = [from, from, from, to, from, to, ...Array(13).fill(shopId), shopId];

  const result = await knex.raw(sql, bindings);
  const rawRows = Array.isArray(result) ? result[0] || [] : result?.rows || [];

  let totalCurrDr = 0;
  let totalCurrCr = 0;
  let sumOpeningSigned = 0;
  let sumClosingSigned = 0;

  const rows = rawRows.map((r) => {
    const baseOpening = num(r.base_opening);
    const beforeDr = num(r.before_dr);
    const beforeCr = num(r.before_cr);
    const currDr = num(r.curr_dr);
    const currCr = num(r.curr_cr);

    const openingSigned = baseOpening + beforeDr - beforeCr;
    const closingSigned = openingSigned + currDr - currCr;

    totalCurrDr += currDr;
    totalCurrCr += currCr;
    sumOpeningSigned += openingSigned;
    sumClosingSigned += closingSigned;

    const openingFmt = signedToAmountSide(openingSigned);
    const closingFmt = signedToAmountSide(closingSigned);

    return {
      account_id: r.account_id,
      account_name: r.account_name || r.account_id,
      opening_balance: openingFmt.amount,
      opening_side: openingFmt.side,
      curr_dr: currDr,
      curr_cr: currCr,
      closing_balance: closingFmt.amount,
      closing_side: closingFmt.side,
    };
  });

  const openNet = signedToAmountSide(sumOpeningSigned);
  const closeNet = signedToAmountSide(sumClosingSigned);

  return {
    range: { from, to },
    condition_deposits: await getConditionDepositReconciliation(shopId, { from, to }),
    rows,
    summary: {
      total_curr_dr: totalCurrDr,
      total_curr_cr: totalCurrCr,
      opening_net_amount: openNet.amount,
      opening_net_side: openNet.side,
      closing_net_amount: closeNet.amount,
      closing_net_side: closeNet.side,
    },
  };
}
