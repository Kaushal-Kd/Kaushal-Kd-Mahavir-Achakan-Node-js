import {
  DEFAULT_ACCESSORY_STAGE_FLAGS,
  DEFAULT_PRODUCT_STAGE_FLAGS,
  normalizeAccessoryStageFlagsFromParsed,
  normalizeProductStageFlagsFromParsed,
  parseStageFlagsJson,
  resolveAccessoryChecklistStageFlags,
} from '@wrs/shared/utils/stageFlags.js';

import {
  isGivenWithRentAccessory,
  isGivenWithRentLockedStage,
  isSellLine,
} from './bookingAccessoryCart.js';
import { checklistStageBlockedByAvailability } from './itemStageAvailability.js';
import { applyConditionPatchToDraft } from './orderConditionDraft.js';

/** Stage column order for product lines (matches checklist UI and backend). */
export const CHECKLIST_STAGE_KEYS_PRODUCT = [
  'item_to_collect',
  'prepared',
  'delivered',
  'received',
];

/** Stage keys for accessory lines (no item to collect). */
export const CHECKLIST_STAGE_KEYS_ACCESSORY = ['prepared', 'delivered', 'received'];

/** Sale lines have no checklist stages in the UI. */
export const CHECKLIST_STAGE_KEYS_SALE_PRODUCT = [];

/** Sale accessories — no checklist stages. */
export const CHECKLIST_STAGE_KEYS_SALE_ACCESSORY = [];

/** @deprecated Alias — product checklist columns; use CHECKLIST_STAGE_KEYS_PRODUCT for new code. */
export const CHECKLIST_STAGE_KEYS = CHECKLIST_STAGE_KEYS_PRODUCT;

export const CHECKLIST_STAGE_LABELS = {
  item_to_collect: 'Item to collect',
  prepared: 'Prepared',
  delivered: 'Delivered',
  received: 'Received',
};

/** Compact column titles for dense checklist tables (full label in `title`). */
export const CHECKLIST_STAGE_SHORT_LABELS = {
  item_to_collect: 'Collect',
  prepared: 'Prepared',
  delivered: 'Delivered',
  received: 'Received',
};

const STAGE_INDEX_BY_KEY_PRODUCT = CHECKLIST_STAGE_KEYS_PRODUCT.reduce(
  (acc, k, idx) => ({ ...acc, [k]: idx }),
  {}
);
const STAGE_INDEX_BY_KEY_ACCESSORY = CHECKLIST_STAGE_KEYS_ACCESSORY.reduce(
  (acc, k, idx) => ({ ...acc, [k]: idx }),
  {}
);
const STAGE_INDEX_BY_KEY_SALE_PRODUCT = CHECKLIST_STAGE_KEYS_SALE_PRODUCT.reduce(
  (acc, k, idx) => ({ ...acc, [k]: idx }),
  {}
);
const STAGE_INDEX_BY_KEY_SALE_ACCESSORY = CHECKLIST_STAGE_KEYS_SALE_ACCESSORY.reduce(
  (acc, k, idx) => ({ ...acc, [k]: idx }),
  {}
);

/**
 * @param {'item'|'accessory'} itemType
 * @param {{ isSale?: boolean }} [opts]
 */
export function getChecklistStageKeys(itemType, opts = {}) {
  const { isSale = false } = opts;
  if (isSale) {
    return itemType === 'accessory'
      ? CHECKLIST_STAGE_KEYS_SALE_ACCESSORY
      : CHECKLIST_STAGE_KEYS_SALE_PRODUCT;
  }
  return itemType === 'accessory' ? CHECKLIST_STAGE_KEYS_ACCESSORY : CHECKLIST_STAGE_KEYS_PRODUCT;
}

export function rowIsSaleChecklistLine(order, itemType, rowId) {
  const list = itemType === 'accessory' ? order?.accessories : order?.items;
  const row = (list || []).find((r) => String(r.id) === String(rowId));
  return row ? isSellLine(row) : false;
}

export function itemTypeFromChecklistRowKey(rowKey) {
  return String(rowKey || '').startsWith('accessory:') ? 'accessory' : 'item';
}

export function checklistRowKey(itemType, id) {
  const t = itemType === 'accessory' ? 'accessory' : 'item';
  return `${t}:${id}`;
}

function normalizeProductStageFlags(row) {
  return normalizeProductStageFlagsFromParsed(parseStageFlagsJson(row?.stage_flags));
}

