import { catalogDeleteSchema, createAccessorySchema, updateAccessorySchema } from '@wrs/shared';

import { validate } from '../../utils/validate.js';
import {
  listAccessories,
  listRecommendedAccessories,
  checkAccessoryAvailability,
  listAccessoryOutOrders,
  getAccessory,
  createAccessory,
  updateAccessory,
  deleteAccessory,
  activateAccessory,
  getAccessoryCategoryCounts,
  getAccessoryCodeFormat,
  updateAccessoryCodeFormat,
  generateNextAccessoryCode,
  getLastAccessoryCodeForCategory,
} from './service.js';

export default async function accessoryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await listAccessories(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/category-counts', async (request) => {
    const data = await getAccessoryCategoryCounts(request.shopId, request.query || {});
    return { ok: true, data };
  });

  fastify.get('/recommendations', async (request) => {
    const data = await listRecommendedAccessories(request.shopId, request.query || {});
    return { ok: true, data };
  });

  fastify.get('/availability', async (request) => {
    const data = await checkAccessoryAvailability(request.shopId, request.query || {});
    return { ok: true, data };
  });

  // One request for many accessories (booking accessory picker refreshes dozens at once).
  fastify.get('/availability-batch', async (request) => {
    const q = request.query || {};
    const ids = [
      ...new Set(
        String(q.accessory_ids || '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      ),
    ].slice(0, 300);
    const results = {};
    const CHUNK = 8;
    for (let i = 0; i < ids.length; i += CHUNK) {
      await Promise.all(
        ids.slice(i, i + CHUNK).map(async (id) => {
          try {
            results[id] = await checkAccessoryAvailability(request.shopId, {
              ...q,
              accessory_id: id,
            });
          } catch (err) {
            results[id] = { error: err?.message || 'unavailable' };
          }
        })
      );
    }
    return { ok: true, data: results };
  });

  fastify.get('/code-format', async (request) => {
    const data = await getAccessoryCodeFormat(request.shopId);
    return { ok: true, data };
  });

  fastify.put('/code-format', async (request) => {
    const data = await updateAccessoryCodeFormat(request.shopId, request.body || {});
    return { ok: true, data };
  });

  fastify.get('/next-code', async (request) => {
    const categoryId = request.query?.category_id || null;
    const data = await generateNextAccessoryCode(request.shopId, categoryId);
    return { ok: true, data };
  });

  fastify.get('/last-code', async (request) => {
    const categoryId = request.query?.category_id || null;
    const data = await getLastAccessoryCodeForCategory(request.shopId, categoryId);
    return { ok: true, data };
  });

  fastify.get('/:id/out-orders', async (request) => {
    const data = await listAccessoryOutOrders(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.get('/:id', async (request) => {
    const data = await getAccessory(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = validate(createAccessorySchema, { ...request.body, shop_id: request.shopId });
    const data = await createAccessory(request.shopId, body);
    await request.audit('accessories', 'CREATE', { id: data.id, new: data });
    return { ok: true, data };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateAccessorySchema, {
      ...request.body,
      id: request.params.id,
      shop_id: request.shopId,
    });
    const { before, after } = await updateAccessory(request.shopId, request.params.id, body);
    await request.audit('accessories', 'UPDATE', { id: after.id, old: before, new: after });
    return { ok: true, data: after };
  });

  fastify.post(
    '/:id/activate',
    { preHandler: fastify.requireShopAdminPassword },
    async (request) => {
      const { before, after } = await activateAccessory(request.shopId, request.params.id);
      await request.audit('accessories', 'UPDATE', { id: after.id, old: before, new: after });
      return { ok: true, data: after };
    }
  );

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const intent = validate(catalogDeleteSchema, request.body || {});
    const { before, mode } = await deleteAccessory(request.shopId, request.params.id, intent.mode);
    await request.audit('accessories', mode === 'deactivated' ? 'DELETE' : 'DELETE_PERMANENT', {
      id: before.id,
      old: before,
    });
    return { ok: true, data: { mode } };
  });
}
