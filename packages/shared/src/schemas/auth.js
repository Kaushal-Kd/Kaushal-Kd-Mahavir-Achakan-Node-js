import { z } from 'zod';

import { REGEX } from '../utils/validators.js';

export const loginSchema = z
  .object({
    identity: z.string().trim().optional(),
    // Accepted only for older installed clients during the migration window.
    email: z.string().trim().toLowerCase().email().optional(),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    remember: z.boolean().optional().default(false),
    device_id: z.string().optional(),
    device_name: z.string().optional(),
  })
  .refine((value) => Boolean(value.identity || value.email), {
    message: 'Enter your phone number',
    path: ['identity'],
  })
  .transform(({ email, ...value }) => ({ ...value, identity: value.identity || email }));

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirm: z.string().min(8),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

/** Shop Admin password verification for protected deletes and edits */
export const shopAdminPasswordBodySchema = z.object({
  admin_password: z.string().min(1, 'Shop Admin password is required'),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number')
    .optional()
    .nullable()
    .or(z.literal('')),
  username: z.string().trim().min(3).max(60).optional().nullable().or(z.literal('')),
});

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(6),
    new_password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirm: z.string().min(8),
  })
  .refine((d) => d.new_password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export const requestPasswordOtpSchema = z.object({
  target_user_id: z.string().uuid(),
  current_password: z.string().min(6).optional(),
});

export const confirmPasswordOtpSchema = z
  .object({
    challenge_id: z.string().uuid(),
    otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP'),
    new_password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirm: z.string().min(8),
  })
  .refine((d) => d.new_password === d.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export const loginModeSchema = z.object({
  mode: z.enum(['dual_transition', 'phone_only']),
});

export const authSessionListQuerySchema = z.object({
  status: z.enum(['active', 'revoked', 'all']).optional().default('active'),
});

export const revokeAuthSessionSchema = z.object({
  reason: z.string().trim().min(1, 'Reason is required').max(500),
});