function normalizeAccessoryStageFlags(row) {
  return normalizeAccessoryStageFlagsFromParsed(parseStageFlagsJson(row?.stage_flags));
}

function normalizeStageFlags(row, itemType) {
  return itemType === 'accessory'
    ? normalizeAccessoryStageFlags(row)
    : normalizeProductStageFlags(row);
}

function applyGivenWithRentLocksToDraft(draftMap, order) {
  if (!order?.accessories?.length) return draftMap;
  const next = { ...draftMap };
  for (const a of order.accessories) {
    if (!isGivenWithRentAccessory(a)) continue;
    const key = checklistRowKey('accessory', a.id);
    next[key] = resolveAccessoryChecklistStageFlags({
      ...a,
      stage_flags: next[key] || a.stage_flags,
    });
  }
  return next;
}

/**
 * @param {object|null|undefined} order
 * @returns {Record<string, object>}
 */
export function buildStageDraftMap(order) {
  const out = {};
  for (const it of order?.items || []) {
    out[checklistRowKey('item', it.id)] = normalizeStageFlags(it, 'item');
  }
  for (const a of order?.accessories || []) {
    out[checklistRowKey('accessory', a.id)] = resolveAccessoryChecklistStageFlags(a);
  }
  return out;
}

/**
 * Missing/damaged from server row merged with condition draft (draft wins when set).
 * @param {object} order
 * @param {Record<string, object>|null} conditionDraft
 * @param {'item'|'accessory'} itemType
 * @param {string} rowId
 */
export function effectiveLineCondition(order, conditionDraft, itemType, rowId) {
  const row = findOrderLine(order, itemType, rowId);
  const key = checklistRowKey(itemType, rowId);
  const draft = conditionDraft?.[key];
  return {
    missing: draft?.missing !== undefined ? !!draft.missing : !!row.missing,
    damaged: draft?.damaged !== undefined ? !!draft.damaged : !!row.damaged,
    conditionQty:
      draft?.condition_qty !== undefined
        ? Number(draft.condition_qty || 0)
        : row.missing
          ? Number(row.missing_qty || row.qty || 1)
          : Number(row.damaged_qty || row.qty || 1),
    totalQty: Math.max(1, Number(row?.qty || 1)),
  };
}

/** True when Received must not be set (this line is Missing). Damaged lines may still be received. */
export function lineBlocksReceived(order, conditionDraft, itemType, rowId) {
  const condition = effectiveLineCondition(order, conditionDraft, itemType, rowId);
  return condition.missing && condition.conditionQty >= condition.totalQty;
}

/** @returns {'self'|null} */
export function receivedBlockedReason(order, conditionDraft, itemType, rowId) {
  if (!lineBlocksReceived(order, conditionDraft, itemType, rowId)) return null;
  return 'self';
}

/** User-facing hint for disabled Received control. */
export function receivedBlockedMessage(order, conditionDraft, itemType, rowId) {
  if (receivedBlockedReason(order, conditionDraft, itemType, rowId)) {
    return 'Received disabled while Missing';
  }
  return undefined;
}

/** Rent accessories linked to a product line (excludes sale accessories). */
export function getLinkedRentAccessories(order, itemId) {
  return (order?.accessories || []).filter(
    (a) => !isSellLine(a) && String(a.order_item_id) === String(itemId)
  );
}

/** True when every linked accessory has received in the stage draft. */
export function allLinkedAccessoriesReceivedInDraft(order, itemId, draftMap) {
  const linked = getLinkedRentAccessories(order, itemId);
  if (linked.length === 0) return true;
  return linked.every((a) => {
    const key = checklistRowKey('accessory', a.id);
    const flags = draftMap?.[key];
    return !!flags?.received;
  });
}

/**
 * Bulk/quick-fill only: do not auto-mark product received while linked accessories are not all received.
 * Manual per-row Received toggles are not gated by this.
 */
export function productReceivedBlockedByAccessories(order, itemId, draftMap) {
  const linked = getLinkedRentAccessories(order, itemId);
  if (linked.length === 0) return false;
  return !allLinkedAccessoriesReceivedInDraft(order, itemId, draftMap);
}

/**
 * Clear Received (and later stages) for the given draft keys.
 * @param {Record<string, object>} stageDraft
 * @param {string[]} keys
 */
