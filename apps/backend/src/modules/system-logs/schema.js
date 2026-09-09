import { SYSTEM_LOG_MODULE_VALUES } from '@wrs/shared';
import { z } from 'zod';

export const listSystemLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().optional(),
  module: z
    .string()
    .optional()
    .refine((v) => !v || SYSTEM_LOG_MODULE_VALUES.includes(v), { message: 'Invalid module' }),
  entity_id: z.string().uuid().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  use_date: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});
