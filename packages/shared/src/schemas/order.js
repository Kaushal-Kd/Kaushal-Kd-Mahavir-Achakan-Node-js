import { z } from 'zod';
import { bookingEditSettlementSchema } from './bookingEditSettlement.js';

import { normalizeTime12, TIME_12H_REGEX } from '../utils/date.js';
import { REGEX, normalizePhone } from '../utils/validators.js';

const optionalIndianPhoneField = z.union([
  z.null(),
  z.literal(''),
  z.string().regex(REGEX.PHONE_IN, 'Enter a valid 10-digit mobile number'),
]);

const pickupNumberSchema = z.preprocess((val) => {
  if (val == null || val === '') return null;
  const n = normalizePhone(val);
  return n || null;
}, optionalIndianPhoneField);

const time12Schema = z.preprocess(
  (value) => normalizeTime12(value),
  z.string().regex(TIME_12H_REGEX, 'Invalid time (use h:mm AM/PM)').nullable().optional()
);

export const orderItemSchema = z.object({
  id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional().nullable(),
  accessory_id: z.string().uuid().optional().nullable(),
  item_type: z.enum(['product', 'accessory']).default('product'),
  name_snapshot: z.string().trim().max(200),
  qty: z.coerce.number().int().positive().default(1),
  price: z.coerce.number().nonnegative(),
  discount: z.coerce.number().nonnegative().default(0),
  type: z.enum(['rent', 'sell']).default('rent'),
  condition: z.enum(['fresh', 'reuse']).default('fresh').optional(),
  given_with_rent: z.boolean().default(false).optional(),
  pack_with_rent: z.boolean().default(false).optional(),
  tailor_notes: z.string().trim().max(1000).optional().nullable(),
  /** Optional reference image for stitching / fitting (product lines only). */
  tailor_note_image: z.string().trim().max(500).optional().nullable(),
  /** Operator notes for accessory lines only (ignored for product lines). */
  remarks: z.string().trim().max(500).optional().nullable(),
  /** Sort order for product and accessory lines (user sequence on booking / checklist). */
  display_order: z.coerce.number().int().nonnegative().default(0).optional(),
  /** User who added this product line (shop staff / salesman). */
  sales_person_id: z.string().uuid().optional().nullable(),
  stage_flags: z
    .object({
      item_to_collect: z.boolean().default(false),
      prepared: z.boolean().default(false),
      delivered: z.boolean().default(false),
      received: z.boolean().default(false),
    })
    .default({ item_to_collect: false, prepared: false, delivered: false, received: false }),
});

