import knex from '../../db/knex.js';
import { validate } from '../../utils/validate.js';
import { logEntityRow } from '../system-logs/helpers.js';
import { createLaundryJobSchema, returnSelectedSchema } from './schema.js';
import {
  createLaundryJob,
  deleteLaundryJob,
  getLaundryJob,
  getLaundryReturnLogs,
  getVendorWashingOutstanding,
  listLaundryJobs,
  markAccessoryReturned,
  markAllReturned,
  markProductCancelled,
  markProductReturned,
  returnSelectedItems,
  updateLaundryJob,
} from './service.js';

export default async function laundryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await listLaundryJobs(request.shopId, request.query || {});
    return { ok: true, ...result };
  });

  fastify.get('/vendor-outstanding', async (request, reply) => {
    const query = request.query || {};
    const vendorAccountId = query.vendor_account_id || query.vendorAccountId || null;
    const vendorName = query.vendor_name || query.vendorName || null;
    const excludeJobId = query.exclude_job_id || query.excludeJobId || null;

    if (!vendorAccountId && !String(vendorName || '').trim()) {
      return reply.code(400).send({
        ok: false,
        error: { message: 'vendor_account_id or vendor_name is required' },
      });
    }

    const data = await getVendorWashingOutstanding(request.shopId, {
      vendorAccountId,
      vendorName,
      excludeJobId,
    });
    return { ok: true, data };
  });

  fastify.get('/:id', async (request, reply) => {
    const data = await getLaundryJob(request.shopId, request.params.id);
    if (!data) return reply.code(404).send({ ok: false, error: { message: 'Laundry job not found' } });
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = validate(createLaundryJobSchema, request.body || {});
    const data = await createLaundryJob(request.shopId, body);
    await request.audit('laundry_jobs', 'CREATE', { id: data.id, new: data });
    await logEntityRow(knex, request.shopId, data, 'washing', 'CREATE', request.authUser, {
      billNo: data.bill_no,
      productData: { products: data.products, accessories: data.accessories },
    });
    return { ok: true, data };
  });

  fastify.put('/:id', async (request, reply) => {
    const body = validate(createLaundryJobSchema, request.body || {});
    const data = await updateLaundryJob(request.shopId, request.params.id, body);
    if (!data) return reply.code(404).send({ ok: false, error: { message: 'Laundry job not found' } });
    await request.audit('laundry_jobs', 'UPDATE', { id: data.id, new: data });
    await logEntityRow(knex, request.shopId, data, 'washing', 'UPDATE', request.authUser, {
      billNo: data.bill_no,
      productData: { products: data.products, accessories: data.accessories },
    });
    return { ok: true, data };
  });

  fastify.get('/:id/return-logs', async (request, reply) => {
    const data = await getLaundryReturnLogs(request.shopId, request.params.id);
    if (!data) return reply.code(404).send({ ok: false, error: { message: 'Laundry job not found' } });
    return { ok: true, data };
  });

  fastify.patch('/:id/return-selected', async (request, reply) => {
    const body = validate(returnSelectedSchema, request.body || {});
    const result = await returnSelectedItems(request.shopId, request.params.id, body);
    if (!result) return reply.code(404).send({ ok: false, error: { message: 'Laundry job not found' } });
    if (result.error) return reply.code(400).send({ ok: false, error: { message: result.error } });
    if (result.already) {
      return reply.code(400).send({
        ok: false,
        error: { message: `Already ${result.already}` },
      });
    }
    return { ok: true, data: result };
  });

  fastify.patch('/:id/products/:lineId/return', async (request, reply) => {
    const result = await markProductReturned(request.shopId, request.params.id, request.params.lineId);
    if (!result) return reply.code(404).send({ ok: false, error: { message: 'Product line not found' } });
    if (result.already) return reply.code(400).send({ ok: false, error: { message: `Already ${result.already}` } });
    return { ok: true };
  });

  fastify.patch('/:id/products/:lineId/cancel', async (request, reply) => {
    const result = await markProductCancelled(request.shopId, request.params.id, request.params.lineId);
    if (!result) return reply.code(404).send({ ok: false, error: { message: 'Product line not found' } });
    if (result.already) return reply.code(400).send({ ok: false, error: { message: `Already ${result.already}` } });
    return { ok: true };
  });

  fastify.patch('/:id/accessories/:lineId/return', async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const returnQty = body.returnQty != null ? Number(body.returnQty) : undefined;
    const result = await markAccessoryReturned(
      request.shopId,
      request.params.id,
      request.params.lineId,
      returnQty != null && Number.isFinite(returnQty) ? { returnQty } : {}
    );
    if (!result) return reply.code(404).send({ ok: false, error: { message: 'Accessory line not found' } });
    if (result.already) return reply.code(400).send({ ok: false, error: { message: `Already ${result.already}` } });
    if (result.error) return reply.code(400).send({ ok: false, error: { message: result.error } });
    return { ok: true, data: result };
  });

  fastify.patch('/:id/return-all', async (request, reply) => {
    const result = await markAllReturned(request.shopId, request.params.id);
    if (!result) return reply.code(404).send({ ok: false, error: { message: 'Laundry job not found' } });
    return { ok: true };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request, reply) => {
    const before = await getLaundryJob(request.shopId, request.params.id);
    const removed = await deleteLaundryJob(request.shopId, request.params.id);
    if (!removed) return reply.code(404).send({ ok: false, error: { message: 'Laundry job not found' } });
    await request.audit('laundry_jobs', 'DELETE', { id: request.params.id });
    if (before) {
      await logEntityRow(knex, request.shopId, before, 'washing', 'DELETE', request.authUser, {
        billNo: before.bill_no,
      });
    }
    return { ok: true };
  });
}
