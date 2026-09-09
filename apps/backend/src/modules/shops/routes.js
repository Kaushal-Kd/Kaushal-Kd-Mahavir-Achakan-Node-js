import { createShopSchema, normalizeOrderNumberPrefix, updateShopSchema } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import knex from '../../db/knex.js';
import { ensureDefaultTimeSlotsForShop } from '../../lib/defaultTimeSlots.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { validate } from '../../utils/validate.js';

/**
 * Return the set of shop ids that are reachable from `rootId` through
 * parent_shop_id (i.e. `rootId` + all its descendants). Used to block
 * cycles when a shop is re-parented.
 */
async function collectDescendantIds(rootId) {
  const visited = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    const children = await knex('shops')
      .where({ parent_shop_id: id })
      .pluck('id');
    for (const c of children) {
      if (!visited.has(c)) {
        visited.add(c);
        queue.push(c);
      }
    }
  }
  return visited;
}

export default async function shopRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request) => {
    let qb = knex('shops').where({ is_active: true });
    if (request.authUser.role !== 'super_admin') {
      qb = qb
        .join('users_shops', 'shops.id', 'users_shops.shop_id')
        .where('users_shops.user_id', request.authUser.id)
        .select('shops.*');
    }
    const result = await paginate(qb, {
      page: request.query.page,
      per_page: request.query.per_page,
      search: request.query.search,
      sort: request.query.sort || 'shop_name',
      search_fields: ['shop_name', 'company_name', 'city', 'gstin'],
    });
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const row = await knex('shops').where({ id: request.params.id }).first();
    if (!row) throw notFound('Shop not found');
    if (request.authUser.role !== 'super_admin') {
      const access = await knex('users_shops')
        .where({ user_id: request.authUser.id, shop_id: row.id })
        .first();
      if (!access) throw forbidden('No access to this shop');
    }
    return { ok: true, data: row };
  });

  fastify.post('/', async (request) => {
    if (request.authUser.role !== 'super_admin') throw forbidden('Only super admin can create shops');
    const body = validate(createShopSchema, request.body);
    if (body.order_number_prefix !== undefined) {
      body.order_number_prefix = normalizeOrderNumberPrefix(body.order_number_prefix);
    }
    if (body.parent_shop_id) {
      const parentExists = await knex('shops')
        .where({ id: body.parent_shop_id })
        .first();
      if (!parentExists) throw badRequest('Parent shop not found');
    }
    const id = uuid();
    await knex('shops').insert({ ...body, id });
    await ensureDefaultTimeSlotsForShop(knex, id);
    const row = await knex('shops').where({ id }).first();
    await request.audit('shops', 'CREATE', { id, new: row });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const id = request.params.id;
    const body = validate(updateShopSchema, { ...request.body, id });
    if (body.order_number_prefix !== undefined) {
      body.order_number_prefix = normalizeOrderNumberPrefix(body.order_number_prefix);
    }
    if (request.authUser.role !== 'super_admin') {
      const access = await knex('users_shops')
        .where({ user_id: request.authUser.id, shop_id: id })
        .first();
      if (!access) throw forbidden('No access to this shop');
    }
    const before = await knex('shops').where({ id }).first();
    if (!before) throw notFound('Shop not found');

    // Prevent hierarchy cycles: a shop can't point at itself or at any of
    // its own descendants. (Only evaluated when parent_shop_id is being set.)
    if (body.parent_shop_id) {
      if (body.parent_shop_id === id) {
        throw badRequest('A shop cannot be its own parent');
      }
      const parentExists = await knex('shops')
        .where({ id: body.parent_shop_id })
        .first();
      if (!parentExists) throw badRequest('Parent shop not found');
      const descendants = await collectDescendantIds(id);
      if (descendants.has(body.parent_shop_id)) {
        throw badRequest('Parent shop cannot be this shop or one of its branches');
      }
    }

    const patch = { ...body, updated_at: knex.fn.now() };
    delete patch.id;
    await knex('shops').where({ id }).update(patch);
    const after = await knex('shops').where({ id }).first();
    await request.audit('shops', 'UPDATE', { id, old: before, new: after });
    return { ok: true, data: after };
  });

  // Soft-delete: mark the shop inactive. Only a super admin can deactivate a
  // shop; the record is kept for audit & historical orders.
  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    if (request.authUser.role !== 'super_admin') {
      throw forbidden('Only super admin can delete shops');
    }
    const id = request.params.id;
    const before = await knex('shops').where({ id }).first();
    if (!before) throw notFound('Shop not found');
    await knex('shops')
      .where({ id })
      .update({ is_active: false, updated_at: knex.fn.now() });
    await request.audit('shops', 'DELETE', { id, old: before });
    return { ok: true, data: { id } };
  });
}
