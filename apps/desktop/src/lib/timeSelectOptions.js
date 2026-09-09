import {
  defaultHalfHourTimes12,
  FALLBACK_DEFAULT_DELIVERY_TIME,
  FALLBACK_DEFAULT_RETURN_TIME,
  formatOrderTime12,
  normalizeTime12,
} from '@wrs/shared';

export { FALLBACK_DEFAULT_DELIVERY_TIME, FALLBACK_DEFAULT_RETURN_TIME };

/** Half-hour grid 6:00 AM–10:30 PM when the shop has no configured time slots. */
export const FALLBACK_TIME_OPTIONS = (() => {
  const out = [{ value: '', label: 'Select' }];
  for (const tv of defaultHalfHourTimes12()) {
    out.push({ value: tv, label: tv });
  }
  return out;
})();

/**
 * @param {Array<{ time_value: string }>} slots
 * @returns {{ value: string, label: string }[]}
 */
export function timeSlotsToSelectOptions(slots) {
  const out = [{ value: '', label: 'Select' }];
  if (!Array.isArray(slots)) return out;
  for (const s of slots) {
    const tv = normalizeTime12(s.time_value) || formatOrderTime12(s.time_value);
    if (!tv || tv === '—') continue;
    out.push({ value: tv, label: tv });
  }
  return out;
}

/**
 * @param {{ data?: Array<{ time_value?: string, is_default_delivery?: boolean, is_default_return?: boolean }>, defaults?: { default_delivery_time?: string, default_return_time?: string } }|null|undefined} listResponse
 * @returns {{ delivery: string, return: string }}
 */
export function resolveTimeSlotDefaults(listResponse) {
  const apiDefaults = listResponse?.defaults;
  if (apiDefaults?.default_delivery_time && apiDefaults?.default_return_time) {
    return {
      delivery: normalizeTime12(apiDefaults.default_delivery_time) || apiDefaults.default_delivery_time,
      return: normalizeTime12(apiDefaults.default_return_time) || apiDefaults.default_return_time,
    };
  }
  const slots = listResponse?.data || [];
  const deliveryRow = slots.find((s) => s.is_default_delivery);
  const returnRow = slots.find((s) => s.is_default_return);
  return {
    delivery:
      (deliveryRow && (normalizeTime12(deliveryRow.time_value) || formatOrderTime12(deliveryRow.time_value))) ||
      FALLBACK_DEFAULT_DELIVERY_TIME,
    return:
      (returnRow && (normalizeTime12(returnRow.time_value) || formatOrderTime12(returnRow.time_value))) ||
      FALLBACK_DEFAULT_RETURN_TIME,
  };
}