export const orderSchema = z.object({
  id: z.string().uuid().optional(),
  shop_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  order_number: z.string().trim().optional(),
  bill_no: z.coerce.number().int().positive().optional(),
  order_type: z.enum(['rent', 'sell', 'mixed', 'trial', 'accessory_only']).default('rent'),
  booking_date: z.string().date(),
  booking_time: time12Schema,
  pickup_date: z.string().date(),
  return_date: z.string().date().optional().nullable().or(z.literal('')),
  delivery_time: time12Schema,
  return_time: time12Schema,
  sales_person_id: z.string().uuid().optional().nullable(),
  reference_name: z.string().trim().max(200).optional().nullable(),
  pickup_name: z.string().trim().max(200).optional().nullable(),
  pickup_number: pickupNumberSchema.optional().nullable(),
  contact_phone1: pickupNumberSchema.optional().nullable(),
  contact_address: z.string().trim().max(500).optional().nullable(),
  customer_notes: z.string().trim().max(2000).optional().nullable(),
  next_booking_gap_days: z.coerce.number().int().nonnegative().default(0).optional(),
  previous_booking_gap_days: z.coerce.number().int().nonnegative().default(0).optional(),
  gst_enabled: z.boolean().default(true).optional(),
  bill_type: z.enum(['gst', 'kaccha']).optional(),
  igst_bill: z.boolean().default(false).optional(),
  advance_account_id: z.string().trim().max(80).optional().nullable(),
  security_account_id: z.string().trim().max(80).optional().nullable(),
  paid_security_amt: z.boolean().default(false).optional(),
  booking_discount_type: z.enum(['flat', 'percent']).default('flat').optional(),
  booking_discount_value: z.coerce.number().nonnegative().default(0).optional(),
  booking_discount_amount: z.coerce.number().nonnegative().default(0).optional(),

  items: z.array(orderItemSchema).min(1, 'At least one item is required'),

  subtotal: z.coerce.number().nonnegative().default(0),
  discount_total: z.coerce.number().nonnegative().default(0),
  tax_total: z.coerce.number().nonnegative().default(0),
  extra_charges: z.coerce.number().nonnegative().default(0),
  total_amount: z.coerce.number().nonnegative().default(0),

  deposit_amount: z.coerce.number().nonnegative().default(0),
  deposit_received: z.boolean().default(false),
  deposit_returned: z.boolean().default(false),

  status: z
    .enum([
      'draft',
      'booked',
      'pending',
      'confirmed',
      'item_to_collect',
      'in_preparation',
      'ready_for_delivery',
      'delivered',
      'partially_returned',
      'returned',
      'closed',
      'cancelled',
    ])
    .default('booked'),

  canceled_at: z.string().datetime().optional().nullable(),
});

/**
 * Line items for POST /orders — includes `tax` per line (full line tax, not per unit).
 * `line_id`: client cart id for a product row; stored only in memory server-side to link accessories.
 * `parent_line_id`: for accessories, the parent product row's `line_id` (resolves to order_items.id).
 */
export const createOrderItemSchema = orderItemSchema.extend({
  tax: z.coerce.number().nonnegative().default(0),
  line_id: z.string().trim().max(80).optional().nullable(),
  parent_line_id: z.string().trim().max(80).optional().nullable(),
});

/**
 * Payload for creating an order (desktop booking + API clients).
 * Omits server-computed totals and lifecycle-only order fields.
 */
export const createOrderInputSchema = z.object({
  shop_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  order_type: z.enum(['rent', 'sell', 'mixed', 'trial', 'accessory_only']).default('rent'),
  bill_type: z.enum(['gst', 'kaccha']).optional(),
  booking_date: z.string().date(),
  booking_time: time12Schema,
  pickup_date: z.string().date(),
  return_date: z.string().date().optional().nullable().or(z.literal('')),
  delivery_time: time12Schema,
  return_time: time12Schema,
  sales_person_id: z.string().uuid().optional().nullable(),
  reference_name: z.string().trim().max(200).optional().nullable(),
  pickup_name: z.string().trim().max(200).optional().nullable(),
  pickup_number: pickupNumberSchema.optional().nullable(),
  contact_phone1: pickupNumberSchema.optional().nullable(),
  contact_address: z.string().trim().max(500).optional().nullable(),
  customer_notes: z.string().trim().max(2000).optional().nullable(),
  next_booking_gap_days: z.coerce.number().int().nonnegative().default(0).optional(),
  previous_booking_gap_days: z.coerce.number().int().nonnegative().default(0).optional(),
  gst_enabled: z.boolean().default(true).optional(),
  igst_bill: z.boolean().default(false).optional(),
  tax_mode: z.enum(['exclusive', 'inclusive']).default('exclusive').optional(),
  advance_account_id: z.string().trim().max(80).optional().nullable(),
  advance_amount: z.coerce.number().nonnegative().default(0).optional(),
  security_account_id: z.string().trim().max(80).optional().nullable(),
  paid_security_amt: z.boolean().default(false).optional(),
  booking_discount_type: z.enum(['flat', 'percent']).default('flat').optional(),
  booking_discount_value: z.coerce.number().nonnegative().default(0).optional(),
  deposit_amount: z.coerce.number().nonnegative().default(0).optional(),
  apply_credit_amount: z.coerce.number().nonnegative().default(0).optional(),
  /** Contact numbers used to match open credit notes (not customer name). */
  credit_lookup_phone1: z.preprocess((val) => {
    if (val == null || val === '') return undefined;
    const p = normalizePhone(val);
    return p || undefined;
  }, z.string().optional()),
  credit_lookup_phone2: z.preprocess((val) => {
    if (val == null || val === '') return undefined;
    const p = normalizePhone(val);
    return p || undefined;
  }, z.string().optional()),
  status: z
    .enum([
      'draft',
      'booked',
      'pending',
      'confirmed',
      'item_to_collect',
      'in_preparation',
      'ready_for_delivery',
      'delivered',
      'partially_returned',
      'returned',
      'closed',
      'cancelled',
    ])
    .default('booked')
    .optional(),
  extra_charges: z.coerce.number().nonnegative().default(0).optional(),
  items: z.array(createOrderItemSchema).min(1, 'At least one item is required'),
});

