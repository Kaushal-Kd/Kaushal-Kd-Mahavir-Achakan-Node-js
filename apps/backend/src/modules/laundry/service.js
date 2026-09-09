import { buildWashingJobNumber, toLocalISODate } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { groupUpcomingBookingsByProductId } from '../products/upcomingBookings.js';
import { paginate } from '../../utils/pagination.js';
import {
  applyVendorScopeToQuery,
  buildOutstandingFromJobRows,
  findLatestJobId,
  vendorListKey,
  vendorMatchScope,
} from './vendorOutstanding.js';

function toDateOnly(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : toLocalISODate(value);
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return '';
}

function toDateOnlyOrNull(value) {
  const d = toDateOnly(value);
  return d || null;
}

function toDateTimeOrNull(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/);
  if (!m) return null;
  return `${m[1]} ${m[2]}:00`;
}

function resolveLaundryDateFields(payload) {
  return {
    laundry_date: toDateOnly(payload.laundryDate),
    laundry_at: toDateTimeOrNull(payload.laundryDate),
  };
}

async function nextWashingJobBillNumber(trx, shopId) {
  const row = await trx('laundry_jobs')
    .where({ shop_id: shopId })
    .max('bill_seq as max_seq')
    .first();
  let maxSeq = 0;
  if (row?.max_seq != null && Number.isFinite(Number(row.max_seq))) {
    maxSeq = Number(row.max_seq);
  }

  const rows = await trx('laundry_jobs').where({ shop_id: shopId }).select('job_no');
  let maxFromJobNo = 0;
  for (const r of rows) {
    const match = /^W-(\d+)$/i.exec(String(r.job_no || '').trim());
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > maxFromJobNo) maxFromJobNo = n;
  }

  return Math.max(maxSeq, maxFromJobNo) + 1;
}

function isDuplicateJobNoError(err) {
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

export async function createLaundryJob(shopId, payload) {
  const id = uuid();
  const now = knex.fn.now();
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await knex.transaction(async (trx) => {
        const billNo = await nextWashingJobBillNumber(trx, shopId);
        const jobNo = buildWashingJobNumber({ sequence: billNo });

        const { laundry_date, laundry_at } = resolveLaundryDateFields(payload);

        await trx('laundry_jobs').insert({
          id,
          shop_id: shopId,
          job_no: jobNo,
          bill_seq: billNo,
          laundry_date,
          laundry_at,
          vendor_account_id: payload.vendorAccountId || null,
          vendor_name: payload.vendorName || null,
          pickup_by: payload.pickupBy || null,
          pickup_at: toDateTimeOrNull(payload.pickupAt),
          return_at: toDateTimeOrNull(payload.returnAt),
          remarks: payload.remarks || null,
          product_total: Number(payload.productTotal || 0),
          accessory_total: Number(payload.accessoryTotal || 0),
          subtotal: Number(payload.subtotal || 0),
          discount_mode: payload.discountMode || 'fixed',
          discount_value: Number(payload.discountValue || 0),
          discount_amount: Number(payload.discountAmount || 0),
          payable_amount: Number(payload.payable || 0),
          created_at: now,
          updated_at: now,
        });

        if (payload.productRows?.length) {
          await trx('laundry_job_products').insert(
            payload.productRows.map((row) => ({
              id: uuid(),
              laundry_job_id: id,
              shop_id: shopId,
              product_id: row.productId || null,
              category_id: row.categoryId || null,
              category_label: row.categoryLabel || null,
              product_code: row.code || null,
              product_name: row.name,
              image_url: row.image || null,
              next_pickup_date: toDateOnlyOrNull(row.nextPickupDate),
              next_booking_no:
                row.bookingNo && row.bookingNo !== '-' ? String(row.bookingNo).trim() : null,
              days_left: row.daysLeft ?? null,
              priority: row.priority || 'No Schedule',
              qty: Number(row.qty || 1),
              created_at: now,
              updated_at: now,
            }))
          );
        }

        const queueIds = (payload.queueIds || []).filter(Boolean);
        if (queueIds.length > 0) {
          await trx('washing_queue').where('shop_id', shopId).whereIn('id', queueIds).del();
        }

        if (payload.accessoryRows?.length) {
          await trx('laundry_job_accessories').insert(
            payload.accessoryRows.map((row) => {
              const qty = Number(row.qty || 1);
              const rate = Number(row.rate || 0);
              const categoryLabel = row.categoryLabel || row.name;
              return {
                id: uuid(),
                laundry_job_id: id,
                shop_id: shopId,
                category_id: row.categoryId || null,
                accessory_id: row.accessoryId || null,
                category_label: categoryLabel,
                accessory_name: row.name || categoryLabel,
                qty,
                qty_returned: 0,
                rate,
                line_total: qty * rate,
                created_at: now,
                updated_at: now,
              };
            })
          );
        }

        if (payload.categorySummaries?.length) {
          await trx('laundry_job_category_prices').insert(
            payload.categorySummaries.map((row) => {
              const washPrice = Number(row.washPrice || 0);
              const qtyTotal = Number(row.qtyTotal || 0);
              return {
                id: uuid(),
                laundry_job_id: id,
                shop_id: shopId,
                category_id: row.key === 'uncategorized' ? null : row.key,
                category_key: row.key,
                category_label: row.label,
                product_count: Number(row.productCount || 0),
                qty_total: qtyTotal,
                wash_price: washPrice,
                line_total: qtyTotal * washPrice,
                created_at: now,
                updated_at: now,
              };
            })
          );
        }
      });
      break;
    } catch (err) {
      if (isDuplicateJobNoError(err) && attempt < maxAttempts - 1) continue;
      throw err;
    }
  }

  return getLaundryJob(shopId, id);
}

