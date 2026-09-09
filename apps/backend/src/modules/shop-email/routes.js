import { ACTIONS, MODULES } from '@wrs/shared';
import { z } from 'zod';

import { badRequest } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

import { shopEmailService } from './service.js';

export default async function shopEmailRoutes(fastify, { emailService = shopEmailService } = {}) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);
  fastify.addHook('preHandler', fastify.requirePermission(MODULES.SHOPS, ACTIONS.VIEW));
  // The URL and authenticated context must agree, including after a browser shop switch/retry.
  fastify.addHook('preHandler', async (request) => {
    validate(z.string().uuid(), request.params.shopId);
    if (request.params.shopId !== request.shopId)
      throw badRequest('Shop changed. Reopen Email Settings for the selected shop.');
  });
  fastify.get('/:shopId', async (request) => ({
    ok: true,
    data: await emailService.getSettings(request.shopId, request.authUser),
  }));
  fastify.put('/:shopId', async (request) => {
    const data = await emailService.saveSettings(request.shopId, request.authUser, request.body);
    await request.audit('shop_email_settings', 'UPDATE', {
      id: request.shopId,
      new: { revision: data.revision, configured: data.configured },
    });
    return { ok: true, data };
  });
  fastify.post('/:shopId/test', async (request) => {
    const data = await emailService.sendTest(request.shopId, request.authUser, request.body);
    await request.audit('shop_email_settings', 'TEST', {
      id: request.shopId,
      new: { accepted: true },
    });
    return { ok: true, data };
  });
}
