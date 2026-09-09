import { z } from 'zod';

export const TAILOR_STATUS = z.enum([
  'pending',
  'in_progress',
  'ready',
  'fit_check',
  'completed',
  'rejected',
]);
export const TAILOR_URGENCY = z.enum(['normal', 'same_day', 'next_day', 'rush']);

export const tailorJobSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  order_id: z.string().uuid().optional().nullable(),
  order_item_id: z.string().uuid().optional().nullable(),
  tailor_id: z.string().uuid().optional().nullable(),
  vendor_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(2000).optional().nullable(),
  status: TAILOR_STATUS.default('pending'),
  urgency: TAILOR_URGENCY.default('normal'),
  due_date: z.string().date().optional().nullable(),
  charge: z.coerce.number().nonnegative().default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const createTailorJobSchema = tailorJobSchema.omit({ id: true });
export const updateTailorJobSchema = tailorJobSchema.partial().extend({ id: z.string().uuid() });

export const LAUNDRY_STATUS = z.enum(['pending', 'sent', 'received', 'quality_ok', 'rejected']);

export const laundryJobSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  vendor_id: z.string().uuid().optional().nullable(),
  order_id: z.string().uuid().optional().nullable(),
  order_item_id: z.string().uuid().optional().nullable(),
  product_id: z.string().uuid().optional().nullable(),
  status: LAUNDRY_STATUS.default('pending'),
  sent_date: z.string().date().optional().nullable(),
  received_date: z.string().date().optional().nullable(),
  cost: z.coerce.number().nonnegative().default(0),
  express: z.boolean().optional().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const createLaundryJobSchema = laundryJobSchema.omit({ id: true });
export const updateLaundryJobSchema = laundryJobSchema.partial().extend({ id: z.string().uuid() });