export async function updateLaundryJob(shopId, id, payload) {
  const existing = await knex('laundry_jobs').where({ id, shop_id: shopId }).first('id');
  if (!existing) return null;
  const now = knex.fn.now();

  await knex.transaction(async (trx) => {
    const { laundry_date, laundry_at } = resolveLaundryDateFields(payload);

    await trx('laundry_jobs')
      .where({ id, shop_id: shopId })
      .update({
        laundry_date,
        laundry_at,
        vendor_account_id: payload.vendorAccountId || null,
        vendor_name: payload.vendorName || null,
        pickup_by: payload.pickupBy || null,
        pickup_at: toDateTimeOrNull(payload.pickupAt),
        return_at: toDateTimeOrNull(payload.returnAt),
        remarks: payload.remarks || null,
        product_total: Number(payload.productTotal || 0),
        accessory_total: Number(payload.accessoryTotal || 0),
        subtotal: Number(payload.subtotal || 0),
        discount_mode: payload.discountMode || 'fixed',
        discount_value: Number(payload.discountValue || 0),
        discount_amount: Number(payload.discountAmount || 0),
        payable_amount: Number(payload.payable || 0),
        updated_at: now,
      });

    await trx('laundry_job_products').where({ laundry_job_id: id, shop_id: shopId }).del();
    await trx('laundry_job_accessories').where({ laundry_job_id: id, shop_id: shopId }).del();
    await trx('laundry_job_category_prices').where({ laundry_job_id: id, shop_id: shopId }).del();

    if (payload.productRows?.length) {
      await trx('laundry_job_products').insert(
        payload.productRows.map((row) => ({
          id: uuid(),
          laundry_job_id: id,
          shop_id: shopId,
          product_id: row.productId || null,
          category_id: row.categoryId || null,
          category_label: row.categoryLabel || null,
          product_code: row.code || null,
          product_name: row.name,
          image_url: row.image || null,
          next_pickup_date: toDateOnlyOrNull(row.nextPickupDate),
          next_booking_no:
            row.bookingNo && row.bookingNo !== '-' ? String(row.bookingNo).trim() : null,
          days_left: row.daysLeft ?? null,
          priority: row.priority || 'No Schedule',
          qty: Number(row.qty || 1),
          created_at: now,
          updated_at: now,
        }))
      );
    }

    if (payload.accessoryRows?.length) {
      await trx('laundry_job_accessories').insert(
        payload.accessoryRows.map((row) => {
          const qty = Number(row.qty || 1);
          const rate = Number(row.rate || 0);
          const categoryLabel = row.categoryLabel || row.name;
          return {
            id: uuid(),
            laundry_job_id: id,
            shop_id: shopId,
            category_id: row.categoryId || null,
            accessory_id: row.accessoryId || null,
            category_label: categoryLabel,
            accessory_name: row.name || categoryLabel,
            qty,
            qty_returned: 0,
            rate,
            line_total: qty * rate,
            created_at: now,
            updated_at: now,
          };
        })
      );
    }

    if (payload.categorySummaries?.length) {
      await trx('laundry_job_category_prices').insert(
        payload.categorySummaries.map((row) => {
          const washPrice = Number(row.washPrice || 0);
          const qtyTotal = Number(row.qtyTotal || 0);
          return {
            id: uuid(),
            laundry_job_id: id,
            shop_id: shopId,
            category_id: row.key === 'uncategorized' ? null : row.key,
            category_key: row.key,
            category_label: row.label,
            product_count: Number(row.productCount || 0),
            qty_total: qtyTotal,
            wash_price: washPrice,
            line_total: qtyTotal * washPrice,
            created_at: now,
            updated_at: now,
          };
        })
      );
    }
  });

  return getLaundryJob(shopId, id);
}