export function clearReceivedInStageDraft(stageDraft, keys) {
  const next = { ...stageDraft };
  for (const k of keys) {
    if (!next[k]) continue;
    const itemType = itemTypeFromChecklistRowKey(k);
    next[k] = applyStageToggleToRowFlags(next[k], itemType, 'received', false);
  }
  return next;
}

/** Keys to clear received when a line is marked missing (that line only). */
export function stageKeysToClearOnConditionIssue(order, itemType, rowId, patch) {
  if (patch.missing !== true) return [];
  const row = findOrderLine(order, itemType, rowId);
  const totalQty = Math.max(1, Number(row?.qty || 1));
  const missingQty = Math.max(1, Number(patch.condition_qty || totalQty));
  if (itemType === 'accessory' && missingQty < totalQty) return [];
  return [checklistRowKey(itemType, rowId)];
}

/**
 * Apply condition patch and clear received on affected lines when marking missing.
 * @returns {{ conditionDraft: Record<string, object>, stageDraft: Record<string, object> }}
 */
export function applyConditionPatchWithStageEffects(
  order,
  stageDraft,
  conditionDraft,
  itemType,
  id,
  patch
) {
  const row = findOrderLine(order, itemType, id);
  const effectivePatch = { ...patch };
  if (
    patch.damaged === true &&
    patch.damage_charge === undefined &&
    Number(conditionDraft?.[checklistRowKey(itemType, id)]?.damage_charge || 0) <= 0
  ) {
    const chargeQty =
      itemType === 'accessory'
        ? Math.max(1, Number(effectivePatch.condition_qty ?? row?.qty ?? 1))
        : Math.max(1, Number(row?.qty || 1));
    effectivePatch.damage_charge =
      Number(row?.catalog_price_sell || row?.price_sell || 0) * chargeQty;
  }
  const nextCondition = applyConditionPatchToDraft(
    conditionDraft || {},
    itemType,
    id,
    effectivePatch
  );
  let nextStage = stageDraft || {};
  const clearKeys = stageKeysToClearOnConditionIssue(order, itemType, id, effectivePatch);
  if (clearKeys.length) {
    nextStage = clearReceivedInStageDraft(nextStage, clearKeys);
  }
  if (effectivePatch.damaged === true) {
    const key = checklistRowKey(itemType, id);
    const flags = nextStage[key];
    if (flags?.delivered) {
      nextStage = {
        ...nextStage,
        [key]: applyStageToggleToRowFlags(flags, itemType, 'received', true),
      };
    }
  }
  return { conditionDraft: nextCondition, stageDraft: nextStage };
}

/** Mirrors backend `canBulkStageTransition` for quick-fill. */
export function canBulkEnableStage(field, flags, itemType = 'item', isSale = false) {
  if (isSale) return false;
  if (itemType === 'accessory' && field === 'item_to_collect') return false;
  if (field === 'prepared') {
    return itemType === 'accessory' ? true : !!flags.item_to_collect;
  }
  if (field === 'delivered') return !!flags.prepared;
  if (field === 'received') return !!flags.delivered;
  return true;
}

/**
 * Set `field` true on every row where transition rules allow (draft-only).
 * @param {Record<string, object>} draftMap
 * @param {string} field
 * @returns {Record<string, object>}
 */
export function applyBulkStageTrueToDraft(draftMap, field, order = null, conditionDraft = null) {
  const next = {};
  for (const [k, flags] of Object.entries(draftMap)) {
    next[k] = { ...flags };
  }
  if (field === 'prepared') {
    for (const k of Object.keys(next)) {
      const itemType = itemTypeFromChecklistRowKey(k);
      if (itemType !== 'item') continue;
      const rowId = k.split(':')[1];
      if (order && rowIsSaleChecklistLine(order, itemType, rowId)) continue;
      if (!next[k].item_to_collect) {
        if (
          order &&
          checklistStageBlockedByAvailability(
            itemType,
            'item_to_collect',
            findOrderLine(order, itemType, rowId),
            true
          )
        ) {
          continue;
        }
        next[k] = { ...next[k], item_to_collect: true };
      }
    }
  }
  const allKeys = Object.keys(next);
  const keyPasses =
    field === 'received'
      ? [
          allKeys.filter((k) => itemTypeFromChecklistRowKey(k) === 'accessory'),
          allKeys.filter((k) => itemTypeFromChecklistRowKey(k) === 'item'),
        ]
      : [allKeys];
  for (const passKeys of keyPasses) {
    for (const k of passKeys) {
      const itemType = itemTypeFromChecklistRowKey(k);
      const rowId = k.split(':')[1];
      const isSale = order ? rowIsSaleChecklistLine(order, itemType, rowId) : false;
      if (isSale) continue;
      if (itemType === 'accessory' && field === 'item_to_collect') continue;
      if (
        field === 'received' &&
        order &&
        lineBlocksReceived(order, conditionDraft, itemType, rowId)
      ) {
        continue;
      }
      if (
        field === 'received' &&
        order &&
        itemType === 'item' &&
        productReceivedBlockedByAccessories(order, rowId, next)
      ) {
        continue;
      }
      if (
        order &&
        checklistStageBlockedByAvailability(
          itemType,
          field,
          findOrderLine(order, itemType, rowId),
          true
        )
      ) {
        continue;
      }
      const flags = { ...next[k] };
      if (!canBulkEnableStage(field, flags, itemType, isSale)) continue;
      flags[field] = true;
      next[k] = flags;
    }
  }
  return applyGivenWithRentLocksToDraft(next, order);
}

