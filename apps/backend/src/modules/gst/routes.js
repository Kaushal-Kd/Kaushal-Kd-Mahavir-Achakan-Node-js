import {
  gstConversionBodySchema,
  gstReportQuerySchema,
  gstInvoiceQuerySchema,
  gstSourceTypeSchema,
} from '@wrs/shared';
import { z } from 'zod';

import { verifyShopAdminPassword } from '../../utils/shopAdmin.js';
import { validate } from '../../utils/validate.js';

import { convertGstBill, listGstBills } from './service.js';
import {
  getGstCandidate,
  getIssuedGstInvoice,
  issueGstInvoices,
  listGstCandidates,
  listIssuedGstInvoices,
  previewGstInvoices,
} from './invoiceService.js';

export default async function gstRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/candidates', async (r) => ({
    ok: true,
    data: await listGstCandidates(
      r.shopId,
      r.authUser.id,
      validate(gstInvoiceQuerySchema, r.query)
    ),
  }));
  fastify.get('/candidates/:type/:id', async (r) => ({
    ok: true,
    data: await getGstCandidate(
      r.shopId,
      r.authUser.id,
      validate(gstSourceTypeSchema, r.params.type),
      validate(z.string().uuid(), r.params.id)
    ),
  }));
  fastify.post('/invoices/preview', async (r) => ({
    ok: true,
    data: await previewGstInvoices(r.shopId, r.authUser.id, r.body),
  }));
  fastify.post('/invoices', async (r) => {
    const data = await issueGstInvoices(r.shopId, r.authUser.id, r.body);
    if (!data.replayed)
      await r.audit('gst_invoice', 'CREATE', {
        id: r.body.idempotency_key,
        new: { invoice_ids: data.invoices.map((i) => i.id) },
      });
    return { ok: true, data };
  });
  fastify.get('/invoices', async (r) => ({
    ok: true,
    data: await listIssuedGstInvoices(
      r.shopId,
      r.authUser.id,
      validate(gstInvoiceQuerySchema, r.query)
    ),
  }));
  fastify.get('/invoices/:id', async (r) => ({
    ok: true,
    data: await getIssuedGstInvoice(
      r.shopId,
      r.authUser.id,
      validate(z.string().uuid(), r.params.id)
    ),
  }));

  fastify.get('/report', async (request) => {
    const query = validate(gstReportQuerySchema, request.query || {});
    return { ok: true, data: await listGstBills(request.shopId, query) };
  });

  fastify.post('/:id/convert-to-kaccha', async (request) => {
    const body = validate(gstConversionBodySchema, request.body || {});
    const data = await convertGstBill({
      shopId: request.shopId,
      sourceId: request.params.id,
      sourceType: body.source_type,
      userId: request.authUser.id,
      body,
      authorize: (password) => verifyShopAdminPassword(request.shopId, password),
    });
    await request.audit('gst_conversion', 'UPDATE', {
      id: data.conversion.id,
      new: { source_type: body.source_type, source_id: request.params.id, reason: body.reason },
    });
    return { ok: true, data };
  });
}
