import { getIndiaDateTimeParts, normalizeTime12 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';

import knex from '../../db/knex.js';
import { notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function defaultReminderTime() {
  const parts = getIndiaDateTimeParts(new Date());
  if (!parts) return '9:00 AM';
  return normalizeTime12(`${parts.hour}:${parts.minute}`) || '9:00 AM';
}

const reminderSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(8000),
  assignee: z.string().trim().min(1, 'Assignee is required').max(200),
  reminder_date: z
    .string()
    .trim()
    .regex(ISO_DATE, 'Date must be YYYY-MM-DD'),
  reminder_time: z.preprocess(
    (v) => {
      if (v === '' || v === undefined || v === null) return defaultReminderTime();
      const normalized = normalizeTime12(String(v));
      if (!normalized) return defaultReminderTime();
      return normalized;
    },
    z.string().max(20)
  ),
  is_completed: z.boolean().optional(),
});

export default async function reminderRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/', async (request) => {
    const rows = await knex('reminders')
      .where({ shop_id: request.shopId })
      .orderBy('is_completed', 'asc')
      .orderBy('reminder_date', 'asc')
      .orderBy('reminder_time', 'asc')
      .orderBy('created_at', 'desc');
    return { ok: true, data: rows };
  });

  fastify.post('/', async (request) => {
    const body = validate(reminderSchema, request.body || {});
    const id = uuid();
    await knex('reminders').insert({
      id,
      shop_id: request.shopId,
      description: body.description,
      assignee: body.assignee,
      reminder_date: body.reminder_date,
      reminder_time: body.reminder_time,
      is_completed: Boolean(body.is_completed),
      completed_at: body.is_completed ? knex.fn.now() : null,
    });
    const row = await knex('reminders').where({ id }).first();
    await request.audit('reminders', 'CREATE', { id, new: row });
    return { ok: true, data: row };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(reminderSchema, request.body || {});
    const row = await knex('reminders')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Reminder not found');
    const patch = {
      ...body,
      ...(body.is_completed === true
        ? { completed_at: knex.fn.now() }
        : body.is_completed === false
          ? { completed_at: null }
          : {}),
      updated_at: knex.fn.now(),
    };
    await knex('reminders').where({ id: row.id }).update(patch);
    const after = await knex('reminders').where({ id: row.id }).first();
    await request.audit('reminders', 'UPDATE', { id: row.id, old: row, new: after });
    return { ok: true, data: after };
  });

  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    const row = await knex('reminders')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Reminder not found');
    await knex('reminders').where({ id: row.id }).del();
    await request.audit('reminders', 'DELETE', { id: row.id, old: row });
    return { ok: true };
  });
}
