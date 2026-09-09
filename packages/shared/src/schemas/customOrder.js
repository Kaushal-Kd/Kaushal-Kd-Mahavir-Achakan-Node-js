import { z } from 'zod';

import { normalizeTime12, TIME_12H_REGEX, toLocalISODate } from '../utils/date.js';
import { normalizeProductCode, normalizeProductName } from '../utils/productCodeFormat.js';
import { REGEX } from '../utils/validators.js';

const emptyQueryToUndef = (v) => (v === '' || v === undefined || v === null ? undefined : v);

const optionalSqlDate = z.preprocess((val) => {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  const s = String(val).trim();
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return ymd;
}, z.union([z.string().date(), z.null()]).optional());

const orderTimeSchema = z.preprocess(
  (value) => normalizeTime12(value),
  z
    .string()
    .regex(TIME_12H_REGEX, 'Invalid time (use h:mm AM/PM)')
    .nullable()
    .optional()
);

const optionalIndianPhone = z.union([
  z.null(),
  z.literal(''),
  z.string().trim().regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number'),
]);

const imageUrlSchema = z.string().trim().max(500);
const imagesArraySchema = z.array(imageUrlSchema).max(20).default([]);

export const CUSTOM_ORDER_FIELD_TYPES = ['number', 'text'];

export const CUSTOM_ORDER_STATUS = Object.freeze({
  DRAFT: 'draft',
  IN_PROGRESS: 'in_progress',
  WITH_TAILOR: 'with_tailor',
  TRIAL: 'trial',
  RETRIAL: 'retrial',
  COMPLETED: 'completed',
});

/** Set via cancel action only — not a workflow step in status dropdowns. */
export const CUSTOM_ORDER_CANCELLED_STATUS = 'cancelled';

export const CUSTOM_ORDER_STATUS_VALUES = Object.values(CUSTOM_ORDER_STATUS);

/** Workflow statuses for dropdowns — excludes legacy `draft`. */
export const CUSTOM_ORDER_SELECTABLE_STATUS_VALUES = CUSTOM_ORDER_STATUS_VALUES.filter(
  (v) => v !== CUSTOM_ORDER_STATUS.DRAFT
);

export const CUSTOM_ORDER_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  in_progress: 'In progress',
  with_tailor: 'With tailor',
  trial: 'Product OK (Trial Pending)',
  retrial: 'Re-tailor',
  completed: 'Completed',
  cancelled: 'Cancelled',
});

export const customOrderStatusSchema = z.enum([
  ...CUSTOM_ORDER_STATUS_VALUES,
  CUSTOM_ORDER_CANCELLED_STATUS,
]);

export const customOrderFieldDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(120),
  field_type: z.enum(['number', 'text']).default('number'),
  unit: z.string().trim().max(32).optional().nullable(),
  required: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().nonnegative().default(0),
  is_active: z.coerce.boolean().default(true),
});

export const createCustomOrderFieldDefinitionSchema = customOrderFieldDefinitionSchema.omit({
  id: true,
  shop_id: true,
});

export const updateCustomOrderFieldDefinitionSchema = customOrderFieldDefinitionSchema
  .partial()
  .extend({ id: z.string().uuid() });

export const reorderCustomOrderFieldDefinitionsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1).max(200),
});

const measurementsSchema = z.record(z.string(), z.union([z.string(), z.number()])).default({});

const retrialEntrySchema = z.object({
  date: optionalSqlDate,
  notes: z.string().trim().max(500).optional().nullable(),
});

const whatsappSourceSchema = z.enum(['phone1', 'phone2', 'other']).optional().nullable();

const customOrderFinancialFieldsSchema = {
  price: z.coerce.number().nonnegative().default(0).optional(),
  line_discount: z.coerce.number().nonnegative().default(0).optional(),
  order_type: z.enum(['rent', 'sell']).default('rent').optional(),
  tax_mode: z.enum(['exclusive', 'inclusive']).default('exclusive').optional(),
  gst_enabled: z.coerce.boolean().default(true).optional(),
  igst_bill: z.coerce.boolean().default(false).optional(),
  booking_discount_type: z.enum(['flat', 'percent']).default('flat').optional(),
  booking_discount_value: z.coerce.number().nonnegative().default(0).optional(),
  advance_amount: z.coerce.number().nonnegative().default(0).optional(),
  deposit_amount: z.coerce.number().nonnegative().default(0).optional(),
  paid_security_amt: z.coerce.boolean().default(false).optional(),
  advance_account_id: z.string().trim().max(80).optional().nullable(),
  security_account_id: z.string().trim().max(80).optional().nullable(),
  apply_credit_amount: z.coerce.number().nonnegative().default(0).optional(),
};

