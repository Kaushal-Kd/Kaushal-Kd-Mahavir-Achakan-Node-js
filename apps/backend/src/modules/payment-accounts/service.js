import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';

function normAccountGroup(group) {
  return String(group ?? '')
    .trim()
    .toLowerCase();
}

function resolveQrCodeUrl(body) {
  const group = body.account_group ?? '';
  if (normAccountGroup(group) !== 'bank accounts') {
    return '';
  }
  return String(body.qr_code_url ?? '').trim().slice(0, 500);
}

export async function list(shopId) {
  return knex('payment_accounts')
    .where({ shop_id: shopId, is_active: true })
    .orderBy('created_at', 'asc');
}

export async function create(shopId, body) {
  const id = (body.id && String(body.id).trim()) || uuid();
  const shortId = id.slice(0, 80);
  const exists = await knex('payment_accounts').where({ shop_id: shopId, id: shortId }).first();
  if (exists) throw badRequest('An account with this id already exists');

  const row = {
    shop_id: shopId,
    id: shortId,
    name: body.name,
    contact_no: body.contact_no ?? '',
    account_group: body.account_group ?? '',
    account_type: body.account_type ?? 'other',
    opening_balance: body.opening_balance ?? 0,
    date: body.date ?? '',
    email: body.email ?? '',
    address: body.address ?? '',
    remarks: body.remarks ?? '',
    qr_code_url: resolveQrCodeUrl(body),
    is_active: body.is_active !== false,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  };
  await knex('payment_accounts').insert(row);
  return knex('payment_accounts').where({ shop_id: shopId, id: shortId }).first();
}

export async function update(shopId, accountId, body) {
  const row = await knex('payment_accounts').where({ shop_id: shopId, id: accountId }).first();
  if (!row) throw notFound('Payment account not found');
  const nextGroup = body.account_group !== undefined ? body.account_group : row.account_group;
  const patch = { ...body, updated_at: knex.fn.now() };
  delete patch.id;
  delete patch.shop_id;
  delete patch.shop_name;
  if (body.qr_code_url !== undefined || body.account_group !== undefined) {
    patch.qr_code_url = resolveQrCodeUrl({ ...row, ...body, account_group: nextGroup });
  }
  await knex('payment_accounts').where({ shop_id: shopId, id: accountId }).update(patch);
  return knex('payment_accounts').where({ shop_id: shopId, id: accountId }).first();
}

export async function remove(shopId, accountId) {
  const row = await knex('payment_accounts').where({ shop_id: shopId, id: accountId }).first();
  if (!row) throw notFound('Payment account not found');
  await knex('payment_accounts').where({ shop_id: shopId, id: accountId }).delete();
}