/** True when persisting these updates would newly mark at least one line delivered. */
export function stageUpdatesIncludeNewDelivered(updates) {
  return (updates || []).some((u) => u.field === 'delivered' && u.value === true);
}

/** True when persisting these updates would newly mark at least one line prepared. */
export function stageUpdatesIncludeNewPrepared(updates) {
  return (updates || []).some((u) => u.field === 'prepared' && u.value === true);
}

/** True when persisting these updates would newly mark at least one line received. */
export function stageUpdatesIncludeNewReceived(updates) {
  return (updates || []).some((u) => u.field === 'received' && u.value === true);
}

/** True when persisting these updates would uncheck Delivered and/or Received on any line. */
export function stageUpdatesRequireAdminPassword(updates) {
  return (updates || []).some(
    (u) => u.value === false && (u.field === 'delivered' || u.field === 'received')
  );
}

export function applyUpdatesToStageDraft(order, updates) {
  const draft = buildStageDraftMap(order);
  for (const u of updates || []) {
    const key = checklistRowKey(u.item_type, u.item_id);
    if (!draft[key]) continue;
    draft[key] = { ...draft[key], [u.field]: !!u.value };
  }
  return draft;
}

function relevantRowsForStageFlag(draftMap, order = null) {
  const keys = Object.keys(draftMap);
  if (!order) return keys;
  return keys.filter((k) => {
    const itemType = itemTypeFromChecklistRowKey(k);
    const rowId = k.split(':')[1];
    return !rowIsSaleChecklistLine(order, itemType, rowId);
  });
}

function allRowsHaveStageFlag(draftMap, field, order = null) {
  const keys = relevantRowsForStageFlag(draftMap, order);
  if (keys.length === 0) return true;
  return keys.every((k) => !!draftMap[k]?.[field]);
}

/** Whether every product + accessory line already has this checklist stage. */
export function isOrderFullyAtStage(order, field) {
  return allRowsHaveStageFlag(buildStageDraftMap(order), field, order);
}

/**
 * After applying `updates`, every line has `field` true and at least one line did not before.
 * Used so WhatsApp fires once per order when the last item completes a stage.
 */
export function orderJustCompletedAllStage(order, updates, field) {
  if (!order || !updates?.length) return false;
  const before = buildStageDraftMap(order);
  const after = applyUpdatesToStageDraft(order, updates);
  return orderJustCompletedAllStageFromDrafts(before, after, field, order);
}

/**
 * Compare pre-save server draft vs post-save UI draft (full checklist state).
 * More reliable than diff-only updates when bulk toggles or many lines change at once.
 */
export function orderJustCompletedAllStageFromDrafts(beforeDraft, afterDraft, field, order = null) {
  if (!beforeDraft || !afterDraft) return false;
  if (!allRowsHaveStageFlag(afterDraft, field, order)) return false;
  return !allRowsHaveStageFlag(beforeDraft, field, order);
}

/**
 * WhatsApp template keys when saved checklist draft completes all-items prepared / received.
 * @param {object} order — order as loaded before save
 * @param {Record<string, object>} stageDraftAfter — full draft being persisted
 * @param {{ excludeDelivered?: boolean }} [opts]
 * @returns {string[]}
 */
