import {
  createDraft,
  deleteDraft,
  deleteDrafts,
  listDrafts,
  updateDraft,
} from './service.js';

/**
 * Drafts API — used for things like the shared availability cart on the
 * Check Availability page. Each user's unfinished work is persisted so it
 * survives page refreshes, and all staff in the shop see each other's
 * in-progress cart rows (with the "added by" user attached).
 */
export default async function draftRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const kind = (request.query?.kind || '').toString().trim() || undefined;
    const onlyMine = ['1', 'true', 'yes'].includes(
      String(request.query?.mine || '').toLowerCase()
    );
    const data = await listDrafts(request.shopId, {
      kind,
      userId: request.authUser.id,
      onlyMine,
    });
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = request.body || {};
    const data = await createDraft(request.shopId, request.authUser.id, {
      kind: body.kind,
      data: body.data,
      title: body.title,
    });
    return { ok: true, data };
  });

  fastify.put('/:id', async (request) => {
    const data = await updateDraft(request.shopId, request.params.id, request.body || {});
    return { ok: true, data };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    await deleteDraft(request.shopId, request.params.id);
    return { ok: true };
  });

  fastify.post('/bulk-delete', async (request) => {
    const body = request.body || {};
    const onlyMine = Boolean(body.mine);
    const removed = await deleteDrafts(request.shopId, {
      kind: body.kind,
      ids: Array.isArray(body.ids) ? body.ids : undefined,
      userId: onlyMine ? request.authUser.id : undefined,
    });
    return { ok: true, removed };
  });
}