export const createCustomOrderSchema = z.object({
  status: customOrderStatusSchema.default('in_progress'),
  customer_id: z.string().uuid().optional().nullable(),
  customer_name: z.string().trim().min(1, 'Customer name is required').max(200),
  customer_phone: optionalIndianPhone.optional(),
  customer_phone2: optionalIndianPhone.optional(),
  customer_phone2_name: z.string().trim().max(120).optional().nullable(),
  customer_whatsapp: optionalIndianPhone.optional(),
  customer_whatsapp_source: whatsappSourceSchema,
  customer_address: z.string().trim().max(2000).optional().nullable(),
  delivery_date: optionalSqlDate,
  return_date: optionalSqlDate,
  marriage_date: optionalSqlDate,
  order_date: optionalSqlDate,
  order_time: orderTimeSchema,
  design_name: z.string().trim().max(200).optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  product_name: z.string().trim().max(200).optional().nullable(),
  color: z.string().trim().max(60).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),
  remarks: z.string().trim().max(5000).optional().nullable(),
  given_to_tailor: z.coerce.boolean().default(false),
  tailor_name: z.string().trim().max(120).optional().nullable(),
  tailor_date: optionalSqlDate,
  trial_date: optionalSqlDate,
  trial_product: z.string().trim().max(200).optional().nullable(),
  retrials: z.array(retrialEntrySchema).max(50).default([]),
  measurements: measurementsSchema,
  design_images: imagesArraySchema,
  trial_images: imagesArraySchema,
  ...customOrderFinancialFieldsSchema,
});

export const updateCustomOrderSchema = createCustomOrderSchema.partial();

export const linkCustomOrderBookingSchema = z.object({
  order_id: z.string().uuid(),
});

/** Optional product overrides when creating inventory from a custom order. */
export const createProductFromCustomOrderSchema = z.object({
  category_id: z.string().uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform(normalizeProductName)
    .optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform(normalizeProductCode)
    .optional(),
  code_is_manual: z.coerce.boolean().optional(),
  color: z.string().trim().max(60).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  main_image: imageUrlSchema.optional().nullable(),
  photos: imagesArraySchema.optional(),
  qty: z.coerce.number().int().positive().max(9999).optional(),
  type: z.enum(['rent', 'sell', 'both']).optional(),
});

/**
 * Validate fields required when marking a custom order completed.
 * @param {object} body
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateCustomOrderForCompletion(body) {
  const row = body && typeof body === 'object' ? body : {};
  if (!String(row.category_id || '').trim()) {
    return { ok: false, message: 'Category is required to complete the order' };
  }
  const productName = String(row.product_name || row.design_name || '').trim();
  if (!productName) {
    return { ok: false, message: 'Product name is required to complete the order' };
  }
  if (!String(row.customer_name || '').trim()) {
    return { ok: false, message: 'Customer name is required to complete the order' };
  }
  const phone = String(row.customer_phone || '').trim();
  const customerId = String(row.customer_id || '').trim();
  if (!customerId && (!phone || !REGEX.PHONE_IN.test(phone))) {
    return { ok: false, message: 'Contact number is required to complete the order' };
  }
  return { ok: true };
}

/**
 * Advance amount requires a matching payment account id.
 * @param {object} body
 * @returns {{ ok: true } | { ok: false, message: string, field?: string }}
 */
export function validateCustomOrderPaymentAccounts(body) {
  const row = body && typeof body === 'object' ? body : {};
  const adv = Number(row.advance_amount || 0);
  const advAcc = String(row.advance_account_id || '').trim();

  if (adv > 0 && !advAcc) {
    return {
      ok: false,
      message: 'Select an advance payment account for the amount entered',
      field: 'advance_account_id',
    };
  }
  return { ok: true };
}

export const customOrderListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(200).optional(),
  search: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim();
    return s.length ? s.slice(0, 200) : undefined;
  }, z.string().max(200).optional()),
  status: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim();
    return CUSTOM_ORDER_STATUS_VALUES.includes(s) ? s : undefined;
  }, customOrderStatusSchema.optional()),
  order_date_from: optionalSqlDate,
  order_date_to: optionalSqlDate,
  delivery_date_from: optionalSqlDate,
  delivery_date_to: optionalSqlDate,
  sort: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    return u === undefined ? undefined : String(u).trim().slice(0, 80);
  }, z.string().max(80).optional()),
});

/**
 * @param {Array<{ id?: string, required?: boolean, is_active?: boolean, field_type?: string, label?: string }>} definitions
 * @param {Record<string, unknown>} measurements
 * @returns {{ ok: true } | { ok: false, message: string, field?: string }}
 */
export function validateCustomOrderMeasurements(definitions, measurements) {
  const input = measurements && typeof measurements === 'object' ? measurements : {};
  const active = (definitions || []).filter((d) => d.is_active !== false);
  const allowed = new Set(active.map((d) => String(d.id || '')).filter(Boolean));

  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      return { ok: false, message: `Unknown measurement field: ${key}`, field: key };
    }
  }

  for (const def of active) {
    const key = String(def.id || '');
    if (!key) continue;
    const raw = input[key];
    const empty =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && !String(raw).trim());
    if (def.required && empty) {
      return { ok: false, message: `${def.label || key} is required`, field: key };
    }
    if (!empty && def.field_type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return { ok: false, message: `${def.label || key} must be a number`, field: key };
      }
    }
  }

  return { ok: true };
}

/**
 * Normalize measurements for storage (string values).
 * @param {Record<string, unknown>} measurements
 */
