import { z } from 'zod';

import { isIndianPhone } from '../utils/validators.js';

const imageUrlsSchema = z.array(z.string().trim().url().max(500)).max(20).optional().default([]);

const accountId = z.string().trim().min(1).max(80);

export const createExpenseEntrySchema = z.object({
  shop_id: z.string().uuid().optional(),
  expense_account_id: accountId,
  payment_account_id: accountId,
  name: z.string().trim().min(1, 'Name is required').max(200),
  entry_date: z.string().date(),
  amount: z.coerce.number().positive('Amount must be positive'),
  details: z.string().trim().min(1, 'Details are required').max(16000),
  contact_no: z
    .string()
    .trim()
    .max(10)
    .nullish()
    .refine((v) => !v || isIndianPhone(v), {
      message: 'Enter a valid 10-digit mobile number',
    }),
  image_urls: imageUrlsSchema,
});

export const createExpenseEntryBodySchema = createExpenseEntrySchema.omit({ shop_id: true });

/** Same fields as create; used for PUT /expense-entries/:id */
export const updateExpenseEntryBodySchema = createExpenseEntryBodySchema;
