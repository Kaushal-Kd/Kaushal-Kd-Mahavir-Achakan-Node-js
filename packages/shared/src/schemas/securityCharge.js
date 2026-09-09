import { z } from 'zod';

const accountId = z.string().trim().min(1).max(80);

export const securityChargeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(500).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(80).optional(),
  order_id: z.string().uuid().optional(),
  condition_kind: z.enum(['missing', 'damage']).optional(),
  collection_status: z.enum(['all', 'uncollected', 'held', 'legacy']).optional(),
  settled: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => {
      if (v === true || v === 'true' || v === '1') return true;
      if (v === false || v === 'false' || v === '0') return false;
      return undefined;
    }),
});

export const securityChargeOperationBodySchema = z
  .object({
    idempotency_key: z.string().uuid(),
    kind: z.enum(['collect', 'retain', 'refund', 'release', 'settle']),
    amount: z.coerce.number().finite().positive().max(9999999999.99),
    payment_date: z.string().date(),
    funding_operation_id: z.string().uuid().optional(),
    payment_account_id: accountId.optional(),
    security_account_id: accountId.optional(),
    income_account_id: accountId.optional(),
    remarks: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (['refund', 'release', 'settle'].includes(value.kind) && !value.funding_operation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['funding_operation_id'],
        message: 'Select the original held funding lot',
      });
    }
    if (value.kind === 'collect' && (!value.payment_account_id || value.security_account_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_account_id'],
        message: 'Choose a bank/cash account for collection',
      });
    }
    if (
      value.kind === 'refund' &&
      Boolean(value.payment_account_id) === Boolean(value.security_account_id)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_account_id'],
        message: 'Choose exactly one payout account',
      });
    }
    if (value.kind === 'settle' && !value.income_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['income_account_id'],
        message: 'Choose an income account',
      });
    }
  });

export const createSecurityChargeBodySchema = z.object({
  order_id: z.string().uuid(),
  amount: z.coerce.number().positive('Amount must be positive'),
  remarks: z.string().trim().max(2000).optional().nullable(),
  source: z.enum(['return_modal', 'checklist']).optional().default('return_modal'),
});

export const settleSecurityChargeBodySchema = z
  .object({
    idempotency_key: z.string().uuid().optional(),
    funding_operation_id: z.string().uuid().optional(),
    amount: z.coerce.number().finite().positive().optional(),
    payment_date: z.string().date().optional(),
    payment_account_id: accountId.optional(),
    security_account_id: accountId.optional(),
    income_account_id: accountId.optional(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const hasPay = Boolean(data.payment_account_id);
    const hasSec = Boolean(data.security_account_id);
    if (hasPay === hasSec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select either a security account or a bank/cash account as the forfeit source',
        path: ['payment_account_id'],
      });
    }
  });

/** Align return-modal settlement charge with held deposit minus amount returned to customer. */
export const syncReturnSettlementChargeBodySchema = z.object({
  order_id: z.string().uuid(),
  return_amount: z.coerce.number().nonnegative(),
  remarks: z.string().trim().max(2000).optional().nullable(),
});