export const updateOrderItemSchema = createOrderItemSchema.extend({
  expected_product_id: z.string().uuid().nullable().optional(),
  expected_line_version: z.number().int().nonnegative().optional(),
  id: z.string().uuid().optional(),
});

/**
 * Payload for updating an existing order lines + header details.
 * Excludes payment-creation fields to avoid duplicate payment rows on edit.
 */
export const updateOrderInputSchema = createOrderInputSchema
  .omit({
    advance_amount: true,
    deposit_amount: true,
    paid_security_amt: true,
  })
  .extend({
    idempotency_key: z.string().uuid().optional(),
    edit_settlement: bookingEditSettlementSchema.optional(),
    expected_product_lines: z.array(z.object({
      item_id: z.string().uuid(), expected_product_id: z.string().uuid().nullable(),
      expected_line_version: z.number().int().nonnegative(),
    })).max(500).optional(),
    items: z.array(updateOrderItemSchema).min(1, 'At least one item is required'),
    admin_password: z.string().min(1).optional(),
    reconcile: z.literal(true).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.edit_settlement && !data.idempotency_key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['idempotency_key'], message: 'A command key is required for booking payment edits' });
    }
    if (data.reconcile === true && !data.admin_password?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Shop Admin password is required to reconcile a cancelled order',
        path: ['admin_password'],
      });
    }
  });

/** @deprecated Prefer createOrderInputSchema — kept as alias for older imports. */
export const createOrderSchema = createOrderInputSchema;

export const updateOrderSchema = orderSchema.partial().extend({ id: z.string().uuid() });

export const orderStageFieldSchema = z.enum([
  'item_to_collect',
  'prepared',
  'delivered',
  'received',
]);

function rejectAccessoryItemToCollectStage(data, ctx) {
  const itemType = data.item_type ?? 'item';
  const field = data.field === 'pre_check' ? 'item_to_collect' : data.field;
  if (itemType === 'accessory' && field === 'item_to_collect') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Item to collect does not apply to accessories',
      path: ['field'],
    });
  }
}

/** POST /orders/:id/discount-total — set order discount total (rebooks flat booking discount); used at delivery settlement */
export const orderAdjustDiscountTotalBodySchema = z.object({
  discount_total: z.coerce.number().nonnegative(),
});

/** POST /orders/:id/stage */
export const orderSetStageBodySchema = z
  .object({
    expected_product_id: z.string().uuid().nullable().optional(),
    expected_line_version: z.number().int().nonnegative().optional(),
    item_id: z.string().uuid(),
    item_type: z.enum(['item', 'accessory']).default('item'),
    field: orderStageFieldSchema,
    value: z.boolean(),
  })
  .superRefine(rejectAccessoryItemToCollectStage);