export function templatesTriggeredByStageDraft(order, stageDraftAfter, opts = {}) {
  const { excludeDelivered = false } = opts;
  if (!order || !stageDraftAfter) return [];
  const before = buildStageDraftMap(order);
  const keys = [];
  if (orderJustCompletedAllStageFromDrafts(before, stageDraftAfter, 'prepared', order)) {
    keys.push('BILL_PREPARED');
  }
  if (
    !excludeDelivered &&
    orderJustCompletedAllStageFromDrafts(before, stageDraftAfter, 'delivered', order)
  ) {
    keys.push('BILL_DELIVER');
  }
  if (orderJustCompletedAllStageFromDrafts(before, stageDraftAfter, 'received', order)) {
    keys.push('BILL_RETURN');
  }
  return keys;
}

/**
 * WhatsApp template keys when an order just completed all-items prepared / received.
 * Delivered is handled via delivery settlement (excludeDelivered here).
 * @param {object} order
 * @param {Array<{ field: string, value: boolean, item_id: string, item_type: string }>} updates
 * @param {{ excludeDelivered?: boolean }} [opts]
 * @returns {string[]}
 */
export function templatesTriggeredByStageUpdates(order, updates, opts = {}) {
  const { excludeDelivered = false } = opts;
  if (!order || !updates?.length) return [];
  const after = applyUpdatesToStageDraft(order, updates);
  return templatesTriggeredByStageDraft(order, after, { excludeDelivered });
}

export function diffStageUpdates(order, draftMap, conditionDraft = null) {
  const updates = [];
  for (const it of order?.items || []) {
    const key = checklistRowKey('item', it.id);
    const server = normalizeStageFlags(it, 'item');
    const draft = draftMap[key] || server;
    const isSale = isSellLine(it);
    for (const field of getChecklistStageKeys('item', { isSale })) {
      if (!!server[field] !== !!draft[field]) {
        const value = !!draft[field];
        if (
          field === 'received' &&
          value &&
          lineBlocksReceived(order, conditionDraft, 'item', it.id)
        ) {
          continue;
        }
        updates.push({ item_id: it.id, item_type: 'item', field, value,
          ...(it.product_id && it.replacement_version != null ? {
            expected_product_id: it.product_id,
            expected_line_version: Number(it.replacement_version),
          } : {}),
        });
      }
    }
  }
  for (const a of order?.accessories || []) {
    const key = checklistRowKey('accessory', a.id);
    const server = normalizeStageFlags(a, 'accessory');
    const draft = draftMap[key] || server;
    const isSale = isSellLine(a);
    for (const field of getChecklistStageKeys('accessory', { isSale })) {
      if (isGivenWithRentLockedStage(a, field)) continue;
      if (!!server[field] !== !!draft[field]) {
        const value = !!draft[field];
        if (
          field === 'received' &&
          value &&
          lineBlocksReceived(order, conditionDraft, 'accessory', a.id)
        ) {
          continue;
        }
        updates.push({ item_id: a.id, item_type: 'accessory', field, value });
      }
    }
  }
  return updates;
}

/**
 * Apply a single stage toggle to one row's flags (fills prior stages when checking forward).
 * @param {object} flags
 * @param {'item'|'accessory'} itemType
 * @param {string} stageKey
 * @param {boolean} value
 * @param {boolean} [isSale]
 */
export function applyStageToggleToRowFlags(flags, itemType, stageKey, value, isSale = false) {
  const keys = getChecklistStageKeys(itemType, { isSale });
  const next = { ...flags };
  if (value) {
    const idx = keys.indexOf(stageKey);
    if (idx < 0) {
      next[stageKey] = true;
      return next;
    }
    if (
      itemType === 'item' &&
      keys.includes('prepared') &&
      stageKey === 'prepared' &&
      !next.item_to_collect
    ) {
      next.item_to_collect = true;
    }
    for (let i = 0; i <= idx; i += 1) next[keys[i]] = true;
    return next;
  }
  const idx = keys.indexOf(stageKey);
  if (idx >= 0) {
    for (let i = idx; i < keys.length; i += 1) next[keys[i]] = false;
  } else {
    next[stageKey] = false;
  }
  return next;
}

