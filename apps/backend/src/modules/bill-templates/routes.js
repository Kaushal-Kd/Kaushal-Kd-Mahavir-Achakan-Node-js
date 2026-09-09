import { v4 as uuid } from 'uuid';
import { z } from 'zod';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

const PAPER_SIZES = ['A4', 'A5', 'thermal_58', 'thermal_80'];
const paperSizeSchema = z.enum(PAPER_SIZES);
const optionalJsonSchema = z.unknown().optional().nullable();
const templateWriteSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    is_default: z.boolean().optional(),
    paper_size: paperSizeSchema.optional(),
    logo_url: z.string().trim().max(500).optional().nullable(),
    logo_width: z.coerce.number().int().min(20).max(1000).optional(),
    logo_height: z.coerce.number().int().min(20).max(1000).optional(),
    logo_position: z.enum(['left', 'center', 'right']).optional(),
    header_config: optionalJsonSchema,
    bill_info_config: optionalJsonSchema,
    items_config: optionalJsonSchema,
    footer_config: optionalJsonSchema,
    typography: optionalJsonSchema,
    colors: optionalJsonSchema,
    custom_elements: optionalJsonSchema,
    page_settings: z
      .object({
        vertical_offset_in: z.coerce.number().min(-2).max(4).optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
    custom_content: z
      .object({
        enabled: z.boolean().optional(),
        text: z.string().max(50_000).optional(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough();
const createTemplateSchema = templateWriteSchema.extend({
  name: z.string().trim().min(1).max(120),
});

const JSON_FIELDS = [
  'header_config',
  'bill_info_config',
  'items_config',
  'footer_config',
  'typography',
  'page_settings',
  'colors',
  'custom_elements',
  'custom_content',
];

function parseRow(row) {
  if (!row) return row;
  for (const f of JSON_FIELDS) {
    if (row[f] && typeof row[f] === 'string') {
      try {
        row[f] = JSON.parse(row[f]);
      } catch {
        row[f] = null;
      }
    }
  }
  row.is_default = !!row.is_default;
  return row;
}

/**
 * Columns a client is allowed to write. Anything else in the body is dropped.
 * The editor round-trips the whole server row back to us, so without this the
 * ISO-string `created_at` reaches a MySQL TIMESTAMP column and the UPDATE fails.
 */
const WRITABLE_FIELDS = [
  'name',
  'is_default',
  'paper_size',
  'logo_url',
  'logo_width',
  'logo_height',
  'logo_position',
  ...JSON_FIELDS,
];

function prepareWrite(body) {
  const data = {};
  for (const f of WRITABLE_FIELDS) {
    if (body[f] === undefined) continue;
    data[f] = JSON_FIELDS.includes(f)
      ? body[f] == null
        ? null
        : JSON.stringify(body[f])
      : body[f];
  }
  return data;
}

export default async function billTemplateRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const rows = await knex('bill_templates')
      .where({ shop_id: request.shopId })
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'asc');
    return { ok: true, data: rows.map(parseRow) };
  });

  fastify.get('/:id', async (request) => {
    const row = await knex('bill_templates')
      .where({ shop_id: request.shopId, id: request.params.id })
      .first();
    if (!row) throw notFound('Template not found');
    return { ok: true, data: parseRow(row) };
  });

  fastify.post('/', async (request) => {
    const body = validate(createTemplateSchema, request.body || {});
    const id = uuid();
    const insert = {
      ...prepareWrite({
        ...body,
        paper_size: body.paper_size || 'A4',
        is_default: !!body.is_default,
      }),
      id,
      shop_id: request.shopId,
    };
    await knex.transaction(async (trx) => {
      if (insert.is_default) {
        await trx('bill_templates')
          .where({ shop_id: request.shopId })
          .update({ is_default: false });
      }
      await trx('bill_templates').insert(insert);
    });
    const row = await knex('bill_templates').where({ id }).first();
    await request.audit('bill_templates', 'CREATE', { id, new: body });
    return { ok: true, data: parseRow(row) };
  });

  fastify.put('/:id', async (request) => {
    const { id } = request.params;
    const body = validate(templateWriteSchema, request.body || {});
    const existing = await knex('bill_templates').where({ shop_id: request.shopId, id }).first();
    if (!existing) throw notFound('Template not found');
    const patch = prepareWrite(body);
    patch.updated_at = knex.fn.now();

    await knex.transaction(async (trx) => {
      if (patch.is_default) {
        await trx('bill_templates')
          .where({ shop_id: request.shopId })
          .update({ is_default: false });
      }
      await trx('bill_templates').where({ id }).update(patch);
    });
    const row = await knex('bill_templates').where({ id }).first();
    await request.audit('bill_templates', 'UPDATE', { id, new: body });
    return { ok: true, data: parseRow(row) };
  });

  fastify.post('/:id/default', async (request) => {
    const { id } = request.params;
    const existing = await knex('bill_templates').where({ shop_id: request.shopId, id }).first();
    if (!existing) throw notFound('Template not found');
    await knex.transaction(async (trx) => {
      await trx('bill_templates').where({ shop_id: request.shopId }).update({ is_default: false });
      await trx('bill_templates')
        .where({ id })
        .update({ is_default: true, updated_at: trx.fn.now() });
    });
    return { ok: true };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const { id } = request.params;
    const n = await knex('bill_templates').where({ shop_id: request.shopId, id }).del();
    if (!n) throw notFound('Template not found');
    await request.audit('bill_templates', 'DELETE', { id });
    return { ok: true };
  });
}
