import { z } from 'zod';

export const ACCESSORY_TYPE = z.enum(['rent', 'sell', 'both']);
export const ACCESSORY_GIVEN_STATUS = z.enum(['given_with_rent', 'pack_with_rent', 'regular']);

const accessoryObjectSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  code: z.string().trim().min(1, 'Code is required').max(80).optional(),
  name: z.string().trim().min(1, 'Name is required').max(200),
  image_url: z.string().url().optional().nullable(),
  category_id: z.string().uuid().optional().nullable(),
  color: z.string().trim().max(60).optional().nullable().or(z.literal('')),
  size: z.string().trim().max(40).optional().nullable().or(z.literal('')),

  qty: z.coerce.number().int().nonnegative().default(0),
  spare_qty: z.coerce.number().int().nonnegative().default(0),
  damaged_qty: z.coerce.number().int().nonnegative().default(0),
  threshold: z.coerce.number().int().nonnegative().default(5),
  unit: z.string().trim().max(20).default('pcs'),

  price_rent: z.coerce.number().nonnegative().default(0),
  price_sell: z.coerce.number().nonnegative().default(0),
  purchase_price: z.coerce.number().nonnegative().default(0),

  default_type: ACCESSORY_TYPE.default('rent'),
  default_order_status: ACCESSORY_GIVEN_STATUS.default('regular'),

  notes: z.string().trim().max(2000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

function refineAccessorySpareQty(data, ctx) {
  const qty = Number(data.qty ?? 0);
  const spare = Number(data.spare_qty ?? 0);
  const damaged = Number(data.damaged_qty ?? 0);
  if (spare > qty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Spare qty cannot exceed qty in stock',
      path: ['spare_qty'],
    });
  }
  // Only checkable when the total is actually part of this payload — a partial
  // update carrying damaged_qty alone has nothing meaningful to compare against.
  if (data.qty == null) return;
  if (damaged > qty) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Damaged qty cannot exceed qty in stock',
      path: ['damaged_qty'],
    });
  } else if (spare <= qty && spare + damaged > qty) {
    // Spare and damaged both come out of the same pool, so together they can
    // never exceed it either.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Spare and damaged qty together cannot exceed qty in stock',
      path: ['damaged_qty'],
    });
  }
}

export const accessorySchema = accessoryObjectSchema.superRefine(refineAccessorySpareQty);

export const createAccessorySchema = accessoryObjectSchema
  .omit({ id: true })
  .superRefine(refineAccessorySpareQty);

export const updateAccessorySchema = accessoryObjectSchema
  .partial()
  .extend({ id: z.string().uuid() })
  .superRefine((data, ctx) => {
    if (data.qty == null && data.spare_qty == null && data.damaged_qty == null) return;
    refineAccessorySpareQty(data, ctx);
  });
