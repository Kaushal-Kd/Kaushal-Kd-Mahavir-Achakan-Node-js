import { z } from 'zod';

import { collectIndianPhones, normalizePhone } from '../utils/validators.js';

const optionalNormalizedPhoneQuery = z.preprocess((val) => {
  if (val == null || val === '') return undefined;
  const p = normalizePhone(val);
  return p || undefined;
}, z.string().optional());

export const creditBalanceByPhonesQuerySchema = z
  .object({
    phone1: optionalNormalizedPhoneQuery,
    phone2: optionalNormalizedPhoneQuery,
  })
  .transform((data) => ({
    phones: collectIndianPhones(data.phone1, data.phone2),
  }));

export const creditNoteListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(500).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(80).optional(),
  entry_date: z.string().date().optional(),
  settled: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => {
      if (v === true || v === 'true' || v === '1') return true;
      if (v === false || v === 'false' || v === '0') return false;
      return undefined;
    }),
});

export const settleCreditNoteBodySchema = z.object({
  settle_remarks: z.string().trim().max(2000).optional().nullable(),
});

export const cancelOrderBodySchema = z
  .object({
    refund_amount: z.coerce.number().nonnegative().default(0),
    refund_payment_account_id: z.string().trim().max(80).optional().nullable(),
    security_refund_amount: z.coerce.number().nonnegative().default(0),
    security_account_id: z.string().trim().max(80).optional().nullable(),
    credit_note_amount: z.coerce.number().nonnegative().default(0),
    credit_note_remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const refund = Number(data.refund_amount || 0);
    const credit = Number(data.credit_note_amount || 0);
    if (refund > 0 && !data.refund_payment_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Refund account is required when refund amount is greater than zero',
        path: ['refund_payment_account_id'],
      });
    }
    const sec = Number(data.security_refund_amount || 0);
    if (sec > 0 && !data.security_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Security account is required when security refund amount is greater than zero',
        path: ['security_account_id'],
      });
    }
  });
