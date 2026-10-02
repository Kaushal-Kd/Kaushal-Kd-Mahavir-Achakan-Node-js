import { getIndiaDateTimeParts, normalizeTime12 } from '@wrs/shared';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';

import knex from '../../db/knex.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultReminderTime() {
  const parts = getIndiaDateTimeParts(new Date());
  if (!parts) return '9:00 AM';
  return normalizeTime12(`${parts.hour}:${parts.minute}`) || '9:00 AM';
}

const reminderSchema = z
  .object({
    description: z.string().trim().min(1, 'Description is required').max(8000),
    assignee: z.string().trim().max(200).optional(),
    assignee_user_id: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : v),
      z.string().uuid().nullable().optional()
    ),
    reminder_date: z.string().trim().regex(ISO_DATE, 'Date must be YYYY-MM-DD'),
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
  })
  .superRefine((value, ctx) => {
    if (!value.assignee_user_id && !String(value.assignee || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Assignee is required',
        path: ['assignee'],
      });
    }
  });

async function findShopUser(shopId, userId) {
  if (!userId || !UUID_RE.test(String(userId))) return null;
  return knex('users as u')
    .join('users_shops as us', 'us.user_id', 'u.id')
    .where('u.id', userId)
    .andWhere('us.shop_id', shopId)
    .first('u.id', 'u.name', 'u.is_active');
}

async function resolveAssignee(shopId, body, existing = null) {
  if (body.assignee_user_id) {
    const user = await findShopUser(shopId, body.assignee_user_id);
    if (!user) throw badRequest('Assignee must be a user of this shop');
    return {
      assignee_user_id: user.id,
      assignee: String(user.name || '').trim() || String(body.assignee || '').trim() || 'User',
    };
  }
  if (body.assignee_user_id === null) {
    const name = String(body.assignee || '').trim();
    if (!name) throw badRequest('Assignee is required');
    return { assignee_user_id: null, assignee: name };
  }
  if (existing?.assignee_user_id) {
    return {
      assignee_user_id: existing.assignee_user_id,
      assignee: String(existing.assignee || body.assignee || '').trim() || 'User',
    };
  }
  const name = String(body.assignee || existing?.assignee || '').trim();
  if (!name) throw badRequest('Assignee is required');
  return { assignee_user_id: null, assignee: name };
}

function presentReminder(row) {
  if (!row) return row;
  const { assignee_user_name, ...rest } = row;
  return {
    ...rest,
    assignee: assignee_user_name || rest.assignee,
  };
}

function remindersQuery(shopId) {
  return knex('reminders as r')
    .leftJoin('users as u', 'u.id', 'r.assignee_user_id')
    .where('r.shop_id', shopId)
    .select('r.*', 'u.name as assignee_user_name');
}

export default async function reminderRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/assignees', async (request) => {
    const rows = await knex('users as u')
      .join('users_shops as us', 'us.user_id', 'u.id')
      .where('us.shop_id', request.shopId)
      .andWhere('u.is_active', true)
      .whereNot('u.role', 'super_admin')
      .orderBy('u.name', 'asc')
      .select('u.id', 'u.name', 'u.role');
    return { ok: true, data: rows };
  });

  fastify.get('/', async (request) => {
    const rows = await remindersQuery(request.shopId)
      .orderBy('r.is_completed', 'asc')
      .orderBy('r.reminder_date', 'asc')
      .orderBy('r.reminder_time', 'asc')
      .orderBy('r.created_at', 'desc');
    return { ok: true, data: rows.map(presentReminder) };
  });

  fastify.post('/', async (request) => {
    const body = validate(reminderSchema, request.body || {});
    const assignee = await resolveAssignee(request.shopId, body);
    const id = uuid();
    await knex('reminders').insert({
      id,
      shop_id: request.shopId,
      description: body.description,
      assignee: assignee.assignee,
      assignee_user_id: assignee.assignee_user_id,
      reminder_date: body.reminder_date,
      reminder_time: body.reminder_time,
      is_completed: Boolean(body.is_completed),
      completed_at: body.is_completed ? knex.fn.now() : null,
    });
    const row = await remindersQuery(request.shopId).where('r.id', id).first();
    await request.audit('reminders', 'CREATE', { id, new: presentReminder(row) });
    return { ok: true, data: presentReminder(row) };
  });

  fastify.put('/:id', async (request) => {
    const body = validate(reminderSchema, request.body || {});
    const row = await knex('reminders')
      .where({ id: request.params.id, shop_id: request.shopId })
      .first();
    if (!row) throw notFound('Reminder not found');
    const assignee = await resolveAssignee(request.shopId, body, row);
    const patch = {
      description: body.description,
      assignee: assignee.assignee,
      assignee_user_id: assignee.assignee_user_id,
      reminder_date: body.reminder_date,
      reminder_time: body.reminder_time,
      ...(body.is_completed === true
        ? { is_completed: true, completed_at: knex.fn.now() }
        : body.is_completed === false
          ? { is_completed: false, completed_at: null }
          : {}),
      updated_at: knex.fn.now(),
    };
    await knex('reminders').where({ id: row.id }).update(patch);
    const after = await remindersQuery(request.shopId).where('r.id', row.id).first();
    await request.audit('reminders', 'UPDATE', {
      id: row.id,
      old: row,
      new: presentReminder(after),
    });
    return { ok: true, data: presentReminder(after) };
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
