import { badRequest } from '../../utils/errors.js';

function positiveWhole(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function accessoryConditionQuantity(line, condition, requestedQuantity) {
  const total = Math.max(1, positiveWhole(line?.qty, 1));
  if (condition === 'normal') return 0;
  const stored =
    condition === 'missing' ? positiveWhole(line?.missing_qty) : positiveWhole(line?.damaged_qty);
  const requested = positiveWhole(requestedQuantity, stored || total);
  return Math.min(total, requested);
}

/** Legacy stored quantities may be repaired on read, but explicit commands must not be clamped. */
export function requestedAccessoryConditionQuantity(line, condition, requestedQuantity) {
  if (requestedQuantity !== undefined) {
    const quantity = Number(requestedQuantity);
    const total = Math.max(1, positiveWhole(line?.qty, 1));
    if (!Number.isInteger(quantity) || !Number.isFinite(quantity) || quantity < 0) {
      throw badRequest('Affected accessory quantity must be a whole number');
    }
    if (condition === 'normal' && quantity !== 0) {
      throw badRequest('A normal accessory must have zero affected quantity');
    }
    if (condition !== 'normal' && (quantity < 1 || quantity > total)) {
      throw badRequest(`Affected accessory quantity must be between 1 and ${total}`);
    }
  }
  return accessoryConditionQuantity(line, condition, requestedQuantity);
}

export function accessoryUnavailableQuantity(line) {
  const total = Math.max(1, positiveWhole(line?.qty, 1));
  const damaged = line?.damaged ? positiveWhole(line?.damaged_qty, total) : 0;
  const missing = line?.missing ? positiveWhole(line?.missing_qty, total) : 0;
  return Math.min(total, damaged + missing);
}

export function accessoryWashableReturnQuantity(line) {
  return Math.max(0, positiveWhole(line?.qty, 1) - accessoryUnavailableQuantity(line));
}

export function lineBlocksReceivedByMissingQuantity(line) {
  if (!line?.missing) return false;
  const total = Math.max(1, positiveWhole(line?.qty, 1));
  return positiveWhole(line?.missing_qty, total) >= total;
}

export function hasBlockingProductCondition(items) {
  return (items || []).some((row) => !!row?.missing);
}
