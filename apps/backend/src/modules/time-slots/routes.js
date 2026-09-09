import { normalizeTime12, TIME_12H_REGEX } from '@wrs/shared';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';

import knex from '../../db/knex.js';
import { getTimeSlotDefaultsForShop, setTimeSlotDefaultsForShop } from '../../lib/timeSlotDefaults.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

const slotBodySchema = z.object({
  time_value: z
    .string()
    .trim()
    .transform((v) => normalizeTime12(v))
    .refine((v) => v != null && TIME_12H_REGEX.test(v), 'Time must be h:mm AM/PM'),
  sort_order: z.coerce.number().int().nonnegative().default(0),
});

const defaultsBodySchema = z.object({
  default_delivery_slot_id: z.string().uuid().nullable().optional(),
  default_return_slot_id: z.string().uuid().nullable().optional(),
});

async function assertUniqueActiveTime(shopId, timeValue, excludeId) {
  const q = knex('time_slots').where({
    shop_id: shopId,
    is_active: true,
    time_value: timeValue,
  });
  if (excludeId) q.whereNot('id', excludeId);
  const row = await q.first();
  if (row) throw badRequest('Another active slot already uses this time');
}

export default async function timeSlotRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const rows = await knex('time_slots')
      .where({ shop_id: request.shopId, is_active: true })
      .orderBy('sort_order', 'asc')
      .orderBy('time_value', 'asc');
    const defaults = await getTimeSlotDefaultsForShop(knex, request.shopId);
    return { ok: true, data: rows, defaults };
  });

  fastify.get('/defaults', async (request) => {
    const defaults = await getTimeSlotDefaultsForShop(knex, request.shopId);
    return { ok: true, data: defaults };
  });

  fastify.put('/defaults', async (request) => {
    const body = validate(defaultsBodySchema, request.body || {});
    const defaults = await setTimeSlotDefaultsForShop(knex, request.shopId, {
      default_delivery_slot_id: body.default_delivery_slot_id ?? null,
      default_return_slot_id: body.default_return_slot_id ?? null,
    });
    await request.audit('time_slots', 'UPDATE', {
      id: 'defaults',
      new: defaults,
    });
    return { ok: true, data: defaults };
  });

  fastify.post('/', async (request) => {
    const body = validate(slotBodySchema, request.body || {});
    await assertUniqueActiveTime(request.shopId, body.time_value, null);
    const id = uuid();
    await knex('time_slots').insert({
      id,
      shop_id: request.shopId,
      time_value: body.time_value,
      sort_order: body.sort_order,
      is_active: true,
      is_default_delivery: false,
      is_default_return: false,
    });
    const row = await knex('time_slots').where({ id }).first();
    await request.audit('time_slots', 'CREATE', { id, new: row });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(slotBodySchema.partial(), request.body || {});
    const row = await knex('time_slots')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Time slot not found');
    if (row.is_active === false) throw badRequest('Cannot update a removed time slot');

    if (body.time_value !== undefined && body.time_value !== row.time_value) {
      await assertUniqueActiveTime(request.shopId, body.time_value, row.id);
    }

    const patch = {
      ...(body.time_value !== undefined ? { time_value: body.time_value } : {}),
      ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      updated_at: knex.fn.now(),
    };
    await knex('time_slots').where({ id: row.id }).update(patch);
    const after = await knex('time_slots').where({ id: row.id }).first();
    await request.audit('time_slots', 'UPDATE', { id: row.id, old: row, new: after });
    return { ok: true, data: after };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const row = await knex('time_slots')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Time slot not found');
    await knex('time_slots').where({ id: row.id }).update({
      is_active: false,
      is_default_delivery: false,
      is_default_return: false,
      updated_at: knex.fn.now(),
    });
    await request.audit('time_slots', 'DELETE', { id: row.id });
    return { ok: true };
  });
}
