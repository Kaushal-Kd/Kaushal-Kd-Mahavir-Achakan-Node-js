import { WHATSAPP_MESSAGE_KEYS } from '@wrs/shared';
import { normalizeWhatsAppRecipient } from '@wrs/shared/utils/whatsappRecipient.js';
import { z } from 'zod';

export const sendWhatsAppMessageSchema = z.object({
  template_key: z.enum(WHATSAPP_MESSAGE_KEYS),
  phone: z.string().trim().min(8).max(20)
    .refine((value) => Boolean(normalizeWhatsAppRecipient(value)), 'Enter a valid 10-digit WhatsApp number')
    .transform(normalizeWhatsAppRecipient),
  order_id: z.string().uuid().optional(),
  context: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  attach_bill_pdf: z.boolean().optional(),
  document: z
    .object({
      filename: z.string().min(1).max(200),
      content_base64: z.string().min(1).max(15_000_000),
      mimetype: z.string().max(100).optional(),
    })
    .optional(),
});

export const logsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(100).optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
});