/** POST /orders/:id/stage-bulk */
export const orderSetStageBulkBodySchema = z.object({
  expected_items: z.array(z.object({ item_id: z.string().uuid(), expected_product_id: z.string().uuid().nullable(), expected_line_version: z.number().int().nonnegative() })).max(500).optional(),
  field: orderStageFieldSchema,
  value: z.boolean(),
});

export const orderStageBatchRowSchema = z
  .object({
    expected_product_id: z.string().uuid().nullable().optional(),
    expected_line_version: z.number().int().nonnegative().optional(),
    item_id: z.string().uuid(),
    item_type: z.enum(['item', 'accessory']).default('item'),
    field: orderStageFieldSchema,
    value: z.boolean(),
  })
  .superRefine(rejectAccessoryItemToCollectStage);

/** POST /orders/:id/stage-batch */
export const orderSetStageBatchBodySchema = z.object({
  updates: z.array(orderStageBatchRowSchema).min(1).max(100),
  admin_password: z.string().min(1).optional(),
});

/** POST /orders/:id/reassign-salesman */
export const orderReassignSalesmanBodySchema = z.object({
  order_item_ids: z.array(z.string().uuid()).min(1).max(500),
  sales_person_id: z.string().uuid(),
});

/** POST /orders/:id/delivery-settlement */
export const orderDeliverySettlementBodySchema = z
  .object({
    idempotency_key: z.string().uuid(),
    discount_total: z.coerce.number().finite().min(0),
    deposit_amount: z.coerce.number().finite().min(0),
    security_status: z.enum(['unpaid', 'paid', 'returned']),
    security_amount: z.coerce.number().finite().min(0).default(0),
    security_account_id: z.string().uuid().nullable().optional(),
    receive_amount: z.coerce.number().finite().min(0).default(0),
    payment_account_id: z.string().uuid().nullable().optional(),
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    delivery_remark: z.string().trim().max(500).nullable().optional(),
    stage_updates: z.array(orderStageBatchRowSchema).max(500).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.security_amount > 0 && !value.security_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['security_account_id'],
        message: 'Security account is required when collecting security',
      });
    }
    if (value.receive_amount > 0 && !value.payment_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_account_id'],
        message: 'Payment account is required when receiving payment',
      });
    }
  });

/** POST /orders/:id/return-settlement */
export const orderReturnSettlementBodySchema = z
  .object({
    idempotency_key: z.string().uuid(),
    discount_total: z.coerce.number().finite().min(0),
    security_refund_amount: z.coerce.number().finite().min(0).default(0),
    refund_via: z.enum(['security', 'bank_cash']).nullable().optional(),
    refund_payment_account_id: z.string().uuid().nullable().optional(),
    refund_security_account_id: z.string().uuid().nullable().optional(),
    receive_amount: z.coerce.number().finite().min(0).default(0),
    payment_account_id: z.string().uuid().nullable().optional(),
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    return_remark: z.string().trim().max(500).nullable().optional(),
    security_charge_remarks: z.string().trim().max(500).nullable().optional(),
    charge_payment_account_id: z.string().uuid().nullable().optional(),
    condition_collect_amount: z.coerce.number().finite().nonnegative().default(0),
    condition_retain_amount: z.coerce.number().finite().nonnegative().default(0),
    condition_updates: z
      .array(
        z.object({
          item_id: z.string().uuid(),
          item_type: z.enum(['item', 'accessory']).default('item'),
          condition: z.enum(['normal', 'missing', 'damage']),
          expected_product_id: z.string().uuid().nullable().optional(),
          expected_line_version: z.number().int().nonnegative().optional(),
          condition_qty: z.coerce.number().int().positive().optional(),
          charge_amount: z.coerce.number().finite().nonnegative().optional(),
        })
      )
      .max(500)
      .default([]),
    reminder: z
      .object({
        reminder_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        reminder_time: z.string().trim().min(1).max(20),
      })
      .nullable()
      .optional(),
    stage_updates: z.array(orderStageBatchRowSchema).max(500).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.security_refund_amount > 0 && !value.refund_via) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refund_via'],
        message: 'Refund method is required when returning security',
      });
    }
    if (value.condition_collect_amount > 0 && !value.charge_payment_account_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['charge_payment_account_id'], message: 'Select an account for the condition deposit collected now' });
    }
    if (
      value.security_refund_amount > 0 &&
      value.refund_via === 'security' &&
      !value.refund_security_account_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refund_security_account_id'],
        message: 'Security account is required when returning security',
      });
    }
    if (
      value.security_refund_amount > 0 &&
      value.refund_via === 'bank_cash' &&
      !value.refund_payment_account_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refund_payment_account_id'],
        message: 'Bank or cash account is required when returning security',
      });
    }
    if (value.receive_amount > 0 && !value.payment_account_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment_account_id'],
        message: 'Payment account is required when receiving payment',
      });
    }
  });

