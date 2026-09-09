import { z } from 'zod';

export { orderItemReplacementSchema } from '@wrs/shared';

export const replacementListSchema = z.object({
  direction: z.enum(['source', 'target']).default('target'),
  source_item_ids: z.string().max(4000).optional().transform((value) =>
    value ? value.split(',').filter(Boolean) : []
  ).pipe(z.array(z.string().uuid()).max(100)),
});

export const replacementRouteParamsSchema = z.object({
  orderId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
});
