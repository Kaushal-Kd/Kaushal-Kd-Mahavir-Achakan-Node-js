import { z } from 'zod';

const nullableString = z.string().trim().optional().nullable();

export const laundryJobProductSchema = z.object({
  productId: nullableString,
  categoryId: nullableString,
  categoryLabel: nullableString,
  code: nullableString,
  name: z.string().trim().min(1),
  image: nullableString,
  nextPickupDate: nullableString,
  daysLeft: z.coerce.number().int().optional().nullable(),
  priority: z.enum(['Urgent', 'High', 'Medium', 'Low', 'No Schedule']).default('No Schedule'),
  qty: z.coerce.number().int().min(1).default(1),
});

export const laundryJobAccessorySchema = z.object({
  accessoryId: nullableString,
  categoryId: nullableString,
  categoryLabel: nullableString,
  code: nullableString,
  name: z.string().trim().min(1),
  qty: z.coerce.number().int().min(1).default(1),
  rate: z.coerce.number().min(0).default(0),
});

export const laundryCategoryPriceSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  productCount: z.coerce.number().int().min(0).default(0),
  qtyTotal: z.coerce.number().int().min(0).default(0),
  washPrice: z.coerce.number().min(0).default(0),
});

export const createLaundryJobSchema = z.object({
  jobNo: z.string().trim().min(1).max(40).optional(),
  laundryDate: z.preprocess(
    (val) => String(val || '').trim(),
    z
      .string()
      .min(1)
      .max(40)
      .regex(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/, 'Invalid laundry date/time')
  ),
  vendorAccountId: nullableString,
  vendorName: nullableString,
  pickupBy: nullableString,
  pickupAt: nullableString,
  returnAt: nullableString,
  remarks: nullableString,
  productRows: z.array(laundryJobProductSchema).default([]),
  accessoryRows: z.array(laundryJobAccessorySchema).default([]),
  categorySummaries: z.array(laundryCategoryPriceSchema).default([]),
  productTotal: z.coerce.number().min(0).default(0),
  accessoryTotal: z.coerce.number().min(0).default(0),
  subtotal: z.coerce.number().min(0).default(0),
  discountMode: z.enum(['fixed', 'percent']).default('fixed'),
  discountValue: z.coerce.number().min(0).default(0),
  discountAmount: z.coerce.number().min(0).default(0),
  payable: z.coerce.number().min(0).default(0),
  queueIds: z.array(z.string().trim()).default([]),
});

export const returnSelectedSchema = z.object({
  productLineIds: z.array(z.string().trim().min(1)).default([]),
  accessories: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        returnQty: z.coerce.number().int().min(1).optional(),
      })
    )
    .default([]),
});
