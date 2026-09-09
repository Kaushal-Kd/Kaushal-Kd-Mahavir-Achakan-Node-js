import { z } from 'zod';

import { normalizeProductCode, normalizeProductName } from '../utils/productCodeFormat.js';

export const PRODUCT_TYPE = z.enum(['rent', 'sell', 'both']);
export const PRODUCT_STATUS_ENUM = z.enum([
  'available',
  'booked',
  'delivered',
  'returned',
  'washing',
  'repair',
  'sold',
  'lost',
]);

export const productSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  category_id: z.string().uuid().optional().nullable(),
  name: z
    .string()
    .trim()
    .min(1, 'Product name is required')
    .max(200)
    .transform(normalizeProductName),
  code: z
    .string()
    .trim()
    .min(1, 'Product code is required')
    .max(80)
    .transform(normalizeProductCode),
  type: PRODUCT_TYPE,
  color: z.string().trim().max(60).optional().nullable(),
  size: z.string().trim().max(40).optional().nullable(),

  price_rent: z.coerce.number().nonnegative().default(0),
  price_sell: z.coerce.number().nonnegative().default(0),
  purchase_price: z.coerce.number().nonnegative().optional().nullable(),

  qty: z.coerce.number().int().nonnegative().default(1),
  lifetime_gap: z.coerce.number().int().nonnegative().default(0),

  status: PRODUCT_STATUS_ENUM.default('available'),
  vendor_id: z.string().uuid().optional().nullable(),

  photos: z.array(z.string().url()).optional().default([]),
  main_image: z.string().url().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),

  is_active: z.boolean().optional().default(true),
});

export const createProductSchema = productSchema.omit({ id: true });
export const updateProductSchema = productSchema.partial().extend({ id: z.string().uuid() });

export const productAccessoryMappingItemSchema = z.object({
  accessory_id: z.string().uuid(),
  is_recommended: z.boolean().default(true),
  is_required: z.boolean().default(false),
  display_order: z.coerce.number().int().nonnegative().default(0),
});

export const updateProductAccessoryMappingSchema = z.object({
  accessories: z.array(productAccessoryMappingItemSchema).default([]),
});

export const productRelatedMappingItemSchema = z.object({
  related_product_id: z.string().uuid(),
  is_recommended: z.boolean().default(true),
  is_required: z.boolean().default(false),
  display_order: z.coerce.number().int().nonnegative().default(0),
});

export const updateProductRelatedMappingSchema = z.object({
  products: z.array(productRelatedMappingItemSchema).default([]),
});

export const bulkDeactivateProductsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const bulkDeleteProductsByCodeInputSchema = z
  .object({
    codes: z.array(z.string().trim().min(1).max(80)).max(500).optional(),
    csv_text: z.string().trim().max(500_000).optional(),
  })
  .refine((v) => v.codes?.length || String(v.csv_text || '').trim(), {
    message: 'Provide codes or csv_text',
  });

/** Query string for GET /products/:id/rental-history — `show_all` must parse safely from URL params. */
const queryShowAllBool = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}, z.boolean());

export const productRentalHistoryQuerySchema = z.object({
  show_all: queryShowAllBool.optional().default(false),
});

const emptyQueryToUndef = (v) => (v === '' || v === undefined || v === null ? undefined : v);

export const productCodeNumberTakenQuerySchema = z.object({
  category_id: z.preprocess(emptyQueryToUndef, z.string().uuid().optional()),
  number: z.coerce.number().int().positive(),
  exclude_id: z.preprocess(emptyQueryToUndef, z.string().uuid().optional()),
  size: z.preprocess(emptyQueryToUndef, z.string().trim().max(40).optional()),
});

/** GET /reports/product-history — text `q` and/or `product_id` (id wins for disambiguation). */
export const productHistoryQuerySchema = z.object({
  q: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim();
    return s.length ? s : undefined;
  }, z.string().min(1).max(120).optional()),
  product_id: z.preprocess(emptyQueryToUndef, z.string().uuid().optional()),
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional();

export const productSaleHistoryQuerySchema = z.object({
  show_all: queryShowAllBool.optional().default(false),
  from: isoDate,
  to: isoDate,
});

/** GET /reports/product-performance */
export const productPerformanceQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(200).optional().default(50),
  category_id: z.preprocess(
    emptyQueryToUndef,
    z.union([z.literal('none'), z.string().uuid()]).optional()
  ),
  search: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim();
    return s.length ? s.slice(0, 120) : undefined;
  }, z.string().min(1).max(120).optional()),
  sort_by: z
    .enum([
      'total_earning',
      'total_rent',
      'booked_qty',
      'sale_qty',
      'total_discount',
      'stock',
      'mrp',
      'rent_price',
      'code',
      'product_name',
      'category_name',
    ])
    .optional()
    .default('total_earning'),
  sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
});

