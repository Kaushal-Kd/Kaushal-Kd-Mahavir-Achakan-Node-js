import { diffSnapshots, systemLogActionLabel } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import { normalizeSnapshotForDiff } from './normalizeSnapshot.js';

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

/** MySQL JSON columns need a string; plain arrays are expanded as multiple SQL values. */
function jsonColumn(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function prepareSnapshots(module, billData, productData) {
  const mod = String(module || '').toLowerCase();
  const billNorm = normalizeSnapshotForDiff(mod, 'bill', billData ?? null);
  const productNorm = normalizeSnapshotForDiff(mod, 'product', productData ?? null);
  return { billNorm, productNorm };
}

function diffNormalized(module, prevBill, prevProduct, nextBill, nextProduct) {
  const mod = String(module || '').toLowerCase();
  const prevBillNorm = normalizeSnapshotForDiff(mod, 'bill', prevBill);
  const prevProductNorm = normalizeSnapshotForDiff(mod, 'product', prevProduct);
  const nextBillNorm = normalizeSnapshotForDiff(mod, 'bill', nextBill);
  const nextProductNorm = normalizeSnapshotForDiff(mod, 'product', nextProduct);

  const billDiff = diffSnapshots(prevBillNorm, nextBillNorm);
  const productDiff = diffSnapshots(prevProductNorm, nextProductNorm);

  return { billDiff, productDiff };
}

/**
 * @param {import('knex').Knex | import('knex').Knex.Transaction} db
 * @param {{
 *   shopId: string,
 *   module: string,
 *   entityId: string,
 *   billNo?: string | null,
 *   userId?: string | null,
 *   userName?: string | null,
 *   action: string,
 *   responsibleBy?: string | null,
 *   billData?: object | null,
 *   productData?: object | null,
 * }} opts
 */
export async function writeSystemLog(db, opts) {
  const entityId = String(opts.entityId);
  const module = opts.module;
  const [prevCountRow, prevSnapshotRow] = await Promise.all([
    db('system_logs')
      .where({
        shop_id: opts.shopId,
        module,
        entity_id: entityId,
      })
      .max('change_count as max_count')
      .first(),
    db('system_logs')
      .where({
        shop_id: opts.shopId,
        module,
        entity_id: entityId,
      })
      .orderBy('created_at', 'desc')
      .first('bill_data', 'product_data'),
  ]);

  const changeCount = Number(prevCountRow?.max_count || 0) + 1;
  const prevBill = parseJsonField(prevSnapshotRow?.bill_data);
  const prevProduct = parseJsonField(prevSnapshotRow?.product_data);

  const { billNorm, productNorm } = prepareSnapshots(module, opts.billData ?? null, opts.productData ?? null);
  const { billDiff, productDiff } = diffNormalized(
    module,
    prevBill,
    prevProduct,
    billNorm,
    productNorm
  );

  await db('system_logs').insert({
    id: uuid(),
    shop_id: opts.shopId,
    module,
    entity_id: entityId,
    bill_no: opts.billNo ? String(opts.billNo).slice(0, 80) : null,
    user_id: opts.userId || null,
    user_name: opts.userName ? String(opts.userName).slice(0, 200) : null,
    action_type: systemLogActionLabel(opts.action),
    change_count: changeCount,
    bill_change_count: billDiff.changeCount,
    product_change_count: productDiff.changeCount,
    responsible_by: opts.responsibleBy
      ? String(opts.responsibleBy).slice(0, 200)
      : opts.userName
        ? String(opts.userName).slice(0, 200)
        : null,
    bill_data: jsonColumn(billNorm),
    product_data: jsonColumn(productNorm),
    bill_changes: billDiff.changes.length ? jsonColumn(billDiff.changes) : null,
    product_changes: productDiff.changes.length ? jsonColumn(productDiff.changes) : null,
    created_at: db.fn.now(),
  });
}

export { diffNormalized, prepareSnapshots };