/**
 * @param {string} shopId
 * @param {{ vendorAccountId?: string|null, vendorName?: string|null, excludeJobId?: string|null }} opts
 */
export async function getVendorWashingOutstanding(shopId, opts = {}) {
  const scope = vendorMatchScope(opts.vendorAccountId, opts.vendorName);
  if (!scope.accountId && !scope.name) {
    return {
      bills: [],
      totals: { totalPayable: 0, totalPaid: 0, totalRemaining: 0, billCount: 0 },
    };
  }

  const qb = knex('laundry_jobs as lj')
    .where({ 'lj.shop_id': shopId })
    .whereRaw('(lj.payable_amount - COALESCE(lj.paid_to_washing_amount, 0)) > ?', [1e-6])
    .select(
      'lj.id',
      'lj.job_no',
      'lj.laundry_date',
      'lj.laundry_at',
      'lj.payable_amount',
      'lj.paid_to_washing_amount',
      'lj.created_at',
      'lj.bill_seq'
    )
    .orderBy('lj.created_at', 'asc');

  applyVendorScopeToQuery(qb, scope);
  if (opts.excludeJobId) qb.andWhereNot('lj.id', opts.excludeJobId);

  const rows = await qb;
  return buildOutstandingFromJobRows(rows);
}

/**
 * @param {string} shopId
 * @param {string} jobId
 * @param {string|null|undefined} vendorAccountId
 * @param {string|null|undefined} vendorName
 */
export async function isLatestVendorBill(shopId, jobId, vendorAccountId, vendorName) {
  const scope = vendorMatchScope(vendorAccountId, vendorName);
  if (!scope.accountId && !scope.name) return false;

  const qb = knex('laundry_jobs').where({ shop_id: shopId }).select('id', 'created_at', 'bill_seq');

  applyVendorScopeToQuery(qb, scope, '');
  const rows = await qb;
  return findLatestJobId(rows) === jobId;
}

/**
 * @param {string} shopId
 * @param {Array<Record<string, unknown>>} rows
 */
