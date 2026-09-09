import { z } from 'zod';

import { ORDER_NUMBER_FORMAT_VALUES, ORDER_NUMBER_PREFIX_MAX } from '../utils/billNumber.js';

export const billNumberingUpdateSchema = z.object({
  order_number_prefix: z
    .string()
    .trim()
    .max(ORDER_NUMBER_PREFIX_MAX)
    .regex(/^[A-Za-z0-9]*$/, 'Use letters and numbers only'),
  order_number_format: z.enum(ORDER_NUMBER_FORMAT_VALUES).optional(),
});