const emptyQueryToUndef = (v) => (v === '' || v === undefined || v === null ? undefined : v);

const itemsToCollectIsoDate = z.preprocess(
  (v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  },
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
);

const itemStageSalesPersonIdSchema = z.union([z.string().uuid(), z.literal('none')]);

/** Comma-separated or repeated query param — filter lines by COALESCE(line, order) salesman. */
const itemStageSalesPersonIdsQuery = z.preprocess((v) => {
  const u = emptyQueryToUndef(v);
  if (u === undefined) return undefined;
  const raw = Array.isArray(u) ? u : String(u).split(',');
  const ids = [...new Set(raw.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  if (!ids.length) return undefined;
  return ids;
}, z.array(itemStageSalesPersonIdSchema).max(50).optional());

const skipEnrichQuery = z.preprocess((v) => {
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  if (v === false || v === 'false' || v === '0' || v === 0) return false;
  return undefined;
}, z.boolean().optional());

const linesModeQuery = z.preprocess((v) => {
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  return undefined;
}, z.boolean().optional());

/** GET /orders list options. Existing filters pass through to the service unchanged. */
export const orderListQuerySchema = z
  .object({
    with_audit_summary: linesModeQuery,
  })
  .passthrough();

const itemStageOrderIdsQuery = z.preprocess((v) => {
  const u = emptyQueryToUndef(v);
  if (u === undefined) return undefined;
  const raw = Array.isArray(u) ? u : String(u).split(',');
  const ids = [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  if (!ids.length) return undefined;
  return ids;
}, z.array(z.string().uuid()).max(200).optional());

/** GET /orders/items-to-collect — bookings or product lines (lines=1) pending item-to-collect */
export const itemsToCollectQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  per_page: z.coerce.number().int().positive().max(200).optional(),
  /** When true, returns product lines instead of one row per booking. */
  lines: linesModeQuery,
  /** Filter lines to these order ids (only with lines=1). */
  order_ids: itemStageOrderIdsQuery,
  /** Skip next-booking, availability, and accessory enrichment (faster export fetch). */
  skip_enrich: skipEnrichQuery,
  /** With lines=1 + order_ids: return every product line on the order (PDF export). */
  all_lines: skipEnrichQuery,
  search: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    if (u === undefined) return undefined;
    const s = String(u).trim();
    return s.length ? s.slice(0, 200) : undefined;
  }, z.string().max(200).optional()),
  sort: z.preprocess((v) => {
    const u = emptyQueryToUndef(v);
    return u === undefined ? undefined : String(u).trim().slice(0, 80);
  }, z.string().max(80).optional()),
  from: itemsToCollectIsoDate,
  to: itemsToCollectIsoDate,
  pickup_from: itemsToCollectIsoDate,
  pickup_to: itemsToCollectIsoDate,
  category_id: z.preprocess(emptyQueryToUndef, z.string().uuid().optional()),
  sales_person_ids: itemStageSalesPersonIdsQuery,
});

