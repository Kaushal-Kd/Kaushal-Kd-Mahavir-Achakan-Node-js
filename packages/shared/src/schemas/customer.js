import { z } from 'zod';

import { REGEX, normalizePhone } from '../utils/validators.js';

/** MySQL DATE/DATETIME often serializes as `YYYY-MM-DD HH:mm:ss` or ISO — keep `YYYY-MM-DD` for Zod. */
const optionalSqlDate = z.preprocess((val) => {
  if (val === undefined) return undefined;
  if (val === null || val === '') return null;
  const s = String(val).trim();
  const ymd = s.length >= 10 ? s.slice(0, 10) : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return ymd;
}, z.union([z.string().date(), z.null()]).optional());

/** Optional phone: null, empty, or 10-digit Indian mobile (API/DB may send null). */
const optionalIndianPhone = z.union([
  z.null(),
  z.literal(''),
  z.string().trim().regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number'),
]);

/** tinyint(0/1) from MySQL JSON must coerce to boolean. */
const coerceBool = z.coerce.boolean();

export const customerSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  name: z.string().trim().min(1, 'Customer name is required').max(200),
  phone1: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number'),
  phone1_name: z.string().trim().max(60).optional().nullable(),
  phone2: optionalIndianPhone.optional(),
  phone2_name: z.string().trim().max(60).optional().nullable(),
  whatsapp: optionalIndianPhone.optional(),
  email: z
    .union([z.literal(''), z.null(), z.string().trim().toLowerCase().email()])
    .optional(),
  address: z.string().trim().max(500).optional().nullable(),
  anniversary: optionalSqlDate,
  photo_url: z.string().trim().max(500).optional().nullable().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: coerceBool.optional().default(true),
});

export const createCustomerSchema = customerSchema.omit({ id: true });
export const updateCustomerSchema = customerSchema.partial().extend({
  id: z.string().uuid(),
});

/**
 * Check Availability: create from a single search string — either a display name
 * or a valid Indian mobile (after normalize). Phone-only keeps name empty so UI
 * can ask for the name later (e.g. before quick bill).
 */
export const availabilityQuickCreateCustomerSchema = z
  .object({
    name: z.union([z.string(), z.undefined()]).optional(),
    phone1: z.union([z.string(), z.undefined()]).optional(),
  })
  .transform((raw) => ({
    name: String(raw.name ?? '').trim(),
    phone1: normalizePhone(raw.phone1),
  }))
  .superRefine((data, ctx) => {
    const hasName = data.name.length >= 1;
    const hasPhone = REGEX.PHONE_IN.test(data.phone1);
    if (!hasName && !hasPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a customer name or a valid 10-digit mobile number',
        path: ['name'],
      });
    }
    if (data.phone1.length > 0 && !hasPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid 10-digit mobile number',
        path: ['phone1'],
      });
    }
  })
  .transform((data) => {
    const hasPhone = REGEX.PHONE_IN.test(data.phone1);
    if (hasPhone && !data.name) {
      return { name: '', phone1: data.phone1, is_active: true };
    }
    if (!hasPhone && data.name) {
      return { name: data.name, phone1: '', is_active: true };
    }
    return { name: data.name, phone1: data.phone1, is_active: true };
  });
