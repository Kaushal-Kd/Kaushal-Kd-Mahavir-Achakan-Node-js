import { listWashingQueue, removeFromQueue, removeMultipleFromQueue } from './service.js';

export default async function washingQueueRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const data = await listWashingQueue(request.shopId);
    return { ok: true, data };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request, reply) => {
    const removed = await removeFromQueue(request.shopId, request.params.id);
    if (!removed) return reply.code(404).send({ ok: false, error: { message: 'Queue item not found' } });
    return { ok: true };
  });

  fastify.post('/bulk-remove', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const ids = request.body?.ids || [];
    const removed = await removeMultipleFromQueue(request.shopId, ids);
    return { ok: true, removed };
  });
}
