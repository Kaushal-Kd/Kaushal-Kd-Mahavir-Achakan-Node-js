import { z } from 'zod';

import { REGEX } from '../utils/validators.js';

const idStr = z.string().trim().min(1).max(80);

export const createPaymentAccountSchema = z.object({
  id: idStr.optional(),
  name: z.string().trim().min(1).max(200),
  // 10 digits, matching every other phone field in the app. Empty is still
  // allowed so legacy rows saved before this rule can be updated.
  contact_no: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number')
    .or(z.literal(''))
    .optional()
    .default(''),
  account_group: z.string().trim().max(80).optional().default(''),
  account_type: z.enum(['cash', 'bank', 'upi', 'other']).optional().default('other'),
  opening_balance: z.coerce.number().default(0),
  date: z.string().trim().max(20).optional().default(''),
  email: z.string().trim().max(200).optional().default(''),
  address: z.string().trim().max(500).optional().default(''),
  remarks: z.string().trim().max(500).optional().default(''),
  qr_code_url: z.string().trim().max(500).optional().default(''),
  is_active: z.boolean().optional().default(true),
});

export const updatePaymentAccountSchema = createPaymentAccountSchema.partial();

export const createSecurityAccountSchema = z.object({
  id: idStr.optional(),
  name: z.string().trim().min(1).max(200),
  account_type: z.enum(['cash', 'bank']).optional().default('cash'),
  qr_code_url: z.string().trim().max(500).optional().default(''),
  is_active: z.boolean().optional().default(true),
});

export const updateSecurityAccountSchema = createSecurityAccountSchema.partial();
