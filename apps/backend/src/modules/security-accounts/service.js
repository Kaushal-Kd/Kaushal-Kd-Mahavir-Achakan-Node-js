import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';

function normAccountType(type) {
  return String(type ?? '')
    .trim()
    .toLowerCase();
}

function resolveAccountType(body) {
  const type = normAccountType(body.account_type);
  return type === 'bank' ? 'bank' : 'cash';
}

function resolveQrCodeUrl(body) {
  if (resolveAccountType(body) !== 'bank') {
    return '';
  }
  return String(body.qr_code_url ?? '').trim().slice(0, 500);
}

export async function list(shopId) {
  return knex('security_accounts')
    .where({ shop_id: shopId, is_active: true })
    .orderBy('created_at', 'asc');
}

export async function create(shopId, body) {
  const id = (body.id && String(body.id).trim()) || uuid();
  const shortId = id.slice(0, 80);
  const exists = await knex('security_accounts').where({ shop_id: shopId, id: shortId }).first();
  if (exists) throw badRequest('A security account with this id already exists');

  const row = {
    shop_id: shopId,
    id: shortId,
    name: body.name,
    account_type: resolveAccountType(body),
    qr_code_url: resolveQrCodeUrl(body),
    is_active: body.is_active !== false,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now(),
  };
  await knex('security_accounts').insert(row);
  return knex('security_accounts').where({ shop_id: shopId, id: shortId }).first();
}

export async function update(shopId, accountId, body) {
  const row = await knex('security_accounts').where({ shop_id: shopId, id: accountId }).first();
  if (!row) throw notFound('Security account not found');
  const nextType =
    body.account_type !== undefined ? resolveAccountType(body) : resolveAccountType(row);
  const patch = { ...body, updated_at: knex.fn.now() };
  delete patch.id;
  delete patch.shop_id;
  if (body.account_type !== undefined) {
    patch.account_type = nextType;
  }
  if (body.qr_code_url !== undefined || body.account_type !== undefined) {
    patch.qr_code_url = resolveQrCodeUrl({ ...row, ...body, account_type: nextType });
  }
  await knex('security_accounts').where({ shop_id: shopId, id: accountId }).update(patch);
  return knex('security_accounts').where({ shop_id: shopId, id: accountId }).first();
}

export async function remove(shopId, accountId) {
  const row = await knex('security_accounts').where({ shop_id: shopId, id: accountId }).first();
  if (!row) throw notFound('Security account not found');
  await knex('security_accounts').where({ shop_id: shopId, id: accountId }).delete();
}
