import { bulkDeleteProductsByCodeInputSchema } from '@wrs/shared';
import { z } from 'zod';

import { validate } from '../../utils/validate.js';
import {
  bulkHardDeleteProductsByCode,
  previewBulkDeleteProductsByCode,
} from '../products/service.js';
import {
  getImportErrorExport,
  getImportTemplateCsv,
  getProductBulkDeleteTemplateCsv,
  listImportJobs,
  uploadImportCsv,
} from './service.js';

const uploadBodySchema = z.object({
  file_name: z.string().trim().max(255).optional().nullable(),
  csv_text: z.string().min(1, 'CSV text is required'),
  allow_auto_create_missing: z.boolean().optional().default(false),
  confirm_create_missing: z.boolean().optional().default(false),
  auto_generate_missing_codes: z.boolean().optional().default(true),
  images_zip_object_path: z.string().trim().max(500).optional().nullable(),
});

export default async function importRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/products/template', async () => {
    const csv = getImportTemplateCsv('product');
    return { ok: true, data: { file_name: 'products_bulk_template.csv', csv } };
  });

  fastify.get('/accessories/template', async () => {
    const csv = getImportTemplateCsv('accessory');
    return { ok: true, data: { file_name: 'accessories_bulk_template.csv', csv } };
  });

  fastify.get('/products/bulk-delete/template', async () => {
    const csv = getProductBulkDeleteTemplateCsv();
    return { ok: true, data: { file_name: 'products_bulk_delete_template.csv', csv } };
  });

  fastify.post('/products/bulk-delete/preview', async (request) => {
    const body = validate(bulkDeleteProductsByCodeInputSchema, request.body || {});
    const data = await previewBulkDeleteProductsByCode(request.shopId, body);
    return { ok: true, data };
  });

  fastify.post('/products/bulk-delete', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const body = validate(bulkDeleteProductsByCodeInputSchema, request.body || {});
    const data = await bulkHardDeleteProductsByCode(request.shopId, body);
    for (const before of data.products || []) {
      await request.audit('products', 'DELETE', { id: before.id, old: before });
    }
    return { ok: true, data };
  });

  fastify.post('/products/upload', async (request) => {
    const body = validate(uploadBodySchema, request.body || {});
    const data = await uploadImportCsv(
      request.shopId,
      request.authUser.id,
      'product',
      body.file_name,
      body.csv_text,
      {
        allow_auto_create_missing: body.allow_auto_create_missing,
        confirm_create_missing: body.confirm_create_missing,
        auto_generate_missing_codes: body.auto_generate_missing_codes,
        images_zip_object_path: body.images_zip_object_path,
      }
    );
    await request.audit('imports', 'BULK_UPLOAD_PRODUCTS', { id: data.job_id, new: data });
    return { ok: true, data };
  });

  fastify.post('/accessories/upload', async (request) => {
    const body = validate(uploadBodySchema, request.body || {});
    const data = await uploadImportCsv(
      request.shopId,
      request.authUser.id,
      'accessory',
      body.file_name,
      body.csv_text,
      {
        allow_auto_create_missing: body.allow_auto_create_missing,
        confirm_create_missing: body.confirm_create_missing,
        auto_generate_missing_codes: body.auto_generate_missing_codes,
        images_zip_object_path: body.images_zip_object_path,
      }
    );
    await request.audit('imports', 'BULK_UPLOAD_ACCESSORIES', { id: data.job_id, new: data });
    return { ok: true, data };
  });

  fastify.get('/history', async (request) => {
    const data = await listImportJobs(request.shopId, request.query || {});
    return { ok: true, ...data };
  });

  fastify.get('/:id/errors', async (request) => {
    const data = await getImportErrorExport(request.shopId, request.params.id);
    return { ok: true, data };
  });
}