async function annotateListRowsWithVendorOutstanding(shopId, rows) {
  if (!rows?.length) return rows;

  const vendorKeys = new Map();
  for (const row of rows) {
    const key = vendorListKey(row.vendor_account_id, row.vendor_name);
    if (!key) continue;
    if (!vendorKeys.has(key)) {
      vendorKeys.set(key, {
        vendorAccountId: row.vendor_account_id || null,
        vendorName: row.vendor_name || null,
      });
    }
  }

  const vendorMeta = new Map();
  await Promise.all(
    Array.from(vendorKeys.entries()).map(async ([key, { vendorAccountId, vendorName }]) => {
      const scope = vendorMatchScope(vendorAccountId, vendorName);
      const qb = knex('laundry_jobs')
        .where({ shop_id: shopId })
        .select('id', 'created_at', 'bill_seq', 'payable_amount', 'paid_to_washing_amount');
      applyVendorScopeToQuery(qb, scope, '');
      const allJobs = await qb;
      const latestId = findLatestJobId(allJobs);
      const outstanding = buildOutstandingFromJobRows(allJobs);
      vendorMeta.set(key, {
        latestId,
        totalRemaining: outstanding.totals.totalRemaining,
      });
    })
  );

  return rows.map((row) => {
    const key = vendorListKey(row.vendor_account_id, row.vendor_name);
    const meta = key ? vendorMeta.get(key) : null;
    const isLatest = Boolean(meta?.latestId && meta.latestId === row.id);
    const totalRemaining = Number(meta?.totalRemaining || 0);
    return {
      ...row,
      vendor_is_latest_bill: isLatest,
      vendor_outstanding_total: isLatest && totalRemaining > 1e-6 ? totalRemaining : null,
    };
  });
}

export async function listLaundryJobs(shopId, query = {}) {
  const qb = knex('laundry_jobs as lj')
    .where({ 'lj.shop_id': shopId })
    .leftJoin(
      knex('laundry_job_products')
        .select('laundry_job_id')
        .count({ product_lines: '*' })
        .groupBy('laundry_job_id')
        .as('lp'),
      'lp.laundry_job_id',
      'lj.id'
    )
    .leftJoin(
      knex('laundry_job_accessories')
        .select('laundry_job_id')
        .count({ accessory_lines: '*' })
        .groupBy('laundry_job_id')
        .as('la'),
      'la.laundry_job_id',
      'lj.id'
    )
    .select(
      'lj.id',
      'lj.job_no',
      'lj.laundry_date',
      'lj.laundry_at',
      'lj.vendor_account_id',
      'lj.vendor_name',
      'lj.pickup_by',
      'lj.pickup_at',
      'lj.return_at',
      'lj.remarks',
      'lj.status',
      'lj.product_total',
      'lj.accessory_total',
      'lj.subtotal',
      'lj.discount_mode',
      'lj.discount_value',
      'lj.discount_amount',
      'lj.payable_amount',
      knex.raw('COALESCE(lj.paid_to_washing_amount, 0) as paid_to_washing_amount'),
      knex.raw('(lj.payable_amount - COALESCE(lj.paid_to_washing_amount, 0)) as washing_balance'),
      'lj.created_at',
      knex.raw('COALESCE(lp.product_lines, 0) as product_lines'),
      knex.raw('COALESCE(la.accessory_lines, 0) as accessory_lines')
    );

  if (query.laundry_date_from)
    qb.andWhere('lj.laundry_date', '>=', String(query.laundry_date_from).slice(0, 10));
  if (query.laundry_date_to)
    qb.andWhere('lj.laundry_date', '<=', String(query.laundry_date_to).slice(0, 10));
  const unpaid =
    query.unpaid_washing === '1' || query.unpaid_washing === 1 || query.unpaid_washing === true;
  if (unpaid) {
    qb.andWhereRaw('(lj.payable_amount - COALESCE(lj.paid_to_washing_amount, 0)) > ?', [1e-6]);
  }

  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page || 50,
    search: query.search,
    sort: query.sort || '-lj.created_at',
    search_fields: ['lj.job_no', 'lj.vendor_name', 'lj.pickup_by', 'lj.remarks'],
  });

  result.data = await annotateListRowsWithVendorOutstanding(shopId, result.data);
  return result;
}

