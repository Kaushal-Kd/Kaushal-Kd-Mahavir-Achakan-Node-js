import {
  bulkDeactivateProductsSchema,
  catalogDeleteSchema,
  createProductSchema,
  productCodeNumberTakenQuerySchema,
  productRentalHistoryQuerySchema,
  productSaleHistoryQuerySchema,
  updateProductAccessoryMappingSchema,
  updateProductRelatedMappingSchema,
  updateProductSchema,
} from '@wrs/shared';
import { z } from 'zod';

import { validate } from '../../utils/validate.js';

import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeactivateProducts,
  bulkActivateProducts,
  getProductCodeFormat,
  updateProductCodeFormat,
  generateNextProductCode,
  getLastProductCodeForCategory,
  getProductCategoryCounts,
  checkProductAvailability,
  checkProductCodeNumberTaken,
  checkProductSellAvailability,
  listProductAvailability,
  listProductRentalHistory,
  listProductSaleHistory,
  searchBookingAvailability,
  listPendingWashing,
  listInventorySnapshot,
  getProductAccessoryMapping,
  updateProductAccessoryMapping,
  getProductRelatedMapping,
  updateProductRelatedMapping,
  listRelatedProductsForBooking,
  exportProducts,
} from './service.js';

const codeFormatSchema = z.object({
  default_prefix: z.string().trim().max(40).default(''),
  padding: z.coerce.number().int().min(1).max(10).default(4),
  by_category: z.record(z.string().uuid(), z.string().trim().max(40)).default({}),
});

