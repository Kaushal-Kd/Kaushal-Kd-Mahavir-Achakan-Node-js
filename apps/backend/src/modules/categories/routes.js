import { v4 as uuid } from 'uuid';
import { z } from 'zod';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

const schema = z.object({
  label: z.string().trim().min(1).max(120),
  category_type: z.enum(['product', 'accessory']).default('product'),
  sort_order: z.coerce.number().int().nonnegative().default(0),
  is_active: z.boolean().optional().default(true),
  is_washable: z.boolean().optional().default(false),
  dc_price: z.coerce.number().min(0).optional().default(0),
});
const mappingSchema = z.object({
  accessory_category_ids: z.array(z.string().uuid()).max(200).default([]),
});

export default async function categoryRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const type = request.query?.type;
    const qb = knex('categories').where({ shop_id: request.shopId, is_active: true });
    if (type === 'product' || type === 'accessory') {
      qb.andWhere({ category_type: type });
    }
    const rows =
      type === 'accessory'
        ? await qb.orderBy('label')
        : await qb.orderBy('sort_order').orderBy('label');
    if (type === 'product' && rows.length > 0) {
      const productIds = rows.map((r) => r.id);
      const mappingRows = await knex('product_category_accessory_categories as pca')
        .join('categories as ac', 'ac.id', 'pca.accessory_category_id')
        .whereIn('pca.product_category_id', productIds)
        .andWhere('ac.shop_id', request.shopId)
        .andWhere('ac.is_active', true)
        .andWhere('ac.category_type', 'accessory')
        .select(
          'pca.product_category_id',
          'pca.accessory_category_id',
          'pca.display_order',
          'ac.label as accessory_category_label'
        )
        .orderBy('pca.display_order')
        .orderBy('ac.sort_order')
        .orderBy('ac.label');
      const grouped = new Map();
      for (const row of mappingRows) {
        if (!grouped.has(row.product_category_id)) grouped.set(row.product_category_id, []);
        grouped.get(row.product_category_id).push({
          id: row.accessory_category_id,
          label: row.accessory_category_label,
          display_order: Number(row.display_order || 0),
        });
      }
      rows.forEach((row) => {
        const mapped = grouped.get(row.id) || [];
        row.accessory_category_ids = mapped.map((m) => m.id);
        row.accessory_categories = mapped;
      });
    }
    return { ok: true, data: rows };
  });

  fastify.get('/:id/accessory-categories', async (request) => {
    const category = await knex('categories')
      .where({
        id: request.params.id,
        shop_id: request.shopId,
        is_active: true,
      })
      .first();
    if (!category) throw notFound('Category not found');
    if (category.category_type !== 'product') {
      return {
        ok: true,
        data: { category_id: category.id, accessory_category_ids: [], accessory_categories: [] },
      };
    }

    const rows = await knex('product_category_accessory_categories as pca')
      .join('categories as ac', 'ac.id', 'pca.accessory_category_id')
      .where('pca.product_category_id', category.id)
      .andWhere('ac.shop_id', request.shopId)
      .andWhere('ac.is_active', true)
      .andWhere('ac.category_type', 'accessory')
      .select('ac.id', 'ac.label', 'pca.display_order')
      .orderBy('pca.display_order')
      .orderBy('ac.sort_order')
      .orderBy('ac.label');
    return {
      ok: true,
      data: {
        category_id: category.id,
        accessory_category_ids: rows.map((r) => r.id),
        accessory_categories: rows.map((r) => ({
          id: r.id,
          label: r.label,
          display_order: Number(r.display_order || 0),
        })),
      },
    };
  });

  fastify.put('/:id/accessory-categories', async (request) => {
    const body = validate(mappingSchema, request.body || {});
    const category = await knex('categories')
      .where({
        id: request.params.id,
        shop_id: request.shopId,
        is_active: true,
      })
      .first();
    if (!category) throw notFound('Category not found');
    if (category.category_type !== 'product') {
      return {
        ok: true,
        data: { category_id: category.id, accessory_category_ids: [], accessory_categories: [] },
      };
    }

    const ids = [...new Set(body.accessory_category_ids || [])];
    if (ids.length > 0) {
      const valid = await knex('categories')
        .where({
          shop_id: request.shopId,
          is_active: true,
          category_type: 'accessory',
        })
        .whereIn('id', ids)
        .pluck('id');
      if (valid.length !== ids.length) {
        throw notFound('One or more accessory categories are invalid');
      }
    }

    await knex.transaction(async (trx) => {
      await trx('product_category_accessory_categories')
        .where({ product_category_id: category.id })
        .del();
      if (ids.length > 0) {
        await trx('product_category_accessory_categories').insert(
          ids.map((accessory_category_id, index) => ({
            product_category_id: category.id,
            accessory_category_id,
            display_order: index,
          }))
        );
      }
    });

    const afterRows = await knex('product_category_accessory_categories as pca')
      .join('categories as ac', 'ac.id', 'pca.accessory_category_id')
      .where('pca.product_category_id', category.id)
      .andWhere('ac.shop_id', request.shopId)
      .andWhere('ac.is_active', true)
      .andWhere('ac.category_type', 'accessory')
      .select('ac.id', 'ac.label', 'pca.display_order')
      .orderBy('pca.display_order')
      .orderBy('ac.sort_order')
      .orderBy('ac.label');
    const data = {
      category_id: category.id,
      accessory_category_ids: afterRows.map((r) => r.id),
      accessory_categories: afterRows.map((r) => ({
        id: r.id,
        label: r.label,
        display_order: Number(r.display_order || 0),
      })),
    };
    await request.audit('categories', 'UPDATE', {
      id: category.id,
      new: { accessory_category_ids: data.accessory_category_ids },
    });
    return { ok: true, data };
  });

  fastify.post('/', async (request) => {
    const body = validate(schema, request.body || {});
    const id = uuid();
    await knex('categories').insert({ ...body, id, shop_id: request.shopId });
    const row = await knex('categories').where({ id }).first();
    await request.audit('categories', 'CREATE', { id, new: row });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(schema.partial(), request.body || {});
    const row = await knex('categories')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Category not found');
    const after = await knex.transaction(async (trx) => {
      await trx('categories')
        .where({ id: row.id })
        .update({ ...body });
      if (row.category_type === 'accessory' && body.is_washable === false) {
        await trx('washing_queue')
          .where({ shop_id: request.shopId, category_id: row.id, item_kind: 'accessory' })
          .del();
      }
      return trx('categories').where({ id: row.id }).first();
    });
    await request.audit('categories', 'UPDATE', { id: row.id, old: row, new: after });
    return { ok: true, data: after };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    await knex('categories')
      .where({ id: request.params.id, shop_id: request.shopId })
      .update({ is_active: false });
    return { ok: true };
  });
}
