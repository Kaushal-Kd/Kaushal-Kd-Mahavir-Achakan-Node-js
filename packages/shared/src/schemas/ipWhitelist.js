import { z } from 'zod';

export const IP_ACCESS_MODES = Object.freeze(['inherit', 'anywhere', 'restricted']);

const ipRangeListSchema = (maxItems) =>
  z
    .array(z.string().trim().min(1, 'IP address or CIDR range is required').max(128))
    .max(maxItems, `A maximum of ${maxItems} IP addresses or CIDR ranges is allowed`);

export const globalIpWhitelistSchema = z
  .object({
    enabled: z.boolean(),
    allowed_ranges: ipRangeListSchema(100),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.allowed_ranges.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowed_ranges'],
        message: 'Add at least one allowed IP address or CIDR range before enabling',
      });
    }
  });

export const userIpWhitelistSchema = z
  .object({
    mode: z.enum(IP_ACCESS_MODES),
    allowed_ranges: ipRangeListSchema(50).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'restricted' && value.allowed_ranges.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowed_ranges'],
        message: 'Add at least one allowed IP address or CIDR range for a restricted user',
      });
    }
  });

export const shopIpCommandSchema = z.object({
  idempotency_key: z.string().uuid(),
  expected_revision: z.number().int().nonnegative(),
  policy: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('shop'), enabled: z.boolean(), allowed_ranges: ipRangeListSchema(100) }).strict(),
    z.object({ kind: z.literal('user'), user_id: z.string().uuid(), mode: z.enum(IP_ACCESS_MODES), allowed_ranges: ipRangeListSchema(50) }).strict(),
  ]),
}).strict().superRefine(({ policy }, ctx) => {
  if ((policy.kind === 'shop' && policy.enabled || policy.kind === 'user' && policy.mode === 'restricted') && !policy.allowed_ranges.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['policy', 'allowed_ranges'], message: 'Add at least one allowed IP address or CIDR range' });
  }
});
