import { z } from 'zod';

const accountId = z.string().trim().min(1).max(80);

const paymentVoucherObjectSchema = z.object({
  shop_id: z.string().uuid().optional(),
  credit_account_id: accountId,
  debit_account_id: accountId,
  entry_date: z.string().date(),
  amount: z.coerce.number().positive('Amount must be positive'),
  remarks: z.string().trim().max(16000).optional(),
  bill_kind: z.enum(['none', 'washing', 'purchase']).default('none'),
  bill_id: z.string().uuid().optional().nullable(),
  bill_ids: z.array(z.string().uuid()).max(100).optional(),
});

const debitCreditMustDiffer = (schema) =>
  schema.refine((d) => d.debit_account_id !== d.credit_account_id, {
    message: 'Debited and credited accounts must differ',
    path: ['debit_account_id'],
  });

function resolvedBillIds(d) {
  if (Array.isArray(d.bill_ids) && d.bill_ids.length) {
    return [...new Set(d.bill_ids)];
  }
  if (d.bill_id) return [d.bill_id];
  return [];
}

const billRefine = (schema) =>
  schema.superRefine((d, ctx) => {
    const ids = resolvedBillIds(d);
    if (Array.isArray(d.bill_ids) && d.bill_ids.length !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate bill IDs are not allowed',
        path: ['bill_ids'],
      });
    }
    if (d.bill_id && Array.isArray(d.bill_ids) && d.bill_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Use either bill_id or bill_ids, not both',
        path: ['bill_ids'],
      });
    }

    if (d.bill_kind === 'washing') {
      if (!ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Washing bill requires at least one laundry job',
          path: ['bill_ids'],
        });
      }
    } else if (d.bill_kind === 'purchase') {
      if (!ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Purchase bill requires at least one purchase',
          path: ['bill_ids'],
        });
      }
    } else if (ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bill reference requires purchase or washing bill kind',
        path: ['bill_ids'],
      });
    }
  });

const base = debitCreditMustDiffer(paymentVoucherObjectSchema);
export const createPaymentVoucherSchema = billRefine(base);

export const createPaymentVoucherBodySchema = billRefine(
  paymentVoucherObjectSchema.omit({ shop_id: true })
);

export const updatePaymentVoucherBodySchema = createPaymentVoucherBodySchema;
