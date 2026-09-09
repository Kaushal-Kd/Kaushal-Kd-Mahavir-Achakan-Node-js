import { z } from 'zod';

const money = z.number().finite().min(0).max(9999999999.99);
const account = z.string().trim().min(1).max(80).nullable().optional();

export const bookingEditSettlementSchema = z
  .object({
    expected_advance_net: money.optional(),
    advance_net: money.optional(),
    expected_security_net: money.optional(),
    security_net: money.optional(),
    expected_deposit_amount: money.optional(),
    deposit_amount: money.optional(),
    payment_date: z.string().date(),
    payment_account_id: account,
    security_account_id: account,
  })
  .superRefine((body, ctx) => {
    if (body.deposit_amount !== undefined && body.expected_deposit_amount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expected_deposit_amount'], message: 'Reload the booking before changing Security Amount' });
    }
    for (const key of ['advance', 'security']) {
      if (body[`${key}_net`] !== undefined && body[`expected_${key}_net`] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`expected_${key}_net`],
          message: 'Reload the booking before changing collected money',
        });
      }
    }
  });
