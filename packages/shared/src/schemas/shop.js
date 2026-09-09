import { z } from 'zod';

import { ORDER_NUMBER_FORMAT_VALUES } from '../utils/billNumber.js';
import { INDIAN_STATES } from '../constants/indianStates.js';
import { REGEX } from '../utils/validators.js';

const STATE_VALUES = [...INDIAN_STATES];

export const shopSchema = z.object({
  id: z.string().uuid().optional(),
  company_name: z.string().trim().min(1).max(200),
  shop_name: z.string().trim().min(1).max(200),
  owner_name: z.string().trim().max(200).optional().nullable(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(REGEX.GSTIN, 'Invalid GSTIN (e.g. 22AAAAA0000A1Z5)')
    .optional()
    .nullable()
    .or(z.literal('')),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(REGEX.PAN, 'Invalid PAN (e.g. AAAAA9999A)')
    .optional()
    .nullable()
    .or(z.literal('')),
  address: z.string().trim().max(500).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z
    .enum(STATE_VALUES, { errorMap: () => ({ message: 'Select a valid Indian state' }) })
    .optional()
    .nullable()
    .or(z.literal('')),
  pincode: z
    .string()
    .trim()
    .regex(REGEX.PINCODE, 'PIN must be 6 digits')
    .optional()
    .nullable()
    .or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number')
    .optional()
    .nullable()
    .or(z.literal('')),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('')),
  logo_url: z.string().url().optional().nullable().or(z.literal('')),
  parent_shop_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  order_number_prefix: z
    .string()
    .trim()
    .max(12, 'Prefix is at most 12 characters')
    .regex(/^[A-Za-z0-9]*$/, 'Use letters and numbers only')
    .optional()
    .nullable(),
  order_number_format: z.enum(ORDER_NUMBER_FORMAT_VALUES).optional().nullable(),
});

export const createShopSchema = shopSchema.omit({ id: true });
export const updateShopSchema = shopSchema.partial().extend({ id: z.string().uuid() });