export function getFirstMissingPreviousStageKey(
  stageKey,
  stageFlags,
  itemType = 'item',
  isSale = false
) {
  const keys = getChecklistStageKeys(itemType, { isSale });
  const indexByKey = isSale
    ? itemType === 'accessory'
      ? STAGE_INDEX_BY_KEY_SALE_ACCESSORY
      : STAGE_INDEX_BY_KEY_SALE_PRODUCT
    : itemType === 'accessory'
      ? STAGE_INDEX_BY_KEY_ACCESSORY
      : STAGE_INDEX_BY_KEY_PRODUCT;
  const targetIndex = indexByKey[stageKey];
  if (targetIndex === undefined || targetIndex <= 0) return null;
  for (let i = 0; i < targetIndex; i += 1) {
    const prev = keys[i];
    if (!stageFlags?.[prev]) return prev;
  }
  return null;
}

function firstMissingChainInFlags(flags, itemType = 'item', isSale = false) {
  if (isSale) return null;
  if (itemType === 'item' && flags.prepared && !flags.item_to_collect) return 'item_to_collect';
  if (flags.delivered && !flags.prepared) return 'prepared';
  if (flags.received && !flags.delivered) return 'delivered';
  return null;
}

/**
 * Validate full draft before persisting (settlement / ordering).
 * @param {object} order
 * @param {Record<string, object>} draftMap
 * @param {{ skipReturnDepositGate?: boolean }} [opts] — bulk draft edits skip deposit gate (handled on Save → return modal)
 * @returns {{ ok: true } | { ok: false, message: string, requireSettlement?: boolean, settlementKind?: 'delivery'|'return' }}
 */
export function validateStageDraft(order, draftMap, opts = {}) {
  if (!order) return { ok: false, message: 'Order not loaded' };
  const keys = Object.keys(draftMap);
  if (keys.length === 0) return { ok: true };

  const rentKeys = keys.filter((k) => {
    const itemType = itemTypeFromChecklistRowKey(k);
    const rowId = k.split(':')[1];
    return !rowIsSaleChecklistLine(order, itemType, rowId);
  });
  const allReceived = rentKeys.length > 0 && rentKeys.every((k) => draftMap[k]?.received);
  if (
    !opts.skipReturnDepositGate &&
    allReceived &&
    Number(order.deposit_amount || 0) > 0 &&
    !order.deposit_returned
  ) {
    return {
      ok: false,
      message: 'Mark security deposit as returned before completing all returns.',
      requireSettlement: true,
      settlementKind: 'return',
    };
  }

  for (const k of keys) {
    const itemType = itemTypeFromChecklistRowKey(k);
    const rowId = k.split(':')[1];
    const isSale = rowIsSaleChecklistLine(order, itemType, rowId);
    const miss = firstMissingChainInFlags(draftMap[k] || {}, itemType, isSale);
    if (miss) {
      return {
        ok: false,
        message: `Invalid stages: complete earlier steps before later ones (row ${k}).`,
      };
    }
  }

  return { ok: true };
}

/** @param {Array<{ item_id: string, item_type: string, field: string, value: boolean }>} updates */
export function chunkStageUpdates(updates, size = 100) {
  if (updates.length <= size) return [updates];
  const chunks = [];
  for (let i = 0; i < updates.length; i += size) {
    chunks.push(updates.slice(i, i + size));
  }
  return chunks;
}

/**
 * Per-toggle validation before merging into draft (warnings + settlement gates).
 * @returns {{ ok: true } | { ok: false, kind: 'warning'|'settlement', message: string, settlementKind?: 'delivery'|'return' }}
 */
export function validateStageToggleIntent(
  order,
  draftMap,
  itemType,
  rowId,
  field,
  value,
  conditionDraft = null
) {
  const isSale = rowIsSaleChecklistLine(order, itemType, rowId);
  if (isSale) {
    return {
      ok: false,
      kind: 'warning',
      message: 'Checklist stages do not apply to sale items.',
    };
  }
  if (itemType === 'accessory' && field === 'item_to_collect') {
    return {
      ok: false,
      kind: 'warning',
      message: 'Item to collect does not apply to accessories.',
    };
  }
  if (field === 'received' && value && lineBlocksReceived(order, conditionDraft, itemType, rowId)) {
    return {
      ok: false,
      kind: 'warning',
      message: 'Cannot mark Received while this line is Missing.',
    };
  }

  const row = findOrderLine(order, itemType, rowId);
  if (isGivenWithRentLockedStage(row, field)) {
    return {
      ok: false,
      kind: 'warning',
      message: 'Given with rent — Prepared/Delivered are completed at booking',
    };
  }

  const key = checklistRowKey(itemType, rowId);
  const prior = {
    ...(itemType === 'accessory' ? DEFAULT_ACCESSORY_STAGE_FLAGS : DEFAULT_PRODUCT_STAGE_FLAGS),
    ...(draftMap[key] || {}),
  };

  if (value) {
    const miss = getFirstMissingPreviousStageKey(field, prior, itemType, isSale);
    if (miss) {
      return {
        ok: false,
        kind: 'warning',
        message: `Complete "${CHECKLIST_STAGE_LABELS[miss] || miss}" first for this item.`,
      };
    }
  }
  return { ok: true };
}

