/**
 * Interpret checklist stage_flags values (handles legacy string "true"/"false" in JSON).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStageFlagTruthy(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === 'true' || s === '1';
  }
  return false;
}

export const DEFAULT_PRODUCT_STAGE_FLAGS = {
  item_to_collect: false,
  prepared: false,
  delivered: false,
  received: false,
};

export const DEFAULT_ACCESSORY_STAGE_FLAGS = {
  prepared: false,
  delivered: false,
  received: false,
};

/**
 * @param {unknown} raw
 * @returns {object|null}
 */
export function parseStageFlagsJson(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Normalize product line stage_flags (legacy pre_check only when item_to_collect key absent).
 * @param {unknown} parsed
 * @returns {{ item_to_collect: boolean, prepared: boolean, delivered: boolean, received: boolean }}
 */
export function normalizeProductStageFlagsFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULT_PRODUCT_STAGE_FLAGS };
  }
  const flags = { ...DEFAULT_PRODUCT_STAGE_FLAGS };
  if (Object.prototype.hasOwnProperty.call(parsed, 'item_to_collect')) {
    flags.item_to_collect = isStageFlagTruthy(parsed.item_to_collect);
  } else if (Object.prototype.hasOwnProperty.call(parsed, 'pre_check')) {
    flags.item_to_collect = isStageFlagTruthy(parsed.pre_check);
  }
  flags.prepared = isStageFlagTruthy(parsed.prepared);
  flags.delivered = isStageFlagTruthy(parsed.delivered);
  flags.received = isStageFlagTruthy(parsed.received);
  return flags;
}

/**
 * @param {unknown} parsed
 * @returns {{ prepared: boolean, delivered: boolean, received: boolean }}
 */
export function normalizeAccessoryStageFlagsFromParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ...DEFAULT_ACCESSORY_STAGE_FLAGS };
  }
  return {
    prepared: isStageFlagTruthy(parsed.prepared),
    delivered: isStageFlagTruthy(parsed.delivered),
    received: isStageFlagTruthy(parsed.received),
  };
}

/**
 * Sync accessory checklist stages when given_status changes on booking edit.
 * @param {unknown} oldGivenStatus
 * @param {unknown} newGivenStatus
 * @param {unknown} persistedFlags
 * @param {{ isSell?: boolean }} [opts]
 * @returns {{ prepared: boolean, delivered: boolean, received: boolean }}
 */
export function syncAccessoryStageFlagsForGivenStatusChange(
  oldGivenStatus,
  newGivenStatus,
  persistedFlags,
  opts = {}
) {
  const { isSell = false } = opts;
  const flags = normalizeAccessoryStageFlagsFromParsed(persistedFlags);
  if (isSell) return flags;

  const oldS = String(oldGivenStatus ?? 'regular').trim();
  const newS = String(newGivenStatus ?? 'regular').trim();

  if (newS === 'given_with_rent') {
    return { ...flags, prepared: true, delivered: true };
  }
  if (oldS === 'given_with_rent' && newS !== 'given_with_rent') {
    return { ...flags, prepared: false, delivered: false };
  }
  return flags;
}

/**
 * Resolve accessory checklist stage flags for display (Process Order / checklist modal).
 * Given-with-rent rent accessories always show Prepared + Delivered ticked; others use stored flags.
 * @param {{ given_status?: unknown, accessory_order_status?: unknown, type?: unknown, stage_flags?: unknown }} accessory
 * @returns {{ prepared: boolean, delivered: boolean, received: boolean }}
 */
export function resolveAccessoryChecklistStageFlags(accessory) {
  const isSell = String(accessory?.type || 'rent').toLowerCase() === 'sell';
  const flags = normalizeAccessoryStageFlagsFromParsed(parseStageFlagsJson(accessory?.stage_flags));
  if (isSell) return flags;

  const raw = accessory?.given_status ?? accessory?.accessory_order_status ?? 'regular';
  const status = String(raw ?? 'regular').trim();
  if (status === 'given_with_rent') {
    return { ...flags, prepared: true, delivered: true };
  }
  return flags;
}

/**
 * @param {unknown} raw — object or JSON string from API/DB
 * @param {'item'|'accessory'} [itemType='item']
 */
export function parseStageFlagsRaw(raw, itemType = 'item') {
  const parsed = parseStageFlagsJson(raw);
  return itemType === 'accessory'
    ? normalizeAccessoryStageFlagsFromParsed(parsed)
    : normalizeProductStageFlagsFromParsed(parsed);
}

/**
 * Product flags for list tables (includes legacy pre_check in output for filters).
 * @param {unknown} raw
 */
export function parseItemLineStageFlagsFromRaw(raw) {
  const parsed = parseStageFlagsJson(raw);
  if (!parsed) {
    return {
      item_to_collect: false,
      pre_check: false,
      prepared: false,
      delivered: false,
      received: false,
    };
  }
  let item_to_collect;
  if (Object.prototype.hasOwnProperty.call(parsed, 'item_to_collect')) {
    item_to_collect = isStageFlagTruthy(parsed.item_to_collect);
  } else {
    item_to_collect = isStageFlagTruthy(parsed.pre_check);
  }
  return {
    item_to_collect,
    pre_check: isStageFlagTruthy(parsed.pre_check),
    prepared: isStageFlagTruthy(parsed.prepared),
    delivered: isStageFlagTruthy(parsed.delivered),
    received: isStageFlagTruthy(parsed.received),
  };
}

/** Product line is prepared or already handed over (delivery list product-wise filter). */
export function isDeliveryHandoverLine(item) {
  const flags = parseItemLineStageFlagsFromRaw(item?.stage_flags);
  return flags.prepared || flags.delivered;
}