export default async function productRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const result = await listProducts(request.shopId, request.query);
    return { ok: true, ...result };
  });

  fastify.get('/code-format', async (request) => {
    const data = await getProductCodeFormat(request.shopId);
    return { ok: true, data };
  });

  fastify.put('/code-format', async (request) => {
    const body = validate(codeFormatSchema, request.body || {});
    const data = await updateProductCodeFormat(request.shopId, body);
    await request.audit('settings', 'UPDATE', {
      id: 'config.product_code',
      new: data,
    });
    return { ok: true, data };
  });

  fastify.get('/next-code', async (request) => {
    const categoryId = request.query.category_id || null;
    const size = request.query.size != null ? String(request.query.size) : '';
    const data = await generateNextProductCode(request.shopId, categoryId, size);
    return { ok: true, data };
  });

  fastify.get('/last-code', async (request) => {
    const categoryId = request.query.category_id || null;
    const data = await getLastProductCodeForCategory(request.shopId, categoryId);
    return { ok: true, data };
  });

  fastify.get('/code-number-taken', async (request) => {
    const query = validate(productCodeNumberTakenQuerySchema, request.query || {});
    const data = await checkProductCodeNumberTaken(request.shopId, {
      categoryId: query.category_id || null,
      number: query.number,
      excludeProductId: query.exclude_id || null,
      size: query.size ?? '',
    });
    return { ok: true, data };
  });

  fastify.get('/category-counts', async (request) => {
    const data = await getProductCategoryCounts(request.shopId);
    return { ok: true, data };
  });

  fastify.get('/availability', async (request) => {
    const data = await checkProductAvailability(request.shopId, request.query || {});
    return { ok: true, data };
  });

  fastify.get('/sell-availability', async (request) => {
    const data = await checkProductSellAvailability(request.shopId, request.query || {});
    return { ok: true, data };
  });

  fastify.get('/availability-list', async (request) => {
    const result = await listProductAvailability(request.shopId, request.query || {});
    return { ok: true, ...result };
  });

  fastify.get('/booking-availability', async (request) => {
    const data = await searchBookingAvailability(request.shopId, request.query || {});
    return { ok: true, data };
  });

  fastify.get('/pending-washing', async (request) => {
    const data = await listPendingWashing(request.shopId);
    return { ok: true, data };
  });

  fastify.get('/inventory', async (request) => {
    const result = await listInventorySnapshot(request.shopId, request.query || {});
    return { ok: true, ...result };
  });

  fastify.get('/export', async (request) => {
    const data = await exportProducts(request.shopId, request.query || {});
    return { ok: true, data };
  });

  fastify.post(
    '/bulk-deactivate',
    { preHandler: fastify.requireShopAdminPassword },
    async (request) => {
      const body = validate(bulkDeactivateProductsSchema, request.body || {});
      const { deactivated, skipped_blocked, blocked, products } = await bulkDeactivateProducts(
        request.shopId,
        body.ids
      );
      for (const before of products) {
        await request.audit('products', 'DELETE', { id: before.id, old: before });
      }
      return { ok: true, data: { deactivated, skipped_blocked, blocked } };
    }
  );

  fastify.post(
    '/bulk-activate',
    { preHandler: fastify.requireShopAdminPassword },
    async (request) => {
      const body = validate(bulkDeactivateProductsSchema, request.body || {});
      const { activated, products } = await bulkActivateProducts(request.shopId, body.ids);
      for (const before of products) {
        const after = { ...before, is_active: true };
        await request.audit('products', 'UPDATE', { id: before.id, old: before, new: after });
      }
      return { ok: true, data: { activated } };
    }
  );

  fastify.get('/:id/rental-history', async (request) => {
    const query = validate(productRentalHistoryQuerySchema, request.query || {});
    const rows = await listProductRentalHistory(request.shopId, request.params.id, query);
    return { ok: true, data: { rows } };
  });

  fastify.get('/:id/sale-history', async (request) => {
    const query = validate(productSaleHistoryQuerySchema, request.query || {});
    const rows = await listProductSaleHistory(request.shopId, request.params.id, query);
    return { ok: true, data: { rows } };
  });

  fastify.get('/:id/accessory-mapping', async (request) => {
    const data = await getProductAccessoryMapping(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.put('/:id/accessory-mapping', async (request) => {
    const body = validate(updateProductAccessoryMappingSchema, request.body || {});
    const data = await updateProductAccessoryMapping(request.shopId, request.params.id, body);
    await request.audit('products', 'UPDATE', {
      id: request.params.id,
      new: { accessory_mapping: data },
    });
    return { ok: true, data };
  });

  fastify.get('/:id/related-products', async (request) => {
    const forBooking = String(request.query?.for_booking || '') === '1';
    if (forBooking) {
      const products = await listRelatedProductsForBooking(request.shopId, request.params.id);
      return { ok: true, data: { product_id: request.params.id, products } };
    }
    const data = await getProductRelatedMapping(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.put('/:id/related-products', async (request) => {
    const body = validate(updateProductRelatedMappingSchema, request.body || {});
    const data = await updateProductRelatedMapping(request.shopId, request.params.id, body);
    await request.audit('products', 'UPDATE', {
      id: request.params.id,
      new: { related_products: data },
    });
    return { ok: true, data };
  });

  fastify.get('/:id', async (request) => {
    const data = await getProduct(request.shopId, request.params.id);
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = validate(createProductSchema, { ...request.body, shop_id: request.shopId });
    const data = await createProduct(request.shopId, body);
    await request.audit('products', 'CREATE', { id: data.id, new: data });
    return { ok: true, data };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(updateProductSchema, {
      ...request.body,
      id: request.params.id,
      shop_id: request.shopId,
    });
    const { before, after } = await updateProduct(request.shopId, request.params.id, body);
    await request.audit('products', 'UPDATE', { id: after.id, old: before, new: after });
    return { ok: true, data: after };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const intent = validate(catalogDeleteSchema, request.body || {});
    const { before, mode } = await deleteProduct(request.shopId, request.params.id, intent.mode);
    await request.audit('products', mode === 'deactivated' ? 'DELETE' : 'DELETE_PERMANENT', { id: before.id, old: before });
    return { ok: true, data: { mode } };
  });
}
