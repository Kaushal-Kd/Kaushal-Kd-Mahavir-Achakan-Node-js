import { z } from 'zod';

const money = z
  .number()
  .finite()
  .min(0)
  .max(999999999)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
    'Use at most two decimal places'
  );
const percentage = money.refine(
  (v) => v > 0 && v <= 100,
  'Percentage must be greater than 0 and at most 100'
);
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN');
export const gstSourceTypeSchema = z.enum(['booking', 'sale']);
export const gstInvoiceQuerySchema = z
  .object({
    source: gstSourceTypeSchema.optional(),
    from: z.string().date(),
    to: z.string().date(),
    max_amount: z.coerce.number().finite().positive().max(999999999).optional(),
    search: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((v) => v.from <= v.to, 'To date must be on or after From');

export const gstInvoiceAllocationSchema = z
  .object({
    source_type: gstSourceTypeSchema,
    source_id: z.string().uuid(),
    source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    percentage,
    recipient_gstin: z.union([gstinSchema, z.literal('')]).default(''),
    place_of_supply: z
      .string()
      .regex(/^(0[1-9]|[12][0-9]|3[0-8])$/, 'Enter a valid two-digit state code'),
    components: z
      .array(
        z
          .object({
            line_key: z.string().min(1).max(80),
            description: z.string().trim().min(1).max(500),
            hsn_sac: z.string().regex(/^\d{4,8}$/, 'Enter a 4–8 digit HSN/SAC'),
            gst_gross: money,
            tax_rate: percentage,
            non_gst_reason: z.string().trim().max(1000).default(''),
          })
          .strict()
      )
      .min(1)
      .max(500),
  })
  .strict();

export const gstInvoiceIssueSchema = z
  .object({
    idempotency_key: z.string().uuid(),
    max_amount: money.refine((v) => v > 0, 'Amount limit must be positive'),
    invoices: z.array(gstInvoiceAllocationSchema).min(1).max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.invoices.map((i) => `${i.source_type}:${i.source_id}`);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invoices'],
        message: 'Select each original bill only once',
      });
  });
