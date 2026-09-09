import { z } from 'zod';

export const DEFAULT_LAUNDRY_PRIORITY_SETTINGS = {
  urgent_max_days: 1,
  high_max_days: 3,
  medium_max_days: 7,
};

export const laundryPrioritySettingsSchema = z
  .object({
    urgent_max_days: z.coerce.number().int().min(0).max(365),
    high_max_days: z.coerce.number().int().min(0).max(365),
    medium_max_days: z.coerce.number().int().min(0).max(365),
  })
  .superRefine((value, ctx) => {
    if (value.urgent_max_days > value.high_max_days) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['high_max_days'],
        message: 'High must be greater than or equal to Urgent',
      });
    }
    if (value.high_max_days > value.medium_max_days) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['medium_max_days'],
        message: 'Medium must be greater than or equal to High',
      });
    }
  });

/**
 * @param {unknown} value
 * @returns {{ urgent_max_days: number, high_max_days: number, medium_max_days: number }}
 */
export function normalizeLaundryPrioritySettings(value) {
  const parsed = laundryPrioritySettingsSchema.safeParse({
    ...DEFAULT_LAUNDRY_PRIORITY_SETTINGS,
    ...(value && typeof value === 'object' ? value : {}),
  });
  if (parsed.success) return parsed.data;
  return { ...DEFAULT_LAUNDRY_PRIORITY_SETTINGS };
}

/**
 * @param {number|null|undefined} daysLeft
 * @param {{ urgent_max_days?: number, high_max_days?: number, medium_max_days?: number }|null|undefined} settings
 * @returns {'Urgent'|'High'|'Medium'|'Low'|'No Schedule'}
 */
export function resolveLaundryPriority(daysLeft, settings) {
  if (daysLeft == null) return 'No Schedule';
  const normalized = normalizeLaundryPrioritySettings(settings);
  if (daysLeft <= normalized.urgent_max_days) return 'Urgent';
  if (daysLeft <= normalized.high_max_days) return 'High';
  if (daysLeft <= normalized.medium_max_days) return 'Medium';
  return 'Low';
}