export async function deleteLaundryJob(shopId, id) {
  const existing = await knex('laundry_jobs').where({ id, shop_id: shopId }).first('id');
  if (!existing) return false;
  await knex('laundry_jobs').where({ id, shop_id: shopId }).del();
  return true;
}

async function countPendingLaundryLines(trx, shopId, jobId) {
  const [products, accessories] = await Promise.all([
    trx('laundry_job_products')
      .where({ laundry_job_id: jobId, shop_id: shopId, status: 'in_washing' })
      .count({ cnt: '*' })
      .first(),
    trx('laundry_job_accessories')
      .where({ laundry_job_id: jobId, shop_id: shopId })
      .where(function pendingAccessory() {
        this.where('status', 'in_washing').orWhereRaw('COALESCE(qty_returned, 0) < qty');
      })
      .count({ cnt: '*' })
      .first(),
  ]);
  return Number(products?.cnt || 0) + Number(accessories?.cnt || 0);
}

async function autoCompleteJob(trx, shopId, jobId) {
  const pending = await countPendingLaundryLines(trx, shopId, jobId);
  if (pending === 0) {
    await trx('laundry_jobs')
      .where({ id: jobId, shop_id: shopId })
      .update({ status: 'completed', updated_at: trx.fn.now() });
  }
}

/**
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string} jobId
 * @param {string} batchId
 * @param {Array<{ itemType: string, lineId: string, itemCode?: string|null, itemName: string, categoryLabel?: string|null, qty: number }>} entries
 */
async function insertReturnLogBatch(trx, shopId, jobId, batchId, entries) {
  if (!entries.length) return;
  const returnedAt = trx.fn.now();
  await trx('laundry_job_return_logs').insert(
    entries.map((entry) => ({
      id: uuid(),
      shop_id: shopId,
      laundry_job_id: jobId,
      batch_id: batchId,
      returned_at: returnedAt,
      item_type: entry.itemType,
      line_id: entry.lineId,
      item_code: entry.itemCode ? String(entry.itemCode).slice(0, 80) : null,
      item_name: String(entry.itemName || '-').slice(0, 200),
      category_label: entry.categoryLabel ? String(entry.categoryLabel).slice(0, 120) : null,
      qty: Math.max(1, Math.floor(Number(entry.qty) || 1)),
      created_at: trx.fn.now(),
    }))
  );
}

/**
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string} jobId
 * @param {string} lineId
 */
async function returnProductLine(trx, shopId, jobId, lineId) {
  const row = await trx('laundry_job_products')
    .where({ id: lineId, laundry_job_id: jobId, shop_id: shopId })
    .first();
  if (!row) return { notFound: true };
  if (row.status !== 'in_washing') return { already: row.status };
  await trx('laundry_job_products')
    .where({ id: lineId })
    .update({ status: 'returned', updated_at: trx.fn.now() });
  return {
    ok: true,
    logEntry: {
      itemType: 'product',
      lineId: row.id,
      itemCode: row.product_code,
      itemName: row.product_name,
      categoryLabel: row.category_label,
      qty: Math.max(1, Math.floor(Number(row.qty) || 1)),
    },
  };
}

/**
 * @param {import('knex').Knex.Transaction} trx
 * @param {string} shopId
 * @param {string} jobId
 * @param {string} lineId
 * @param {{ returnQty?: number }} payload
 */
