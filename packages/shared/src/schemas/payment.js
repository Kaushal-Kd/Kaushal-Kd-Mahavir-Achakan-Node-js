import { z } from 'zod';

/** Payment method values (matches `paymentSchema.payment_type`). */
export const PAYMENT_TYPE = Object.freeze({
  CASH: 'cash',
  CARD: 'card',
  UPI: 'upi',
  TRANSFER: 'transfer',
  WALLET: 'wallet',
  CHEQUE: 'cheque',
  OTHER: 'other',
});

export const paymentSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  order_id: z.string().uuid().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  received_by: z.string().uuid().optional().nullable(),
  received_in: z.string().uuid().optional().nullable(),
  payment_type: z.enum(['cash', 'card', 'upi', 'transfer', 'wallet', 'cheque', 'other']),
  category: z
    .enum([
      'advance',
      'partial',
      'final',
      'refund',
      'deposit',
      'deposit_refund',
      'credit_note_issue',
      'credit_note_apply',
    ])
    .default('partial'),
  amount: z.coerce.number().positive(),
  payment_date: z.string().date(),
  transaction_id: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  payment_account_id: z.string().trim().max(80).optional().nullable(),
  security_account_id: z.string().trim().max(80).optional().nullable(),
  /** Set by server when payment is linked to an order; read-only on API responses. */
  order_status_at_payment: z.string().trim().max(40).optional().nullable(),
});

export const createPaymentSchema = paymentSchema.omit({ id: true });

const paymentListBoolean = z.preprocess((value) => {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}, z.boolean().optional());

const paymentListDate = z.preprocess(
  (value) => {
    const text = String(value ?? '')
      .trim()
      .slice(0, 10);
    return text || undefined;
  },
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
);

export const securityTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(500).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(80).optional(),
  from: paymentListDate,
  to: paymentListDate,
  security_account_id: z.string().trim().max(80).optional(),
  view: z.enum(['received', 'return', 'on_hand']).optional().default('received'),
});

export const securityDueQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(500).optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.string().trim().max(80).optional(),
  from: paymentListDate,
  to: paymentListDate,
  amount_filter: z.enum(['collected', 'return', 'charge', 'pending']).optional(),
  include_zero: paymentListBoolean,
});
