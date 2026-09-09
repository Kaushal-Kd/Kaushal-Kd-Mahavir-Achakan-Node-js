import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { diffNormalized } from './logger.js';

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function mapRow(row, { includeSnapshots = true } = {}) {
  const bill_data = includeSnapshots ? parseJsonField(row.bill_data) : undefined;
  const product_data = includeSnapshots ? parseJsonField(row.product_data) : undefined;

  return {
    id: row.id,
    shop_id: row.shop_id,
    module: row.module,
    entity_id: row.entity_id,
    bill_no: row.bill_no,
    user_id: row.user_id,
    user_name: row.user_name,
    action_type: row.action_type,
    change_count: row.change_count,
    bill_change_count: Number(row.bill_change_count ?? 0),
    product_change_count: Number(row.product_change_count ?? 0),
    responsible_by: row.responsible_by,
    ...(includeSnapshots ? { bill_data, product_data } : {}),
    bill_changes: parseJsonField(row.bill_changes),
    product_changes: parseJsonField(row.product_changes),
    created_at: row.created_at,
  };
}

function enrichRowWithComputedChanges(mapped, prevRow) {
  const prevBill = parseJsonField(prevRow?.bill_data);
  const prevProduct = parseJsonField(prevRow?.product_data);

  const { billDiff, productDiff } = diffNormalized(
    mapped.module,
    prevBill,
    prevProduct,
    mapped.bill_data,
    mapped.product_data
  );

  return {
    ...mapped,
    bill_changes: billDiff.changes,
    product_changes: productDiff.changes,
    bill_change_count: billDiff.changeCount,
    product_change_count: productDiff.changeCount,
  };
}

async function loadPreviousLog(shopId, row) {
  return knex('system_logs')
    .where({
      shop_id: shopId,
      module: row.module,
      entity_id: row.entity_id,
    })
    .where('created_at', '<', row.created_at)
    .orderBy('created_at', 'desc')
    .first('bill_data', 'product_data');
}

/**
 * @param {string} shopId
 * @param {Array<{ id: string, module: string, entity_id: string, created_at: string | Date }>} rows
 * @returns {Promise<Map<string, { bill_data: unknown, product_data: unknown } | null>>}
 */
async function loadPreviousLogsBatch(shopId, rows) {
  const prevByLogId = new Map();
  if (!rows.length) return prevByLogId;

  const byModule = new Map();
  for (const row of rows) {
    if (!byModule.has(row.module)) byModule.set(row.module, []);
    byModule.get(row.module).push(row);
  }

  for (const [module, moduleRows] of byModule) {
    const entityIds = [...new Set(moduleRows.map((r) => r.entity_id))];
    const history = await knex('system_logs')
      .where({ shop_id: shopId, module })
      .whereIn('entity_id', entityIds)
      .orderBy('entity_id')
      .orderBy('created_at', 'asc')
      .select('id', 'entity_id', 'created_at', 'bill_data', 'product_data');

    const byEntity = new Map();
    for (const log of history) {
      const key = String(log.entity_id);
      if (!byEntity.has(key)) byEntity.set(key, []);
      byEntity.get(key).push(log);
    }

    for (const row of moduleRows) {
      const chain = byEntity.get(String(row.entity_id)) || [];
      const idx = chain.findIndex((log) => String(log.id) === String(row.id));
      prevByLogId.set(String(row.id), idx > 0 ? chain[idx - 1] : null);
    }
  }

  return prevByLogId;
}

/** @param {string} shopId */
/** @param {Record<string, unknown>} query */
export async function listSystemLogs(shopId, query = {}) {
  const qb = knex('system_logs').where({ shop_id: shopId });

  if (query.module) {
    qb.andWhere('module', query.module);
  }

  if (query.entity_id) {
    qb.andWhere('entity_id', query.entity_id);
  }

  if (query.use_date) {
    const from = query.from || query.date;
    const to = query.to || query.date || from;
    if (from) {
      qb.andWhere('created_at', '>=', `${from} 00:00:00`);
    }
    if (to) {
      qb.andWhere('created_at', '<=', `${to} 23:59:59`);
    }
  }

  const result = await paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: '-created_at',
    search_fields: ['bill_no', 'user_name', 'responsible_by', 'entity_id', 'action_type'],
  });

  const prevByLogId = await loadPreviousLogsBatch(shopId, result.data);
  const data = result.data.map((row) => {
    const mapped = mapRow(row);
    const prevRow = prevByLogId.get(String(row.id)) ?? null;
    return enrichRowWithComputedChanges(mapped, prevRow);
  });

  return {
    data,
    meta: result.meta,
  };
}

/** @param {string} shopId @param {string} logId */
export async function getSystemLogById(shopId, logId) {
  const row = await knex('system_logs').where({ shop_id: shopId, id: logId }).first();
  if (!row) throw notFound('System log not found');

  const mapped = mapRow(row);
  const prevRow = await loadPreviousLog(shopId, row);
  return enrichRowWithComputedChanges(mapped, prevRow);
}