async function returnAccessoryLine(trx, shopId, jobId, lineId, payload = {}) {
  const row = await trx('laundry_job_accessories')
    .where({ id: lineId, laundry_job_id: jobId, shop_id: shopId })
    .first();
  if (!row) return { notFound: true };
  if (row.status === 'cancelled') return { already: row.status };

  const sent = Number(row.qty || 0);
  let returned = Number(row.qty_returned || 0);
  const pending = Math.max(0, sent - returned);
  if (pending <= 0) return { already: 'returned' };

  const addQty = payload.returnQty != null ? Number(payload.returnQty) : pending;
  if (!Number.isFinite(addQty) || addQty <= 0) {
    return { error: 'Invalid return quantity' };
  }

  const appliedQty = Math.min(pending, Math.floor(addQty));
  returned = Math.min(sent, returned + appliedQty);
  const status = returned >= sent ? 'returned' : 'in_washing';
  await trx('laundry_job_accessories')
    .where({ id: lineId })
    .update({ qty_returned: returned, status, updated_at: trx.fn.now() });

  return {
    ok: true,
    qtyReturned: returned,
    qty: sent,
    status,
    logEntry: {
      itemType: 'accessory',
      lineId: row.id,
      itemCode: null,
      itemName: row.accessory_name,
      categoryLabel: row.category_label || row.accessory_name,
      qty: appliedQty,
    },
  };
}

export async function markProductReturned(shopId, jobId, lineId) {
  return knex.transaction(async (trx) => {
    const result = await returnProductLine(trx, shopId, jobId, lineId);
    if (result.notFound) return null;
    if (result.already) return { already: result.already };
    await insertReturnLogBatch(trx, shopId, jobId, uuid(), [result.logEntry]);
    await autoCompleteJob(trx, shopId, jobId);
    return { ok: true };
  });
}

export async function markProductCancelled(shopId, jobId, lineId) {
  return knex.transaction(async (trx) => {
    const row = await trx('laundry_job_products')
      .where({ id: lineId, laundry_job_id: jobId, shop_id: shopId })
      .first();
    if (!row) return null;
    if (row.status !== 'in_washing') return { already: row.status };
    await trx('laundry_job_products')
      .where({ id: lineId })
      .update({ status: 'cancelled', updated_at: trx.fn.now() });
    await autoCompleteJob(trx, shopId, jobId);
    return { ok: true };
  });
}

export async function markAccessoryReturned(shopId, jobId, lineId, payload = {}) {
  return knex.transaction(async (trx) => {
    const result = await returnAccessoryLine(trx, shopId, jobId, lineId, payload);
    if (result.notFound) return null;
    if (result.already) return { already: result.already };
    if (result.error) return { error: result.error };
    await insertReturnLogBatch(trx, shopId, jobId, uuid(), [result.logEntry]);
    await autoCompleteJob(trx, shopId, jobId);
    return {
      ok: true,
      qtyReturned: result.qtyReturned,
      qty: result.qty,
      status: result.status,
    };
  });
}

export async function returnSelectedItems(shopId, jobId, payload = {}) {
  const productLineIds = [...new Set((payload.productLineIds || []).map(String))];
  const accessories = payload.accessories || [];

  if (productLineIds.length === 0 && accessories.length === 0) {
    return { error: 'No items selected' };
  }

  return knex.transaction(async (trx) => {
    const job = await trx('laundry_jobs').where({ id: jobId, shop_id: shopId }).first('id');
    if (!job) return null;

    const batchId = uuid();
    const logEntries = [];

    for (const lineId of productLineIds) {
      const result = await returnProductLine(trx, shopId, jobId, lineId);
      if (result.notFound) return { error: 'Product line not found' };
      if (result.already) return { already: result.already, lineId };
      logEntries.push(result.logEntry);
    }

    for (const item of accessories) {
      const result = await returnAccessoryLine(trx, shopId, jobId, item.lineId, {
        returnQty: item.returnQty,
      });
      if (result.notFound) return { error: 'Accessory line not found' };
      if (result.already) return { already: result.already, lineId: item.lineId };
      if (result.error) return { error: result.error };
      logEntries.push(result.logEntry);
    }

    await insertReturnLogBatch(trx, shopId, jobId, batchId, logEntries);
    await autoCompleteJob(trx, shopId, jobId);

    const pieceCount = logEntries.reduce((sum, entry) => sum + entry.qty, 0);
    return { ok: true, batchId, pieceCount, lineCount: logEntries.length };
  });
}

