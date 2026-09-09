import {
  APP_SETTINGS_KEYS,
  APP_SETTINGS_REGISTRY,
  WHATSAPP_MESSAGE_REGISTRY,
  WHATSAPP_MESSAGE_SETTING_KEYS,
  WHATSAPP_TEMPLATE_VARIABLES,
  buildOrderNumber,
  buildWhatsAppTemplatesFromStored,
  billNumberingUpdateSchema,
  defaultWhatsAppTemplatePayload,
  formatWhatsAppTemplateValue,
  getAppSettingValue,
  laundryPrioritySettingsSchema,
  normalizeLaundryPrioritySettings,
  normalizeOrderNumberFormat,
  normalizeOrderNumberPrefix,
  todayIndiaISODate,
  parseYesNo,
  validateAppSettingValue,
  whatsappMessageSettingKey,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';

import { invalidateDashboardDaySettingsCache } from '../dashboard/dashboardSettings.js';
import knex from '../../db/knex.js';
import { badRequest } from '../../utils/errors.js';
import { validate } from '../../utils/validate.js';

/**
 * Shop-level configuration lists.
 *
 * Stores shop-specific overrides for the simple lookup lists
 * (colors, sizes, units, tailors) in the existing `settings` table under
 * the keys below. Every shop starts with an empty list and the
 * admin configures their own values from the Configuration page.
 *
 * Categories are already per-shop (see `modules/categories`) and
 * are not managed here.
 */
const TYPES = {
  colors: { key: 'config.colors' },
  sizes: { key: 'config.sizes' },
  units: { key: 'config.units' },
  tailors: { key: 'config.tailors' },
};
const LAUNDRY_PRIORITY_KEY = 'config.laundry_priority';

const simpleListSchema = z
  .array(z.string().trim().min(1, 'Value cannot be empty').max(80))
  .max(200, 'Maximum 200 items allowed');

function getItemsSchema() {
  return simpleListSchema;
}

function loadStored(row) {
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveType(type) {
  const def = TYPES[type];
  if (!def) throw badRequest(`Unknown configuration type: ${type}`);
  return def;
}

async function upsertSetting(shopId, key, value) {
  const existing = await knex('settings').where({ shop_id: shopId, key }).first();
  const payload = { value: String(value), updated_at: knex.fn.now() };
  if (existing) {
    await knex('settings').where({ id: existing.id }).update(payload);
  } else {
    await knex('settings').insert({
      id: uuid(),
      shop_id: shopId,
      key,
      ...payload,
    });
  }
}

async function loadAppSettingsRows(shopId) {
  const rows = await knex('settings')
    .where({ shop_id: shopId })
    .whereIn('key', APP_SETTINGS_KEYS);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function seedMissingAppSettings(shopId) {
  const byKey = await loadAppSettingsRows(shopId);
  for (const def of APP_SETTINGS_REGISTRY) {
    if (byKey[def.key] == null) {
      await upsertSetting(shopId, def.key, def.defaultValue);
      byKey[def.key] = def.defaultValue;
    }
  }
  return byKey;
}

export default async function configurationRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  // GET /api/configurations → all lists in one go (used by the
  // settings UI + any other page that needs every list at once).
  fastify.get('/', async (request) => {
    const rows = await knex('settings')
      .where({ shop_id: request.shopId })
      .whereIn(
        'key',
        Object.values(TYPES).map((t) => t.key)
      );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    const data = {};
    for (const [type, def] of Object.entries(TYPES)) {
      const stored = loadStored(byKey[def.key]);
      data[type] = {
        items: stored ?? [],
        is_custom: !!stored,
      };
    }
    return { ok: true, data };
  });

  fastify.get('/app-settings', async (request) => {
    const byKey = await seedMissingAppSettings(request.shopId);
    const items = APP_SETTINGS_REGISTRY.map((def) => ({
      key: def.key,
      name: def.name,
      type: def.type,
      group: def.group || null,
      value: getAppSettingValue(byKey, def.key),
      options: def.options || [],
    }));
    return { ok: true, data: { items } };
  });

  const appSettingPutSchema = z.object({
    value: z.union([z.string(), z.number(), z.boolean()]),
  });

  fastify.put('/app-settings/:key', async (request) => {
    const key = String(request.params.key || '').trim();
    const def = APP_SETTINGS_REGISTRY.find((r) => r.key === key);
    if (!def) throw badRequest(`Unknown app setting: ${key}`);
    const body = validate(appSettingPutSchema, request.body || {});
    const checked = validateAppSettingValue(key, body.value);
    if (!checked.ok) throw badRequest(checked.error);
    await upsertSetting(request.shopId, key, checked.value);
    if (key.startsWith('DASHBOARD_')) {
      invalidateDashboardDaySettingsCache(request.shopId);
    }
    await request.audit('settings', 'UPDATE', { id: key, new: { value: checked.value } });
    return {
      ok: true,
      data: {
        key,
        name: def.name,
        type: def.type,
        value: checked.value,
      },
    };
  });

  async function loadWhatsAppMessageRows(shopId) {
    const rows = await knex('settings')
      .where({ shop_id: shopId })
      .whereIn('key', WHATSAPP_MESSAGE_SETTING_KEYS);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async function seedMissingWhatsAppMessages(shopId) {
    const byKey = await loadWhatsAppMessageRows(shopId);
    for (const def of WHATSAPP_MESSAGE_REGISTRY) {
      const settingKey = whatsappMessageSettingKey(def.key);
      if (byKey[settingKey] == null) {
        const value = defaultWhatsAppTemplatePayload(def);
        await upsertSetting(shopId, settingKey, value);
        byKey[settingKey] = value;
      }
    }
    return byKey;
  }

  fastify.get('/whatsapp-messages', async (request) => {
    const byKey = await seedMissingWhatsAppMessages(request.shopId);
    const templates = buildWhatsAppTemplatesFromStored(byKey);
    return {
      ok: true,
      data: {
        variables: [...WHATSAPP_TEMPLATE_VARIABLES],
        templates,
      },
    };
  });

  const whatsappMessagesPutSchema = z.object({
    templates: z
      .array(
        z.object({
          key: z.string().trim(),
          is_active: z.union([z.boolean(), z.string()]),
          message: z.string().max(4000),
          attach_bill_pdf: z.union([z.boolean(), z.string()]).optional(),
        })
      )
      .min(1)
      .max(20)
      .optional(),
  });

  fastify.put('/whatsapp-messages', async (request) => {
    const body = validate(whatsappMessagesPutSchema, request.body || {});
    if (body.templates?.length) {
      const allowed = new Set(WHATSAPP_MESSAGE_REGISTRY.map((r) => r.key));
      for (const row of body.templates) {
        if (!allowed.has(row.key)) throw badRequest(`Unknown WhatsApp template: ${row.key}`);
        const value = formatWhatsAppTemplateValue({
          is_active: parseYesNo(row.is_active, 'Yes'),
          message: row.message,
          attach_bill_pdf: parseYesNo(row.attach_bill_pdf, 'No'),
        });
        await upsertSetting(request.shopId, whatsappMessageSettingKey(row.key), value);
      }
    }
    const byKey = await loadWhatsAppMessageRows(request.shopId);
    const templates = buildWhatsAppTemplatesFromStored(byKey);
    await request.audit('settings', 'UPDATE', {
      id: 'whatsapp.messages',
      new: { keys: body.templates?.map((t) => t.key) || [] },
    });
    return {
      ok: true,
      data: {
        variables: [...WHATSAPP_TEMPLATE_VARIABLES],
        templates,
      },
    };
  });

  fastify.get('/laundry-priority', async (request) => {
    const row = await knex('settings').where({ shop_id: request.shopId, key: LAUNDRY_PRIORITY_KEY }).first();
    let raw = null;
    if (row?.value) {
      try {
        raw = JSON.parse(row.value);
      } catch {
        raw = null;
      }
    }
    return {
      ok: true,
      data: {
        ...normalizeLaundryPrioritySettings(raw),
        is_custom: !!row,
      },
    };
  });

  fastify.put('/laundry-priority', async (request) => {
    const body = validate(laundryPrioritySettingsSchema, request.body || {});
    const settings = normalizeLaundryPrioritySettings(body);
    const existing = await knex('settings').where({ shop_id: request.shopId, key: LAUNDRY_PRIORITY_KEY }).first();
    const payload = {
      value: JSON.stringify(settings),
      updated_at: knex.fn.now(),
    };
    if (existing) {
      await knex('settings').where({ id: existing.id }).update(payload);
    } else {
      await knex('settings').insert({
        id: uuid(),
        shop_id: request.shopId,
        key: LAUNDRY_PRIORITY_KEY,
        ...payload,
      });
    }
    await request.audit('settings', 'UPDATE', {
      id: LAUNDRY_PRIORITY_KEY,
      new: settings,
    });
    return {
      ok: true,
      data: {
        ...settings,
        is_custom: true,
      },
    };
  });

  fastify.get('/bill-numbering', async (request) => {
    const row = await knex('shops')
      .where({ id: request.shopId })
      .select('order_number_prefix', 'order_number_format')
      .first();
    const normalized = normalizeOrderNumberPrefix(row?.order_number_prefix);
    const effectivePrefix = normalized ?? 'O';
    const effectiveFormat = normalizeOrderNumberFormat(row?.order_number_format);
    const preview = buildOrderNumber({
      format: effectiveFormat,
      prefix: effectivePrefix,
      sequence: 1,
      previewDate: todayIndiaISODate(),
    });
    return {
      ok: true,
      data: {
        order_number_prefix: normalized,
        order_number_format: effectiveFormat,
        effective_prefix: effectivePrefix,
        effective_format: effectiveFormat,
        preview_sample: preview,
      },
    };
  });

  fastify.put('/bill-numbering', async (request) => {
    const body = validate(billNumberingUpdateSchema, request.body || {});
    const normalized = normalizeOrderNumberPrefix(body.order_number_prefix ?? '');
    const normalizedFormat = normalizeOrderNumberFormat(body.order_number_format);
    await knex('shops')
      .where({ id: request.shopId })
      .update({
        order_number_prefix: normalized,
        order_number_format: normalizedFormat,
        updated_at: knex.fn.now(),
      });
    const effectivePrefix = normalized ?? 'O';
    const preview = buildOrderNumber({
      format: normalizedFormat,
      prefix: effectivePrefix,
      sequence: 1,
      previewDate: todayIndiaISODate(),
    });
    await request.audit('shops', 'UPDATE', {
      id: request.shopId,
      new: { order_number_prefix: normalized, order_number_format: normalizedFormat },
      scope: 'bill_numbering',
    });
    return {
      ok: true,
      data: {
        order_number_prefix: normalized,
        order_number_format: normalizedFormat,
        effective_prefix: effectivePrefix,
        effective_format: normalizedFormat,
        preview_sample: preview,
      },
    };
  });

  fastify.get('/:type', async (request) => {
    const def = resolveType(request.params.type);
    const row = await knex('settings')
      .where({ shop_id: request.shopId, key: def.key })
      .first();
    const stored = loadStored(row);
    return {
      ok: true,
      data: {
        items: stored ?? [],
        is_custom: !!stored,
      },
    };
  });

  fastify.put('/:type', async (request) => {
    const type = request.params.type;
    const def = resolveType(type);
    const body = validate(
      z.object({
        items: getItemsSchema(),
      }),
      request.body || {}
    );

    let items = [];
    // de-dupe (case-insensitive) while keeping the user's casing / order
    const seen = new Set();
    for (const raw of body.items) {
      const v = String(raw).trim();
      const k = v.toLowerCase();
      if (!v || seen.has(k)) continue;
      seen.add(k);
      items.push(v);
    }

    const existing = await knex('settings')
      .where({ shop_id: request.shopId, key: def.key })
      .first();
    const payload = { value: JSON.stringify(items), updated_at: knex.fn.now() };
    if (existing) {
      await knex('settings').where({ id: existing.id }).update(payload);
    } else {
      await knex('settings').insert({
        id: uuid(),
        shop_id: request.shopId,
        key: def.key,
        ...payload,
      });
    }
    await request.audit('settings', 'UPDATE', {
      id: def.key,
      new: { items },
    });
    return { ok: true, data: { items, is_custom: true } };
  });

  fastify.post('/:type/reset', async (request) => {
    const def = resolveType(request.params.type);
    await knex('settings').where({ shop_id: request.shopId, key: def.key }).del();
    await request.audit('settings', 'DELETE', { id: def.key });
    return {
      ok: true,
      data: { items: [], is_custom: false },
    };
  });
}
