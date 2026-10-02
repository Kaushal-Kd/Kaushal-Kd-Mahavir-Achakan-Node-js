import { z } from 'zod';

import {
  DOCUMENT_NUMBER_TYPE_KEYS,
  DOCUMENT_START_SEQUENCE_MAX,
  DOCUMENT_START_SEQUENCE_MIN,
  ORDER_NUMBER_FORMAT_VALUES,
  ORDER_NUMBER_PREFIX_MAX,
} from '../utils/billNumber.js';

const prefixSchema = z
  .string()
  .trim()
  .max(ORDER_NUMBER_PREFIX_MAX)
  .regex(/^[A-Za-z0-9]*$/, 'Use letters and numbers only');

const startSequenceSchema = z.coerce
  .number()
  .int()
  .min(DOCUMENT_START_SEQUENCE_MIN)
  .max(DOCUMENT_START_SEQUENCE_MAX);

const documentTypeNumberingSchema = z.object({
  prefix: prefixSchema.optional().nullable(),
  start_sequence: startSequenceSchema.optional(),
});

const documentsSchema = z
  .object(
    Object.fromEntries(DOCUMENT_NUMBER_TYPE_KEYS.map((key) => [key, documentTypeNumberingSchema.optional()]))
  )
  .optional();

export const billNumberingUpdateSchema = z.object({
  order_number_prefix: prefixSchema,
  order_number_format: z.enum(ORDER_NUMBER_FORMAT_VALUES).optional(),
  order_start_sequence: startSequenceSchema.optional(),
  documents: documentsSchema,
});