export async function markAllReturned(shopId, jobId) {
  return knex.transaction(async (trx) => {
    const job = await trx('laundry_jobs').where({ id: jobId, shop_id: shopId }).first('id');
    if (!job) return null;

    const [productRows, accessoryRows] = await Promise.all([
      trx('laundry_job_products')
        .where({ laundry_job_id: jobId, shop_id: shopId, status: 'in_washing' })
        .select('id', 'product_code', 'product_name', 'category_label', 'qty'),
      trx('laundry_job_accessories')
        .where({ laundry_job_id: jobId, shop_id: shopId })
        .where(function pendingAccessory() {
          this.where('status', 'in_washing').orWhereRaw('COALESCE(qty_returned, 0) < qty');
        })
        .select('id', 'accessory_name', 'category_label', 'qty', 'qty_returned'),
    ]);

    const batchId = uuid();
    const logEntries = [];

    if (productRows.length) {
      await trx('laundry_job_products')
        .where({ laundry_job_id: jobId, shop_id: shopId, status: 'in_washing' })
        .update({ status: 'returned', updated_at: trx.fn.now() });
      productRows.forEach((row) => {
        logEntries.push({
          itemType: 'product',
          lineId: row.id,
          itemCode: row.product_code,
          itemName: row.product_name,
          categoryLabel: row.category_label,
          qty: Math.max(1, Math.floor(Number(row.qty) || 1)),
        });
      });
    }

    if (accessoryRows.length) {
      await trx('laundry_job_accessories')
        .where({ laundry_job_id: jobId, shop_id: shopId })
        .where(function pendingAccessory() {
          this.where('status', 'in_washing').orWhereRaw('COALESCE(qty_returned, 0) < qty');
        })
        .update({
          qty_returned: knex.ref('qty'),
          status: 'returned',
          updated_at: trx.fn.now(),
        });
      accessoryRows.forEach((row) => {
        const sent = Number(row.qty || 0);
        const alreadyReturned = Number(row.qty_returned || 0);
        const addQty = Math.max(0, sent - alreadyReturned);
        if (addQty <= 0) return;
        logEntries.push({
          itemType: 'accessory',
          lineId: row.id,
          itemCode: null,
          itemName: row.accessory_name,
          categoryLabel: row.category_label || row.accessory_name,
          qty: addQty,
        });
      });
    }

    await insertReturnLogBatch(trx, shopId, jobId, batchId, logEntries);

    await trx('laundry_jobs')
      .where({ id: jobId, shop_id: shopId })
      .update({ status: 'completed', updated_at: trx.fn.now() });
    return { ok: true };
  });
}

export async function getLaundryReturnLogs(shopId, jobId) {
  const job = await knex('laundry_jobs').where({ id: jobId, shop_id: shopId }).first('id');
  if (!job) return null;

  const rows = await knex('laundry_job_return_logs')
    .where({ laundry_job_id: jobId, shop_id: shopId })
    .orderBy('returned_at', 'desc')
    .orderBy('created_at', 'desc');

  const batchMap = new Map();
  for (const row of rows) {
    const batchId = row.batch_id;
    if (!batchMap.has(batchId)) {
      batchMap.set(batchId, {
        batchId,
        returnedAt: row.returned_at,
        pieceCount: 0,
        lines: [],
      });
    }
    const batch = batchMap.get(batchId);
    const qty = Number(row.qty || 0);
    batch.pieceCount += qty;
    batch.lines.push({
      itemType: row.item_type,
      lineId: row.line_id,
      itemCode: row.item_code,
      itemName: row.item_name,
      categoryLabel: row.category_label,
      qty,
    });
  }

  return Array.from(batchMap.values());
}