function findOrderLine(order, itemType, rowId) {
  const list = itemType === 'accessory' ? order?.accessories : order?.items;
  return (list || []).find((r) => String(r.id) === String(rowId)) || {};
}

/**
 * Lines that bulk Received would skip because this line is Missing.
 * @param {object} order
 * @param {Record<string, object>} draftMap
 * @param {Record<string, object>|null} conditionDraft
 */
export function countReceivedBulkSkipped(order, draftMap, conditionDraft = null) {
  if (!order || !draftMap) return 0;
  let n = 0;
  for (const k of Object.keys(draftMap)) {
    if (draftMap[k]?.received) continue;
    const itemType = itemTypeFromChecklistRowKey(k);
    const rowId = k.split(':')[1];
    if (order && rowIsSaleChecklistLine(order, itemType, rowId)) continue;
    if (lineBlocksReceived(order, conditionDraft, itemType, rowId)) n += 1;
  }
  return n;
}

/**
 * Synthetic checklist payload for instant UI when toggling a stage (matches server merge shape).
 */
export function buildOptimisticStageLinePayload(order, vars) {
  if (!order) return null;
  const itemType = vars.item_type ?? vars.itemType ?? 'item';
  const rowId = vars.item_id ?? vars.id;
  const field = vars.field;
  const value = !!vars.value;
  const row = findOrderLine(order, itemType, rowId);
  const flags = { ...normalizeStageFlags(row, itemType), [field]: value };
  if (itemType === 'accessory') {
    return {
      lines: [
        {
          item_type: 'accessory',
          id: rowId,
          stage_flags: normalizeAccessoryStageFlags({ stage_flags: flags }),
        },
      ],
    };
  }
  return {
    lines: [
      {
        item_type: 'item',
        id: rowId,
        stage_flags: flags,
        prepared_at:
          field === 'prepared' && value ? new Date().toISOString() : (row.prepared_at ?? null),
        delivered_at:
          field === 'delivered' && value ? new Date().toISOString() : (row.delivered_at ?? null),
        received_at:
          field === 'received' && value ? new Date().toISOString() : (row.received_at ?? null),
      },
    ],
  };
}

export function checklistStageRowKey(vars) {
  const itemType = vars.item_type ?? vars.itemType ?? 'item';
  const rowId = vars.item_id ?? vars.id;
  return `${itemType}:${rowId}`;
}

export function checklistConditionRowKey(vars) {
  return checklistStageRowKey(vars);
}

/**
 * Merge lightweight checklist mutation payloads into a cached full order object.
 * @param {object|null|undefined} prev
 * @param {{ order?: object, lines?: Array<object>, payments?: Array<object> }} payload
 * @returns {object|null|undefined}
 */
export function mergeOrderChecklistPayload(prev, payload) {
  if (!prev || !payload || typeof payload !== 'object') return prev;
  const next = { ...prev };
  if (payload.order && typeof payload.order === 'object') {
    for (const [k, v] of Object.entries(payload.order)) {
      if (v !== undefined) next[k] = v;
    }
  }
  if (Array.isArray(payload.payments)) {
    next.payments = payload.payments;
  }
  if (Array.isArray(payload.lines)) {
    for (const line of payload.lines) {
      if (!line || line.id == null) continue;
      const listKey = line.item_type === 'accessory' ? 'accessories' : 'items';
      const arr = next[listKey];
      if (!Array.isArray(arr)) continue;
      const idx = arr.findIndex((r) => r.id === line.id);
      if (idx < 0) continue;
      const { item_type: _itemType, ...patch } = line;
      const copy = [...arr];
      copy[idx] = { ...arr[idx], ...patch };
      next[listKey] = copy;
    }
  }
  return next;
}
