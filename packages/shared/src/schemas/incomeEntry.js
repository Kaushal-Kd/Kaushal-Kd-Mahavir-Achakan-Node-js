import { z } from 'zod';

const accountId = z.string().trim().min(1).max(80);

export const createIncomeEntrySchema = z.object({
  shop_id: z.string().uuid().optional(),
  income_account_id: accountId,
  payment_account_id: accountId,
  name: z.string().trim().min(1, 'Name is required').max(200),
  entry_date: z.string().date(),
  amount: z.coerce.number().positive('Amount must be positive'),
  details: z.string().trim().min(1, 'Details are required').max(16000),
});

export const createIncomeEntryBodySchema = createIncomeEntrySchema.omit({ shop_id: true });

/** Same fields as create; used for PUT /income-entries/:id */
export const updateIncomeEntryBodySchema = createIncomeEntryBodySchema;
