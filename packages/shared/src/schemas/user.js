import { z } from 'zod';

import { ALL_ROLES } from '../constants/roles.js';
import { REGEX } from '../utils/validators.js';

const baseUserSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .optional()
    .nullable()
    .or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number'),
  // Second mobile — optional, same 10-digit rule as `phone`. Neither number
  // The first mobile is mandatory because it is the login identity.
  phone2: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number')
    .optional()
    .nullable()
    .or(z.literal('')),
  address: z.string().trim().max(500).optional().nullable().or(z.literal('')),
  remark: z.string().trim().max(500).optional().nullable().or(z.literal('')),
  username: z.string().trim().min(3).max(60).optional().nullable(),
  role: z.enum(ALL_ROLES),
  password: z.string().min(8).optional(),
  permissions: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  /**
   * True once the grid has been edited on the user screen. Such users are
   * excluded from the role-wide permission sync so their overrides survive.
   * Send `false` (with no `permissions`) to reset a user back to their role.
   */
  permissions_overridden: z.boolean().optional(),
  shop_ids: z.array(z.string().uuid()).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

function requireAdminEmail(value, ctx) {
  if (['super_admin', 'shop_admin'].includes(value.role) && !value.email) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: 'Email is required for admin password OTP',
    });
  }
}

export const userSchema = baseUserSchema.superRefine(requireAdminEmail);

export const createUserSchema = baseUserSchema
  .omit({ id: true })
  .extend({ password: z.string().min(8) })
  .superRefine(requireAdminEmail);

export const updateUserSchema = baseUserSchema.partial().extend({ id: z.string().uuid() });

/** Per-shop fixed commission configuration for a salesman. */
export const salesmanCommissionSchema = z.object({
  basis: z.enum(['booking', 'product']).nullable(),
  rate: z.coerce.number().finite().nonnegative().max(99999999.99),
});
