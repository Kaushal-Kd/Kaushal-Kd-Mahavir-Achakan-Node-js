import {
  DOCUMENT_NUMBER_TYPE_BY_KEY,
  maxPrefixedSequence,
  nextDocumentSequence,
  resolveShopDocumentNumbering,
} from '@wrs/shared';

const SHOP_NUMBERING_COLUMNS = [
  'order_number_prefix',
  'order_number_format',
  'order_start_sequence',
  'document_numbering',
];

/**
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} shopId
 * @param {{ forUpdate?: boolean }} [opts]
 */
export async function loadShopNumbering(db, shopId, { forUpdate = false } = {}) {
  let query = db('shops').where({ id: shopId }).select(SHOP_NUMBERING_COLUMNS);
  if (forUpdate) query = query.forUpdate();
  const shop = await query.first();

  const customRow = await db('settings')
    .where({ shop_id: shopId, key: 'CUSTOM_ORDER_NUMBER_PREFIX' })
    .first('value');

  return resolveShopDocumentNumbering(shop || {}, {
    customOrderPrefix: customRow?.value,
  });
}

/**
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} table
 * @param {string} shopId
 * @param {unknown} startSequence
 * @param {string} [column]
 * @returns {Promise<number>}
 */
export async function nextTableSequence(db, table, shopId, startSequence, column = 'bill_no') {
  const row = await db(table).where({ shop_id: shopId }).max(`${column} as max_bill`).first();
  return nextDocumentSequence(Number(row?.max_bill || 0), startSequence);
}

/**
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} table
 * @param {string} shopId
 * @param {string} column
 * @param {unknown} prefix
 * @param {unknown} startSequence
 * @returns {Promise<number>}
 */
export async function nextPrefixedNumberSequence(
  db,
  table,
  shopId,
  column,
  prefix,
  startSequence
) {
  const values = await db(table).where({ shop_id: shopId }).pluck(column);
  return nextDocumentSequence(maxPrefixedSequence(values, prefix), startSequence);
}

/**
 * @param {import('knex').Knex|import('knex').Knex.Transaction} db
 * @param {string} shopId
 * @param {string} typeKey
 * @param {{ forUpdate?: boolean }} [opts]
 */
export async function loadDocumentTypeNumbering(db, shopId, typeKey, opts = {}) {
  const numbering = await loadShopNumbering(db, shopId, opts);
  if (numbering.documents[typeKey]) return numbering.documents[typeKey];
  const type = DOCUMENT_NUMBER_TYPE_BY_KEY[typeKey];
  return {
    prefix: null,
    effective_prefix: type?.defaultPrefix || 'X',
    start_sequence: 1,
  };
}
