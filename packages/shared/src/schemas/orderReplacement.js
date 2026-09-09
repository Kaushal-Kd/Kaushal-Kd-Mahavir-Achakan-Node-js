import { z } from 'zod';

export const orderItemReplacementSchema = z.object({
  replacement_product_id: z.string().uuid(),
  expected_product_id: z.string().uuid(),
  expected_line_version: z.number().int().nonnegative(),
  idempotency_key: z.string().uuid(),
}).strict().refine((body) => body.replacement_product_id !== body.expected_product_id, {
  path: ['replacement_product_id'],
  message: 'Select a different replacement product',
});
