import { z } from 'zod';

const accountId = z.string().trim().min(1).max(80);

const journalVoucherObjectSchema = z.object({
  shop_id: z.string().uuid().optional(),
  debit_account_id: accountId,
  credit_account_id: accountId,
  entry_date: z.string().date(),
  amount: z.coerce.number().positive('Amount must be positive'),
  remarks: z.string().trim().min(1, 'Remarks are required').max(16000),
});

const debitCreditMustDiffer = (schema) =>
  schema.refine((d) => d.debit_account_id !== d.credit_account_id, {
    message: 'Debit and credit accounts must differ',
    path: ['credit_account_id'],
  });

export const createJournalVoucherSchema = debitCreditMustDiffer(journalVoucherObjectSchema);

export const createJournalVoucherBodySchema = debitCreditMustDiffer(
  journalVoucherObjectSchema.omit({ shop_id: true })
);

export const updateJournalVoucherBodySchema = createJournalVoucherBodySchema;
