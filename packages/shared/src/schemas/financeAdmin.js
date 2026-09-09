import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const accountId = z.string().trim().min(1).max(80);

export const paymentAccountTypeUpdateSchema = z.object({
  account_type: z.enum(['cash', 'bank', 'upi', 'other']),
});

export const cashReconciliationBodySchema = z.object({
  payment_account_id: accountId,
  business_date: isoDate,
  counted_closing: z.coerce.number().finite(),
  notes: z.string().trim().max(2000).optional().nullable(),
  idempotency_key: z.string().trim().min(8).max(80),
  expected_total_fingerprint: z.string().trim().length(64),
  admin_password: z.string().min(1).optional(),
  revision_reason: z.string().trim().max(1000).optional().nullable(),
});

export const cashReconciliationQuerySchema = z.object({
  date: isoDate.optional(),
  payment_account_id: accountId.optional(),
});

export const gstReportQuerySchema = z
  .object({
    source: z.enum(['booking', 'sale']).optional().default('booking'),
    from: isoDate,
    to: isoDate,
    page: z.coerce.number().int().min(1).optional().default(1),
    per_page: z.coerce.number().int().min(1).max(500).optional().default(50),
    search: z.string().trim().max(120).optional(),
    status: z.string().trim().max(40).optional(),
    tax_mode: z.enum(['all', 'cgst_sgst', 'igst']).optional().default('all'),
    sort_by: z.enum(['bill_no', 'date']).optional().default('date'),
    sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .refine((value) => value.from <= value.to, {
    path: ['to'],
    message: 'To date must be on or after from date',
  });

export const gstConversionBodySchema = z.object({
  source_type: z.enum(['booking', 'sale']),
  idempotency_key: z.string().trim().min(8).max(80),
  reason: z.string().trim().min(3).max(1000),
  admin_password: z.string().min(1).optional(),
});

export const whatsappReminderQuerySchema = z.object({
  status: z.enum(['pending', 'processing', 'sent', 'failed', 'uncertain', 'cancelled', 'all']).optional().default('all'),
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const whatsappResendSchema = z.object({
  template_key: z.enum(['DELIVERY_PRODUCT_LIST', 'RETURN_MISSING_ITEMS']),
  order_id: z.string().uuid(),
  document: z.object({
    filename: z.string().trim().min(1).max(200),
    content_base64: z.string().min(1).max(15_000_000),
    mimetype: z.string().trim().max(100).optional().default('application/pdf'),
  }),
});