/** GET /orders/items-to-prepare — bookings (booked or item_to_collect) with ≥1 collected line and lines pending prepare */
export const itemsToPrepareQuerySchema = itemsToCollectQuerySchema.extend({
  /** `collected` | `pending` — omit for all lines pending prepare. */
  collect_status: z.preprocess(
    (v) => {
      const u = emptyQueryToUndef(v);
      if (u === undefined) return undefined;
      const s = String(u).trim().toLowerCase();
      if (s === 'collected' || s === 'pending') return s;
      return undefined;
    },
    z.enum(['collected', 'pending']).optional()
  ),
});

/** POST /orders/:id/checklist-combined-charge — one pending charge or note for all missing/damage lines */
export const orderChecklistCombinedChargeBodySchema = z
  .object({
    amount: z.coerce.number().min(0),
    remarks: z.preprocess((v) => {
      const s = String(v ?? '').trim();
      return s.length ? s.slice(0, 2000) : undefined;
    }, z.string().max(2000).optional()),
    payment_account_id: z.preprocess((v) => {
      const s = String(v ?? '').trim();
      return s.length ? s.slice(0, 80) : null;
    }, z.string().max(80).nullable().optional()),
  })
  .superRefine((data, ctx) => {
    const amount = Number(data.amount || 0);
    const remarks = String(data.remarks || '').trim();
    if (amount <= 0 && !remarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Remarks are required when charge amount is zero',
        path: ['remarks'],
      });
    }
  });

/** POST /orders/:id/condition */
export const orderSetConditionBodySchema = z
  .object({
    expected_product_id: z.string().uuid().nullable().optional(),
    expected_line_version: z.number().int().nonnegative().optional(),
    item_id: z.string().uuid(),
    item_type: z.enum(['item', 'accessory']).default('item'),
    damaged: z.boolean().optional(),
    missing: z.boolean().optional(),
    condition_qty: z.coerce.number().int().nonnegative().optional(),
    damage_charge: z.coerce.number().nonnegative().optional(),
    damage_account_id: z.string().trim().max(80).nullable().optional(),
    /** When true, do not create per-line security charges (combined checklist charge follows). */
    skip_checklist_line_security_sync: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.damaged !== undefined ||
      data.missing !== undefined ||
      data.condition_qty !== undefined ||
      data.damage_charge !== undefined ||
      data.damage_account_id !== undefined,
    { message: 'At least one condition field is required' }
  );

/** POST /orders/:id/checklist-command */
export const orderChecklistCommandSchema = z.object({
  idempotency_key: z.string().uuid(),
  expected_state_token: z.string().regex(/^[a-f0-9]{64}$/),
  stage_updates: z.array(orderStageBatchRowSchema).max(500).default([]),
  condition_updates: z.array(orderSetConditionBodySchema).max(500).default([]),
  combined_assessment: orderChecklistCombinedChargeBodySchema.optional(),
  admin_password: z.string().min(1).max(200).optional(),
}).superRefine((body, ctx) => {
  if (body.combined_assessment && !Number.isFinite(body.combined_assessment.amount)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['combined_assessment', 'amount'], message: 'Amount must be finite' });
  }
  if (body.condition_updates.some((row) => row.damage_charge !== undefined && !Number.isFinite(row.damage_charge))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['condition_updates'], message: 'Charge amounts must be finite' });
  }
  if (!body.stage_updates.length && !body.condition_updates.length && !body.combined_assessment) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No checklist changes supplied' });
  }
  for (const [field, rows] of [['stage_updates', body.stage_updates], ['condition_updates', body.condition_updates]]) {
    const keys = rows.map((row) => `${row.item_type}:${row.item_id}:${row.field || ''}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Duplicate checklist change' });
  }
});

/** DELETE /orders/:id */
export { shopAdminPasswordBodySchema as deleteOrderBodySchema } from './auth.js';