export async function getLaundryJob(shopId, id) {
  const job = await knex('laundry_jobs').where({ id, shop_id: shopId }).first();
  if (!job) return null;

  const [productRows, accessoryRows, categorySummaries] = await Promise.all([
    knex('laundry_job_products')
      .where({ laundry_job_id: id, shop_id: shopId })
      .orderBy('created_at', 'asc'),
    knex('laundry_job_accessories')
      .where({ laundry_job_id: id, shop_id: shopId })
      .orderBy('created_at', 'asc'),
    knex('laundry_job_category_prices')
      .where({ laundry_job_id: id, shop_id: shopId })
      .orderBy('category_label', 'asc'),
  ]);

  const productIds = productRows.map((row) => row.product_id).filter(Boolean);
  const upcomingByProductId = await groupUpcomingBookingsByProductId(shopId, productIds);

  const latestForVendor = await isLatestVendorBill(
    shopId,
    job.id,
    job.vendor_account_id,
    job.vendor_name
  );
  let vendorOutstanding;
  if (latestForVendor) {
    const outstanding = await getVendorWashingOutstanding(shopId, {
      vendorAccountId: job.vendor_account_id,
      vendorName: job.vendor_name,
    });
    if (outstanding.totals.billCount > 0) {
      vendorOutstanding = {
        isLatestBill: true,
        bills: outstanding.bills,
        totals: outstanding.totals,
      };
    }
  }

  return {
    id: job.id,
    jobNo: job.job_no,
    laundryDate: job.laundry_at || toDateOnly(job.laundry_date),
    laundryAt: job.laundry_at || null,
    vendorName: job.vendor_name,
    vendorAccountId: job.vendor_account_id || null,
    pickupBy: job.pickup_by,
    pickupAt: job.pickup_at || null,
    returnAt: job.return_at || null,
    remarks: job.remarks,
    status: job.status || 'open',
    productRows: productRows.map((row) => ({
      rowId: row.id,
      productId: row.product_id,
      categoryId: row.category_id,
      categoryLabel: row.category_label,
      code: row.product_code,
      name: row.product_name,
      image: row.image_url,
      bookingNo: row.next_booking_no || null,
      nextPickupDate: toDateOnlyOrNull(
        upcomingByProductId.get(row.product_id)?.[0]?.pickup_date || row.next_pickup_date
      ),
      upcomingBookings: upcomingByProductId.get(row.product_id) || [],
      daysLeft: row.days_left,
      priority: row.priority,
      qty: Number(row.qty || 0),
      status: row.status || 'in_washing',
    })),
    accessoryRows: accessoryRows.map((row) => {
      const qty = Number(row.qty || 0);
      const qtyReturned = Number(row.qty_returned || 0);
      return {
        rowId: row.id,
        accessoryId: row.accessory_id,
        categoryId: row.category_id,
        categoryLabel: row.category_label || row.accessory_name,
        name: row.accessory_name,
        qty,
        qtyReturned,
        rate: Number(row.rate || 0),
        lineTotal: Number(row.line_total || 0),
        status: row.status || 'in_washing',
      };
    }),
    categorySummaries: categorySummaries.map((row) => ({
      key: row.category_key,
      label: row.category_label,
      productCount: Number(row.product_count || 0),
      qtyTotal: Number(row.qty_total || 0),
      washPrice: Number(row.wash_price || 0),
      lineTotal: Number(row.line_total || 0),
    })),
    productTotal: Number(job.product_total || 0),
    accessoryTotal: Number(job.accessory_total || 0),
    subtotal: Number(job.subtotal || 0),
    discountMode: job.discount_mode,
    discountValue: Number(job.discount_value || 0),
    discountAmount: Number(job.discount_amount || 0),
    payable: Number(job.payable_amount || 0),
    paidToWashing: Number(job.paid_to_washing_amount || 0),
    washingBalance: Number(job.payable_amount || 0) - Number(job.paid_to_washing_amount || 0),
    createdAt: job.created_at,
    ...(vendorOutstanding ? { vendorOutstanding } : {}),
  };
}
