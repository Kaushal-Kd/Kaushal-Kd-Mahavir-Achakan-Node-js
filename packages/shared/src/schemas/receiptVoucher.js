import { z } from 'zod';

const accountId = z.string().trim().min(1).max(80);

const receiptVoucherObjectSchema = z.object({
  shop_id: z.string().uuid().optional(),
  debit_account_id: accountId,
  credit_account_id: accountId,
  entry_date: z.string().date(),
  amount: z.coerce.number().positive('Amount must be positive'),
  remarks: z.string().trim().max(16000).optional(),
});

const debitCreditMustDiffer = (schema) =>
  schema.refine((d) => d.debit_account_id !== d.credit_account_id, {
    message: 'Debited and credited accounts must differ',
    path: ['credit_account_id'],
  });

export const createReceiptVoucherSchema = debitCreditMustDiffer(receiptVoucherObjectSchema);

export const createReceiptVoucherBodySchema = debitCreditMustDiffer(
  receiptVoucherObjectSchema.omit({ shop_id: true })
);

export const updateReceiptVoucherBodySchema = createReceiptVoucherBodySchema;
