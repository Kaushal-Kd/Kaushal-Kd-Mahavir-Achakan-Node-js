import { z } from 'zod';

import { isIndianPhone } from '../utils/validators.js';

const saleItemSchema = z.object({
  item_type: z.enum(['item', 'product']).default('item'),
  product_id: z.string().uuid().nullish(),
  accessory_id: z.string().uuid().nullish(),
  name_snapshot: z.string().trim().min(1).max(255),
  qty: z.coerce.number().int().min(1).default(1),
  price: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  taxable_price: z.coerce.number().min(0).default(0),
  cgst_percent: z.coerce.number().min(0).default(0),
  cgst_amount: z.coerce.number().min(0).default(0),
  sgst_percent: z.coerce.number().min(0).default(0),
  sgst_amount: z.coerce.number().min(0).default(0),
  igst_percent: z.coerce.number().min(0).default(0),
  igst_amount: z.coerce.number().min(0).default(0),
  net_price: z.coerce.number().min(0).default(0),
  total_amount: z.coerce.number().min(0).default(0),
});

export const createSaleBodySchema = z.object({
  bill_type: z.enum(['gst', 'kaccha']).optional(),
  sale_date: z.string().date(),
  customer_name: z.string().trim().min(1, 'Name is required').max(200),
  contact_no: z
    .string()
    .trim()
    .max(10)
    .nullish()
    .refine((v) => !v || isIndianPhone(v), {
      message: 'Enter a valid 10-digit mobile number',
    }),
  address: z.string().trim().max(2000).nullish(),
  sales_person_id: z.string().uuid().optional().nullable(),
  remark: z.string().trim().max(2000).nullish(),
  discount_type: z.enum(['flat', 'percent']).default('flat'),
  discount_value: z.coerce.number().min(0).default(0),
  discount_amount: z.coerce.number().min(0).default(0),
  subtotal: z.coerce.number().min(0).default(0),
  cgst_total: z.coerce.number().min(0).default(0),
  sgst_total: z.coerce.number().min(0).default(0),
  igst_total: z.coerce.number().min(0).default(0),
  tax_total: z.coerce.number().min(0).default(0),
  net_amount: z.coerce.number().min(0).default(0),
  total_amount: z.coerce.number().min(0).default(0),
  advance: z.coerce.number().min(0).default(0),
  advance_account_id: z.string().trim().max(80).nullish(),
  items: z.array(saleItemSchema).min(1, 'At least one item is required'),
});

export const updateSaleBodySchema = createSaleBodySchema;

export const recordSalePaymentBodySchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  payment_account_id: z.string().trim().min(1).max(80),
  payment_date: z.string().date().optional(),
});
