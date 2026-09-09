import {
  availabilityQuickCreateCustomerSchema,
  createCustomerSchema,
  updateCustomerSchema,
} from '@wrs/shared';

import { validate } from '../../utils/validate.js';

import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
} from './service.js';

export default async function customerRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await listCustomers(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/search', async (request) => {
    const term = (request.query?.q || '').toString().trim();
    if (!term) return { ok: true, data: [] };
    const data = await searchCustomers(request.shopId, term);
    return { ok: true, data };
  });

  fastify.post('/quick-availability', async (request) => {
    const body = validate(availabilityQuickCreateCustomerSchema, request.body || {});
    const data = await createCustomer(request.shopId, { ...body, shop_id: request.shopId });
    await request.audit('customers', 'CREATE', { id: data.id, new: data });
    return { ok: true, data };
  });

  fastify.get('/:id', async (request) => {
    const data = await getCustomer(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = validate(createCustomerSchema, { ...request.body, shop_id: request.shopId });
    const data = await createCustomer(request.shopId, body);
    await request.audit('customers', 'CREATE', { id: data.id, new: data });
    return { ok: true, data };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateCustomerSchema, {
      ...request.body,
      id: request.params.id,
      shop_id: request.shopId,
    });
    const { before, after } = await updateCustomer(request.shopId, request.params.id, body);
    await request.audit('customers', 'UPDATE', { id: after.id, old: before, new: after });
    return { ok: true, data: after };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const before = await deleteCustomer(request.shopId, request.params.id);
    await request.audit('customers', 'DELETE', { id: before.id, old: before });
    return { ok: true };
  });
}
