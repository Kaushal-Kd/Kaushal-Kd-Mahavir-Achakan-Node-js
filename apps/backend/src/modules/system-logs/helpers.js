import { getOrder } from '../orders/service.js';
import { writeSystemLog } from './logger.js';
import {
  buildBookingBillSnapshot,
  buildBookingProductSnapshot,
  buildSaleProductSnapshot,
  isStageOnlyBookingAction,
} from './snapshots.js';
import { tagBookingProductSnapshotContext } from './normalizeSnapshot.js';

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {object} orderPayload — full order from getOrder
 * @param {string} action
 * @param {{ id?: string, name?: string } | null} authUser
 */
export async function logBookingFromOrder(db, shopId, orderPayload, action, authUser) {
  if (!orderPayload?.id) return;
  await writeSystemLog(db, {
    shopId,
    module: 'booking',
    entityId: orderPayload.id,
    billNo: orderPayload.order_number,
    userId: authUser?.id || orderPayload.sales_person_id || null,
    userName: orderPayload.sales_person_name || authUser?.name || null,
    action,
    responsibleBy: authUser?.name || null,
    billData: buildBookingBillSnapshot(orderPayload, orderPayload.customer),
    productData: tagBookingProductSnapshotContext(
      buildBookingProductSnapshot(orderPayload, { action, order: orderPayload }),
      orderPayload,
      isStageOnlyBookingAction(action)
    ),
  });
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {string} orderId
 * @param {string} action
 * @param {{ id?: string, name?: string } | null} authUser
 */
export async function logBookingById(db, shopId, orderId, action, authUser) {
  const order = await getOrder(shopId, orderId);
  await logBookingFromOrder(db, shopId, order, action, authUser);
}

/**
 * @param {import('knex').Knex} db
 * @param {string} shopId
 * @param {object} entityRow
 * @param {string} module
 * @param {string} action
 * @param {{ id?: string, name?: string } | null} authUser
 * @param {{ billNo?: string, productData?: object, userName?: string }} [extra]
 */
export async function logEntityRow(db, shopId, entityRow, module, action, authUser, extra = {}) {
  if (!entityRow?.id) return;
  let productData = extra.productData ?? null;
  if (module === 'sale' && !productData) {
    productData = buildSaleProductSnapshot(entityRow);
  }
  await writeSystemLog(db, {
    shopId,
    module,
    entityId: entityRow.id,
    billNo: extra.billNo ?? entityRow.bill_no ?? entityRow.order_number ?? entityRow.voucher_no ?? null,
    userId: authUser?.id || entityRow.created_by || entityRow.user_id || null,
    userName: extra.userName ?? authUser?.name ?? null,
    action,
    responsibleBy: authUser?.name || null,
    billData: entityRow,
    productData,
  });
}
