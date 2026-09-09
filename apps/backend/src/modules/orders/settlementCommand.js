import { conflict } from '../../utils/errors.js';

export function parseSettlementCommand(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

export function canonicalCommand(value) {
  if (Array.isArray(value)) return value.map(canonicalCommand);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalCommand(value[key])])
    );
  }
  return value;
}

export function assertSettlementReplay(row, { shopId, orderId, userId, entity, payload }) {
  const saved = parseSettlementCommand(row.payload);
  if (
    row.shop_id !== shopId ||
    row.entity !== entity ||
    String(row.entity_id) !== String(orderId) ||
    row.user_id !== (userId || null)
  ) {
    throw conflict('Idempotency key has already been used for another operation');
  }
  if (
    JSON.stringify(canonicalCommand(saved.request)) !== JSON.stringify(canonicalCommand(payload))
  ) {
    throw conflict(
      'This action has already been submitted with different details. Refresh and review it.'
    );
  }
  if (row.status !== 'synced')
    throw conflict('This action is still processing; refresh before trying again');
  return saved;
}
