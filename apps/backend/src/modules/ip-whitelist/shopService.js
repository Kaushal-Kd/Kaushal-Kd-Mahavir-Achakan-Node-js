import { createHash } from 'node:crypto';
import { shopIpCommandSchema } from '@wrs/shared';

import knex from '../../db/knex.js';
import { requireShopAdministrator } from '../../lib/requireShopAdministrator.js';
import { badRequest, conflict, forbidden, ipAccessDenied } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';
import { evaluateIpAccess, normalizeAllowedRanges, resolveIpAccess } from './service.js';

const ranges = (value) => (typeof value === 'string' ? JSON.parse(value) : value || []);

export function combineShopIpAccess(global, shop) {
  return {
    allowed: global.allowed && shop.allowed,
    restricted: global.restricted || shop.restricted,
    effective_mode: !global.allowed
      ? global.effective_mode
      : shop.restricted
        ? 'shop_restricted'
        : global.effective_mode,
  };
}

export async function resolveShopIpAccess(db, shopId, userId, clientIp) {
  const global = await resolveIpAccess(userId, clientIp, db);
  const user = await db('users').where({ id: userId }).first('role');
  const config = await db('shop_ip_policies').where({ shop_id: shopId }).first();
  const policy = await db('shop_user_ip_policies')
    .where({ shop_id: shopId, user_id: userId })
    .first();
  return combineShopIpAccess(
    global,
    evaluateIpAccess({
      role: user?.role,
      clientIp,
      globalEnabled: Boolean(config?.enabled),
      globalAllowedRanges: ranges(config?.allowed_ranges),
      userMode: policy?.mode || 'inherit',
      userAllowedRanges: ranges(policy?.allowed_ranges),
    })
  );
}

export async function assertShopIpAccess(db, shopId, userId, clientIp) {
  const result = await resolveShopIpAccess(db, shopId, userId, clientIp);
  if (!result.allowed) throw ipAccessDenied(clientIp);
  return result;
}

export async function getShopIpPolicies(shopId, actorId, clientIp) {
  await requireShopAdministrator(knex, shopId, actorId);
  const config = await knex('shop_ip_policies').where({ shop_id: shopId }).first();
  const members = await knex('users as u')
    .join('users_shops as us', 'us.user_id', 'u.id')
    .leftJoin('shop_user_ip_policies as p', function joinPolicy() {
      this.on('p.user_id', '=', 'u.id').andOn('p.shop_id', '=', 'us.shop_id');
    })
    .where('us.shop_id', shopId)
    .whereNot('u.role', 'super_admin')
    .select('u.id', 'u.name', 'u.role', 'p.mode', 'p.allowed_ranges')
    .orderBy('u.name');
  return {
    shop_id: shopId,
    revision: Number(config?.revision || 0),
    current_ip: clientIp,
    enabled: Boolean(config?.enabled),
    allowed_ranges: ranges(config?.allowed_ranges),
    users: await Promise.all(
      members.map(async (member) => ({
        ...member,
        mode: member.mode || 'inherit',
        allowed_ranges: ranges(member.allowed_ranges),
        effective: await resolveShopIpAccess(knex, shopId, member.id, clientIp),
      }))
    ),
  };
}

export async function applyShopIpCommand(shopId, actorId, clientIp, payload) {
  const body = validate(shopIpCommandSchema, payload);
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const actor = await requireShopAdministrator(knex, shopId, actorId);
  return knex.transaction(async (trx) => {
    await trx('shops').where({ id: shopId }).forUpdate().first();
    const previous = await trx('shop_ip_commands').where({ id: body.idempotency_key }).first();
    if (previous) {
      if (
        previous.shop_id !== shopId ||
        previous.actor_id !== actorId ||
        previous.payload_hash !== hash
      )
        throw conflict('This request key belongs to a different IP policy change');
      return { revision: previous.revision, replayed: true };
    }
    const before = await trx('shop_ip_policies').where({ shop_id: shopId }).forUpdate().first();
    if (Number(before?.revision || 0) !== body.expected_revision)
      throw conflict('IP policies changed. Reload and review before saving.');
    let allowed;
    try {
      allowed = normalizeAllowedRanges(
        body.policy.allowed_ranges,
        body.policy.kind === 'shop' ? 100 : 50
      );
    } catch (error) {
      throw badRequest(error.message);
    }
    const revision = body.expected_revision + 1;
    if (!before)
      await trx('shop_ip_policies').insert({
        shop_id: shopId,
        enabled: false,
        allowed_ranges: '[]',
        revision: 0,
      });
    if (body.policy.kind === 'shop') {
      await trx('shop_ip_policies')
        .where({ shop_id: shopId })
        .update({ enabled: body.policy.enabled, allowed_ranges: JSON.stringify(allowed) });
    } else {
      const target = await trx('users as u')
        .join('users_shops as us', 'us.user_id', 'u.id')
        .where({ 'u.id': body.policy.user_id, 'us.shop_id': shopId })
        .first('u.role');
      if (!target || target.role === 'super_admin')
        throw forbidden('Select a non-super-admin member of this shop');
      const value = {
        shop_id: shopId,
        user_id: body.policy.user_id,
        mode: body.policy.mode,
        allowed_ranges: JSON.stringify(body.policy.mode === 'restricted' ? allowed : []),
      };
      await trx('shop_user_ip_policies')
        .insert(value)
        .onConflict(['shop_id', 'user_id'])
        .merge(value);
    }
    if (
      actor.role !== 'super_admin' &&
      !(await resolveShopIpAccess(trx, shopId, actorId, clientIp)).allowed
    )
      throw conflict(
        'This change would block your current connection. Add your current IP or ask a Super Admin to make the change.'
      );
    await trx('shop_ip_policies')
      .where({ shop_id: shopId })
      .update({ revision, updated_by: actorId, updated_at: trx.fn.now() });
    await trx('shop_ip_commands').insert({
      id: body.idempotency_key,
      shop_id: shopId,
      actor_id: actorId,
      payload_hash: hash,
      revision,
    });
    return { revision, replayed: false };
  });
}
