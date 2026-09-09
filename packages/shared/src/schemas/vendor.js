import { z } from 'zod';

import { REGEX } from '../utils/validators.js';

export const VENDOR_TYPE = z.enum(['supplier', 'tailor', 'laundry', 'repair', 'planner']);

export const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  vendor_type: VENDOR_TYPE,
  phone: z
    .string()
    .trim()
    .regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number')
    .optional()
    .nullable()
    .or(z.literal('')),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .optional()
    .nullable()
    .or(z.literal('')),
  address: z.string().trim().max(1000).optional().nullable(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(REGEX.GSTIN, 'Invalid GSTIN (e.g. 22AAAAA0000A1Z5)')
    .optional()
    .nullable()
    .or(z.literal('')),
  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

export const createVendorSchema = vendorSchema.omit({ id: true });
export const updateVendorSchema = vendorSchema.partial().extend({ id: z.string().uuid() });

export const purchaseItemSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional().nullable(),
  accessory_id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  qty: z.coerce.number().int().positive().default(1),
  unit_price: z.coerce.number().nonnegative().default(0),
});

export const createPurchaseSchema = z.object({
  shop_id: z.string().uuid(),
  vendor_id: z.string().uuid().optional().nullable(),
  bill_number: z.string().trim().max(80).optional().nullable(),
  purchase_date: z.string().date(),
  paid_amount: z.coerce.number().nonnegative().default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(purchaseItemSchema).min(1, 'At least one item required'),
});

export const expenseSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  vendor_id: z.string().uuid().optional().nullable(),
  paid_from: z.string().uuid().optional().nullable(),
  category: z
    .enum(['laundry', 'repair', 'salary', 'rent', 'travel', 'utility', 'misc'])
    .default('misc'),
  title: z.string().trim().min(1).max(200),
  amount: z.coerce.number().positive(),
  expense_date: z.string().date(),
  payment_type: z
    .enum(['cash', 'card', 'upi', 'transfer', 'wallet', 'cheque', 'other'])
    .default('cash'),
  receipt_url: z.string().url().optional().nullable().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const createExpenseSchema = expenseSchema.omit({ id: true });
export const updateExpenseSchema = expenseSchema.partial().extend({ id: z.string().uuid() });