export function normalizeCustomOrderMeasurements(measurements) {
  const out = {};
  for (const [k, v] of Object.entries(measurements || {})) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return out;
}

/**
 * Normalize re-trial rows for storage (drop empty dates, trim notes).
 * @param {Array<{ date?: string|null, notes?: string|null }>} retrials
 */
export function normalizeCustomOrderRetrials(retrials) {
  const out = [];
  for (const row of retrials || []) {
    if (!row || typeof row !== 'object') continue;
    const dateRaw = row.date;
    const date =
      dateRaw == null || dateRaw === ''
        ? null
        : String(dateRaw).trim().slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const notesRaw = row.notes;
    const notes =
      notesRaw == null || notesRaw === '' ? null : String(notesRaw).trim().slice(0, 500) || null;
    out.push({ date, notes });
  }
  return out;
}

/**
 * Most recent re-trial by date (same-day ties use last entry in list).
 * @param {Array<{ date?: string|null, notes?: string|null }>} retrials
 * @returns {{ date: string, notes: string|null }|null}
 */
export function getLatestCustomOrderRetrial(retrials) {
  const rows = normalizeCustomOrderRetrials(retrials);
  if (!rows.length) return null;
  let latest = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.date > latest.date || row.date === latest.date) latest = row;
  }
  return latest;
}

const TRIAL_DASHBOARD_EXCLUDED_STATUSES = new Set(['completed', CUSTOM_ORDER_CANCELLED_STATUS]);

/**
 * MySQL DATE / Knex may return Date objects; normalize to YYYY-MM-DD for comparisons.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCustomOrderSqlDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return toLocalISODate(value);
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const fromDate = toLocalISODate(s);
  return fromDate || '';
}

/**
 * Scheduled trial/re-trial date for list column and dashboard reminders.
 * @param {{ trial_date?: string|null, retrials?: unknown }} order
 * @returns {{ date: string, kind: 'trial'|'retrial' }|null}
 */
export function getCustomOrderTrialReminderEntry(order) {
  const latest = getLatestCustomOrderRetrial(order?.retrials);
  if (latest?.date) {
    return { date: latest.date, kind: 'retrial' };
  }
  const date = normalizeCustomOrderSqlDate(order?.trial_date);
  if (!date) return null;
  return { date, kind: 'trial' };
}

/**
 * Chronological trial + re-trial log for list/detail modals.
 * @param {{ trial_date?: string|null, retrials?: unknown }} order
 * @returns {Array<{ kind: 'trial'|'retrial', date: string, notes: string|null }>}
 */
export function buildCustomOrderTrialLogEntries(order) {
  const entries = [];
  const trialDate = normalizeCustomOrderSqlDate(order?.trial_date);
  if (trialDate) {
    entries.push({ kind: 'trial', date: trialDate, notes: null });
  }
  for (const row of normalizeCustomOrderRetrials(order?.retrials || [])) {
    entries.push({ kind: 'retrial', date: row.date, notes: row.notes });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * @param {{ trial_reminder_dismissed_date?: string|null, trial_reminder_dismissed_kind?: string|null }} order
 * @param {{ date: string, kind: 'trial'|'retrial' }} entry
 * @returns {boolean}
 */
export function isCustomOrderTrialReminderDismissed(order, entry) {
  if (!entry?.date) return false;
  const dismissedDate = normalizeCustomOrderSqlDate(order?.trial_reminder_dismissed_date);
  if (!dismissedDate) return false;
  const entryDate = normalizeCustomOrderSqlDate(entry.date);
  const kind = String(order?.trial_reminder_dismissed_kind || '').trim();
  return dismissedDate === entryDate && kind === entry.kind;
}

/**
 * @param {{ status?: string|null } & object} order
 * @returns {boolean}
 */
export function isCustomOrderTrialDashboardEligible(order) {
  const entry = getCustomOrderTrialReminderEntry(order);
  if (!entry?.date) return false;
  const status = String(order?.status || '').trim();
  if (TRIAL_DASHBOARD_EXCLUDED_STATUSES.has(status)) return false;
  if (isCustomOrderTrialReminderDismissed(order, entry)) return false;
  return true;
}

/**
 * Fields to persist when user marks the current trial/re-trial reminder complete on dashboard.
 * @param {object} order
 * @returns {{ trial_reminder_dismissed_date: string, trial_reminder_dismissed_kind: 'trial'|'retrial' }|null}
 */
export function buildCustomOrderTrialReminderDismissPatch(order) {
  const entry = getCustomOrderTrialReminderEntry(order);
  if (!entry?.date) return null;
  return {
    trial_reminder_dismissed_date: entry.date,
    trial_reminder_dismissed_kind: entry.kind,
  };
}

/**
 * @param {{ date?: string|null }|null|undefined} entry
 * @param {string} todayIso YYYY-MM-DD
 * @returns {boolean}
 */
export function isCustomOrderTrialOverdue(entry, todayIso) {
  if (!entry?.date || !todayIso) return false;
  const today = String(todayIso).trim().slice(0, 10);
  return entry.date < today;
}
