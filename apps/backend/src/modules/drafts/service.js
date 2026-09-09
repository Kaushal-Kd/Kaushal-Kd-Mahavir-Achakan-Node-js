import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';

const MAX_KIND_LENGTH = 40;

function parseJSONSafe(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDraftRow(row) {
  if (!row) return row;
  return { ...row, data: parseJSONSafe(row.data) };
}

/**
 * List drafts for a shop, optionally filtered by kind. Returns the user who
 * created each draft so the UI can show "added by".
 *
 * Drafts are intentionally shared across all users of a shop — a shared
 * availability cart is the common case — but callers may pass `onlyMine` to
 * restrict to the authenticated user.
 */
export async function listDrafts(shopId, { kind, userId, onlyMine } = {}) {
  const qb = knex('drafts as d')
    .leftJoin('users as u', 'u.id', 'd.user_id')
    .where({ 'd.shop_id': shopId })
    .orderBy('d.created_at', 'asc')
    .select(
      'd.id',
      'd.shop_id',
      'd.user_id',
      'd.kind',
      'd.data',
      'd.title',
      'd.created_at',
      'd.updated_at',
      'u.name as user_name',
      'u.email as user_email'
    );
  if (kind) qb.andWhere('d.kind', kind);
  if (onlyMine && userId) qb.andWhere('d.user_id', userId);
  const rows = await qb;
  return rows.map(normalizeDraftRow);
}

export async function createDraft(shopId, userId, { kind, data, title }) {
  const resolvedKind = String(kind || 'order').slice(0, MAX_KIND_LENGTH).trim() || 'order';
  const id = uuid();
  await knex('drafts').insert({
    id,
    shop_id: shopId,
    user_id: userId,
    kind: resolvedKind,
    data: data == null ? null : JSON.stringify(data),
    title: title ? String(title).slice(0, 200) : null,
  });
  const row = await knex('drafts as d')
    .leftJoin('users as u', 'u.id', 'd.user_id')
    .where({ 'd.id': id })
    .first(
      'd.*',
      'u.name as user_name',
      'u.email as user_email'
    );
  return normalizeDraftRow(row);
}

export async function updateDraft(shopId, id, { data, title, kind }) {
  const existing = await knex('drafts').where({ id, shop_id: shopId }).first();
  if (!existing) throw notFound('Draft not found');
  const patch = { updated_at: knex.fn.now() };
  if (data !== undefined) patch.data = data == null ? null : JSON.stringify(data);
  if (title !== undefined) patch.title = title ? String(title).slice(0, 200) : null;
  if (kind !== undefined) {
    const normalized = String(kind).slice(0, MAX_KIND_LENGTH).trim();
    if (!normalized) throw badRequest('kind cannot be empty');
    patch.kind = normalized;
  }
  await knex('drafts').where({ id, shop_id: shopId }).update(patch);
  const row = await knex('drafts as d')
    .leftJoin('users as u', 'u.id', 'd.user_id')
    .where({ 'd.id': id })
    .first(
      'd.*',
      'u.name as user_name',
      'u.email as user_email'
    );
  return normalizeDraftRow(row);
}

export async function deleteDraft(shopId, id) {
  const existing = await knex('drafts').where({ id, shop_id: shopId }).first();
  if (!existing) throw notFound('Draft not found');
  await knex('drafts').where({ id, shop_id: shopId }).del();
  return existing;
}

/**
 * Bulk-delete drafts for a shop. Supports filtering by kind, a list of ids,
 * or a single user_id. Returns the number of rows removed.
 */
export async function deleteDrafts(shopId, { kind, ids, userId } = {}) {
  const qb = knex('drafts').where({ shop_id: shopId });
  if (kind) qb.andWhere({ kind });
  if (Array.isArray(ids) && ids.length) qb.whereIn('id', ids);
  if (userId) qb.andWhere({ user_id: userId });
  return qb.del();
}
