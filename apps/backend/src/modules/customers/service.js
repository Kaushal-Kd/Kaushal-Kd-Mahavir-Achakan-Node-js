import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';

function normalizeCustomerRow(row) {
  return row ? { ...row, total_bill_amount: Number(row.total_bill_amount || 0) } : row;
}

function customerTotalBillSql(customerRef = 'c.id', shopRef = 'c.shop_id') {
  return `(
    COALESCE((
      SELECT SUM(o.total_amount) FROM orders o
      WHERE o.customer_id = ${customerRef} AND o.shop_id = ${shopRef}
        AND o.is_deleted = 0 AND o.status <> 'cancelled'
    ), 0)
    + COALESCE((
      SELECT SUM(s.total_amount) FROM sales s
      WHERE s.customer_id = ${customerRef} AND s.shop_id = ${shopRef}
        AND s.status <> 'cancelled'
    ), 0)
  )`;
}

function customerSelect(qb) {
  return qb.select('c.*', knex.raw(`${customerTotalBillSql()} AS total_bill_amount`));
}

function toCustomerDBRow(data) {
  const row = { ...data };
  if (row.photo_url === '') row.photo_url = null;
  return row;
}

export function listCustomers(shopId, query) {
  const qb = customerSelect(
    knex('customers as c').where({ 'c.shop_id': shopId, 'c.is_active': true })
  );
  if (query.created_from)
    qb.andWhere(knex.raw('DATE(c.created_at) >= ?', [String(query.created_from).slice(0, 10)]));
  if (query.created_to)
    qb.andWhere(knex.raw('DATE(c.created_at) <= ?', [String(query.created_to).slice(0, 10)]));
  return paginate(qb, {
    page: query.page,
    per_page: query.per_page,
    search: query.search,
    sort: query.sort || '-c.created_at',
    search_fields: ['c.name', 'c.phone1', 'c.phone2', 'c.email', 'c.address'],
  }).then((result) => ({
    ...result,
    data: result.data.map(normalizeCustomerRow),
  }));
}

export async function getCustomer(shopId, id) {
  const row = await customerSelect(
    knex('customers as c').where({ 'c.id': id, 'c.shop_id': shopId })
  ).first();
  if (!row) throw notFound('Customer not found');
  return normalizeCustomerRow(row);
}

export async function createCustomer(shopId, data) {
  const id = uuid();
  const payload = toCustomerDBRow({
    ...data,
    id,
    shop_id: shopId,
    is_active: data.is_active ?? true,
  });
  await knex('customers').insert(payload);
  return getCustomer(shopId, id);
}

export async function updateCustomer(shopId, id, data) {
  const existing = await getCustomer(shopId, id);
  const patch = toCustomerDBRow({ ...data, shop_id: shopId, updated_at: knex.fn.now() });
  delete patch.id;
  Object.keys(patch).forEach((k) => {
    if (patch[k] === undefined) delete patch[k];
  });
  await knex('customers').where({ id, shop_id: shopId }).update(patch);
  const fresh = await getCustomer(shopId, id);
  return { before: existing, after: fresh };
}

export async function deleteCustomer(shopId, id) {
  const existing = await getCustomer(shopId, id);
  await knex('customers')
    .where({ id, shop_id: shopId })
    .update({ is_active: false, updated_at: knex.fn.now() });
  return existing;
}

export async function searchCustomers(shopId, term) {
  const q = `%${term}%`;
  const rows = await customerSelect(knex('customers as c'))
    .where({ 'c.shop_id': shopId, 'c.is_active': true })
    .andWhere((b) => {
      b.where('c.name', 'like', q)
        .orWhere('c.phone1', 'like', q)
        .orWhere('c.phone2', 'like', q)
        .orWhere('c.address', 'like', q);
    })
    .orderBy('c.name')
    .limit(20);
  return rows.map(normalizeCustomerRow);
}
