import { z } from 'zod';

const smtpHost = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/,
    'Enter a mail server hostname, without a URL or port'
  );

export const shopEmailSettingsSchema = z
  .object({
    host: smtpHost,
    port: z.union([z.literal(465), z.literal(587)]),
    username: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .regex(/^[^\r\n\0]+$/, 'Invalid SMTP username'),
    from_email: z.string().trim().email().max(254),
    password: z.string().max(4096).optional(),
    expected_revision: z.string().uuid().nullable(),
  })
  .strict();

export const testShopEmailSchema = z.object({ expected_revision: z.string().uuid() }).strict();