/** GET /reports/salesman — monthly salesman performance (booking lines or sales) */
export const salesmanReportQuerySchema = z
  .object({
    month: z.preprocess(
      emptyQueryToUndef,
      z
        .string()
        .regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM')
        .optional()
    ),
    from: z.preprocess(
      emptyQueryToUndef,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    ),
    to: z.preprocess(
      emptyQueryToUndef,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
    ),
    type: z.enum(['booking', 'sale']).optional().default('booking'),
    sales_person_id: z.preprocess(
      emptyQueryToUndef,
      z.union([z.literal('none'), z.string().uuid()]).optional()
    ),
    category_id: z.preprocess(
      emptyQueryToUndef,
      z.union([z.literal('none'), z.string().uuid()]).optional()
    ),
  })
  .superRefine((value, ctx) => {
    if (value.month) return;
    if (!value.from || !value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'Select a month or provide both from and to dates',
      });
      return;
    }
    if (value.from > value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'To date must be on or after from date',
      });
    }
  });

/** GET /reports/pending-bills — optional return_date window via from/to */
export const pendingBillsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim();
    return s.length ? s.slice(0, 120) : undefined;
  }, z.string().min(1).max(120).optional()),
  from: isoDate,
  to: isoDate,
  sort_by: z.enum(['bill_no', 'return_date']).optional().default('return_date'),
  sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
});

const isoDateRequired = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const accountIdParam = z.string().trim().min(1, 'Account is required').max(80);

export const INCOME_EXPENSE_DATE_BASIS_VALUES = ['payment', 'booking', 'delivery', 'return'];

/** Desktop select options for income/expense date basis */
export const INCOME_EXPENSE_DATE_BASIS_OPTIONS = [
  { value: 'payment', label: 'Payment / entry date' },
  { value: 'booking', label: 'Booking date' },
  { value: 'delivery', label: 'Delivery (pickup) date' },
  { value: 'return', label: 'Return date' },
];

export const INCOME_EXPENSE_TRANSACTION_TYPE_VALUES = [
  'all',
  'booking_payment',
  'order_payment_booked',
  'order_payment_delivered',
  'order_payment_returned',
  'sale_payment',
  'purchase',
  'income_entry',
  'expense_entry',
  'receipt_voucher',
  'payment_voucher',
];

/** Desktop select options for income/expense transaction type filter */
export const INCOME_EXPENSE_TRANSACTION_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'booking_payment', label: 'All Booking Payments' },
  { value: 'order_payment_booked', label: 'Booking payment (Booked)' },
  { value: 'order_payment_delivered', label: 'Delivery payment (Delivered)' },
  { value: 'order_payment_returned', label: 'Return payment (Returned)' },
  { value: 'sale_payment', label: 'Sale payment' },
  { value: 'purchase', label: 'Purchase payment' },
  { value: 'income_entry', label: 'Income entry' },
  { value: 'expense_entry', label: 'Expense entry' },
  { value: 'receipt_voucher', label: 'Receipt voucher' },
  { value: 'payment_voucher', label: 'Payment voucher' },
];

/** GET /reports/income-expense — ledger + booking payments in range */
export const incomeExpenseQuerySchema = z
  .object({
    from: isoDateRequired,
    to: isoDateRequired,
    search: z.preprocess((v) => {
      const u = emptyQueryToUndef(v);
      if (u === undefined) return undefined;
      const s = String(u).trim();
      return s.length ? s.slice(0, 120) : undefined;
    }, z.string().min(1).max(120).optional()),
    date_basis: z
      .preprocess((v) => {
        const u = emptyQueryToUndef(v);
        if (u === undefined) return 'payment';
        const s = String(u).trim();
        return INCOME_EXPENSE_DATE_BASIS_VALUES.includes(s) ? s : 'payment';
      }, z.enum(INCOME_EXPENSE_DATE_BASIS_VALUES))
      .optional()
      .default('payment'),
    payment_account_id: z.preprocess(emptyQueryToUndef, accountIdParam.optional()),
    transaction_type: z
      .preprocess((v) => {
        const u = emptyQueryToUndef(v);
        if (u === undefined) return 'all';
        const s = String(u).trim();
        return INCOME_EXPENSE_TRANSACTION_TYPE_VALUES.includes(s) ? s : 'all';
      }, z.enum(INCOME_EXPENSE_TRANSACTION_TYPE_VALUES))
      .optional()
      .default('all'),
    sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .refine((q) => q.from <= q.to, { message: 'from must be on or before to' });

/** GET /reports/account-ledger — Dr/Cr lines for one payment account */
export const accountLedgerQuerySchema = z
  .object({
    account_id: accountIdParam,
    from: isoDateRequired,
    to: isoDateRequired,
  })
  .refine((q) => q.from <= q.to, { message: 'from must be on or before to' });

/** GET /reports/trial-balance — all payment accounts with period Dr/Cr */
export const trialBalanceQuerySchema = z
  .object({
    from: isoDateRequired,
    to: isoDateRequired,
  })
  .refine((q) => q.from <= q.to, { message: 'from must be on or before to' });

/** GET /reports/daily-cashbook — per-account income/expense for one calendar day */
export const dailyCashbookQuerySchema = z.object({
  date: z.preprocess(
    (v) => {
      if (v === undefined || v === null || v === '') return undefined;
      const s = String(v).trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
    },
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
  ),
});

/** GET /reports/daily-cashbook/lines — line items for one account on one day */
export const dailyCashbookLinesQuerySchema = z.object({
  date: z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  }, isoDateRequired),
  account_id: accountIdParam,
});
