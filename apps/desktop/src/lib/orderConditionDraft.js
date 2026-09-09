/**
 * Condition draft helpers — used to defer Missing/Damaged/Charge changes from
 * `OrderChecklistPanel` until the user clicks Save changes / Save checklist.
 *
 * Keyed by `${item_type}:${id}` (same shape as stage draft keys).
 */

import { formatCurrency } from '@wrs/shared/utils/currency.js';

import { isSellLine } from './bookingAccessoryCart.js';

export function conditionRowKey(itemType, id) {
  const t = itemType === 'accessory' ? 'accessory' : 'item';
  return `${t}:${id}`;
}

function normalizeCondition(row) {
  const totalQty = Math.max(1, Number(row?.qty || 1));
  const savedConditionQty = row?.missing
    ? Number(row?.missing_qty || totalQty)
    : row?.damaged
      ? Number(row?.damaged_qty || totalQty)
      : 0;
  return {
    missing: !!row?.missing,
    damaged: !!row?.damaged,
    condition_qty: Math.min(totalQty, Math.max(0, savedConditionQty)),
    damage_charge: Number(row?.damage_charge || 0),
    damage_account_id: row?.damage_account_id || null,
  };
}

/** Parse amounts from combined checklist charge remarks (legacy orders). */
export function parseCombinedChargeRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text) return new Map();
  const map = new Map();
  let body = text.replace(/^Damage\/missing\s*·\s*/i, '');
  const totalIdx = body.indexOf(' · Total ');
  if (totalIdx >= 0) body = body.slice(0, totalIdx);
  for (const seg of body.split(';')) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const dashIdx = trimmed.lastIndexOf('—');
    if (dashIdx < 0) continue;
    const label = trimmed.slice(0, dashIdx).trim();
    const amountRaw = trimmed
      .slice(dashIdx + 1)
      .trim()
      .replace(/[₹,\s]/g, '');
    const n = Number(amountRaw);
    if (label && !Number.isNaN(n) && n >= 0) map.set(label, n);
  }
  return map;
}

/** Fill zero line charges from pending combined charge remarks when DB amounts were not stored. */
export function hydrateConditionDraftFromCombinedCharge(order, draft) {
  const pending = order?.pending_checklist_combined_charge;
  if (!pending?.remarks) return draft;
  const byLabel = parseCombinedChargeRemarks(pending.remarks);
  if (byLabel.size === 0) return draft;
  let next = { ...draft };
  for (const it of order?.items || []) {
    if (isSellLine(it)) continue;
    const key = conditionRowKey('item', it.id);
    const d = next[key] || normalizeCondition(it);
    if (!d.missing && !d.damaged) continue;
    if (Number(d.damage_charge || 0) > 0) continue;
    const amount = byLabel.get(lineLabelForFlaggedItem(it));
    if (amount == null) continue;
    next = { ...next, [key]: { ...d, damage_charge: amount } };
  }
  for (const a of order?.accessories || []) {
    if (isSellLine(a)) continue;
    const key = conditionRowKey('accessory', a.id);
    const d = next[key] || normalizeCondition(a);
    if (!d.missing && !d.damaged) continue;
    if (Number(d.damage_charge || 0) > 0) continue;
    const amount = byLabel.get(lineLabelForFlaggedAccessory(a));
    if (amount == null) continue;
    next = { ...next, [key]: { ...d, damage_charge: amount } };
  }
  return next;
}

export function buildConditionDraftMap(order) {
  const out = {};
  for (const it of order?.items || []) {
    out[conditionRowKey('item', it.id)] = normalizeCondition(it);
  }
  for (const a of order?.accessories || []) {
    out[conditionRowKey('accessory', a.id)] = normalizeCondition(a);
  }
  return hydrateConditionDraftFromCombinedCharge(order, out);
}

export function applyConditionPatchToDraft(draft, itemType, id, patch) {
  const key = conditionRowKey(itemType, id);
  const prev = draft?.[key] || {
    missing: false,
    damaged: false,
    damage_charge: 0,
    damage_account_id: null,
    condition_qty: 0,
  };
  const next = { ...prev };
  if (patch.missing !== undefined) next.missing = !!patch.missing;
  if (patch.damaged !== undefined) next.damaged = !!patch.damaged;
  if (next.missing && next.damaged) {
    if (patch.missing === true) next.damaged = false;
    else if (patch.damaged === true) next.missing = false;
  }
  if (patch.damage_charge !== undefined) next.damage_charge = Number(patch.damage_charge || 0);
  if (patch.condition_qty !== undefined) {
    next.condition_qty = Math.max(0, Math.floor(Number(patch.condition_qty) || 0));
  }
  if (!next.missing && !next.damaged) next.condition_qty = 0;
  if (patch.damage_account_id !== undefined) {
    const acc = patch.damage_account_id ? String(patch.damage_account_id).trim() : null;
    next.damage_account_id = acc || null;
  }
  if (Number(next.damage_charge || 0) <= 0) {
    next.damage_account_id = null;
  }
  return { ...draft, [key]: next };
}

/** @returns {Array<{ item_id, item_type, missing?, damaged?, damage_charge?, damage_account_id? }>} */
export function diffConditionDraft(order, draft) {
  const orig = buildConditionDraftMap(order);
  const out = [];
  for (const key of Object.keys(draft || {})) {
    const a = draft[key];
    const b = orig[key] || normalizeCondition(null);
    const patch = {};
    if (!!a.missing !== !!b.missing) patch.missing = !!a.missing;
    if (!!a.damaged !== !!b.damaged) patch.damaged = !!a.damaged;
    if (Number(a.damage_charge || 0) !== Number(b.damage_charge || 0)) {
      patch.damage_charge = Number(a.damage_charge || 0);
    }
    if (Number(a.condition_qty || 0) !== Number(b.condition_qty || 0)) {
      patch.condition_qty = Number(a.condition_qty || 0);
    }
    if (String(a.damage_account_id || '') !== String(b.damage_account_id || '')) {
      patch.damage_account_id = a.damage_account_id || null;
    }
    if (Object.keys(patch).length === 0) continue;
    const [itemType, id] = key.split(':');
    const line = itemType === 'item' ? order?.items?.find((item) => item.id === id) : null;
    out.push({
      item_id: id,
      item_type: itemType,
      ...patch,
      ...(line?.replacement_version != null
        ? {
            expected_product_id: line.product_id,
            expected_line_version: Number(line.replacement_version),
          }
        : {}),
    });
  }
  return out;
}

export function conditionDraftIsDirty(order, draft) {
  return diffConditionDraft(order, draft).length > 0;
}

/** Rent lines flagged missing or damaged in draft. */
export function countFlaggedConditionLines(order, draft) {
  let n = 0;
  for (const it of order?.items || []) {
    if (isSellLine(it)) continue;
    const key = conditionRowKey('item', it.id);
    const d = draft?.[key] || normalizeCondition(it);
    if (d.missing || d.damaged) n += 1;
  }
  for (const a of order?.accessories || []) {
    if (isSellLine(a)) continue;
    const key = conditionRowKey('accessory', a.id);
    const d = draft?.[key] || normalizeCondition(a);
    if (d.missing || d.damaged) n += 1;
  }
  return n;
}

function lineLabelForFlaggedItem(it) {
  const code = String(it.code_snapshot || '').trim();
  const name = String(it.name_snapshot || '').trim();
  return code && name ? `${code} — ${name}` : code || name || 'Product';
}

function lineLabelForFlaggedAccessory(a) {
  const cat = String(a.category_name || '').trim();
  const name = String(a.name_snapshot || '').trim();
  return cat && name ? `${cat} — ${name}` : cat || name || 'Accessory';
}

/** Sum draft damage_charge on rent lines flagged missing or damaged. */
export function sumFlaggedConditionCharges(order, draft) {
  let sum = 0;
  for (const it of order?.items || []) {
    if (isSellLine(it)) continue;
    const key = conditionRowKey('item', it.id);
    const d = draft?.[key] || normalizeCondition(it);
    if (!d.missing && !d.damaged) continue;
    sum += Number(d.damage_charge || 0);
  }
  for (const a of order?.accessories || []) {
    if (isSellLine(a)) continue;
    const key = conditionRowKey('accessory', a.id);
    const d = draft?.[key] || normalizeCondition(a);
    if (!d.missing && !d.damaged) continue;
    sum += Number(d.damage_charge || 0);
  }
  return sum;
}

/** @returns {Array<{ label: string, amount: number }>} — all flagged rent lines (amount may be 0). */
export function buildFlaggedConditionLineBreakdown(order, draft) {
  const lines = [];
  for (const it of order?.items || []) {
    if (isSellLine(it)) continue;
    const key = conditionRowKey('item', it.id);
    const d = draft?.[key] || normalizeCondition(it);
    if (!d.missing && !d.damaged) continue;
    lines.push({
      label: lineLabelForFlaggedItem(it),
      amount: Number(d.damage_charge || 0),
      condition: d.missing ? 'missing' : 'damage',
      conditionQty: Math.max(1, Number(d.condition_qty || it.qty || 1)),
      totalQty: Math.max(1, Number(it.qty || 1)),
    });
  }
  for (const a of order?.accessories || []) {
    if (isSellLine(a)) continue;
    const key = conditionRowKey('accessory', a.id);
    const d = draft?.[key] || normalizeCondition(a);
    if (!d.missing && !d.damaged) continue;
    lines.push({
      label: lineLabelForFlaggedAccessory(a),
      amount: Number(d.damage_charge || 0),
      condition: d.missing ? 'missing' : 'damage',
      conditionQty: Math.max(1, Number(d.condition_qty || 1)),
      totalQty: Math.max(1, Number(a.qty || 1)),
    });
  }
  return lines;
}

/** @returns {Array<{ label: string, amount: number }>} — flagged lines with charge > 0 only. */
export function buildCombinedChargeLineBreakdown(order, draft) {
  return buildFlaggedConditionLineBreakdown(order, draft).filter((l) => l.amount > 0);
}

/** True when save should show missing/damage confirmation modal. */
export function needsConditionConfirmOnSave(order, draft) {
  return countFlaggedConditionLines(order, draft) > 0;
}

/** True when combined charge requires a payment account (total > 0). */
export function needsCombinedChargeOnSave(order, draft) {
  return sumFlaggedConditionCharges(order, draft) > 0;
}

/** Remarks for combined checklist note: names for all flagged lines; amounts only when entered. */
export function buildConditionRemarksFromDraft(order, draft) {
  const breakdown = buildFlaggedConditionLineBreakdown(order, draft);
  if (!breakdown.length) return '';
  const total = sumFlaggedConditionCharges(order, draft);
  const parts = breakdown.map((line) => {
    const status = line.condition === 'missing' ? 'Missing' : 'Damage';
    const qty = line.totalQty > 1 ? ` (Qty ${line.conditionQty} of ${line.totalQty})` : '';
    return line.amount > 0
      ? `${status}: ${line.label}${qty} — ${formatCurrency(line.amount)}`
      : `${status}: ${line.label}${qty}`;
  });
  let text = parts.join('; ');
  if (total > 0) text += ` · Total ${formatCurrency(total)}`;
  return text;
}

/** @deprecated Use buildConditionRemarksFromDraft */
export function buildCombinedChargeRemarksWithAmounts(order, draft) {
  return buildConditionRemarksFromDraft(order, draft);
}

/** @deprecated Use buildConditionRemarksFromDraft */
export function buildCombinedChargeRemarksSuggestion(order, draft) {
  return buildConditionRemarksFromDraft(order, draft);
}

/**
 * Condition patches for API — persist missing/damaged and per-line amounts; account is modal-only.
 * @returns {Array<{ item_id, item_type, missing?, damaged?, damage_charge?, damage_account_id? }>}
 */
export function diffConditionDraftForSave(order, draft) {
  const diffs = diffConditionDraft(order, draft);
  return diffs.map((d) => {
    const out = { ...d };
    if (out.damage_account_id !== undefined) {
      delete out.damage_account_id;
    }
    return out;
  });
}

export function buildReturnConditionUpdates(order, draft, stageUpdates = []) {
  const diffs = diffConditionDraft(order, draft);
  const byKey = new Map();
  for (const diff of diffs) {
    const key = conditionRowKey(diff.item_type, diff.item_id);
    const row = draft?.[key] || {};
    const condition = row.missing ? 'missing' : row.damaged ? 'damage' : 'normal';
    byKey.set(key, {
      item_id: diff.item_id,
      item_type: diff.item_type === 'accessory' ? 'accessory' : 'item',
      ...(diff.expected_line_version != null
        ? {
            expected_product_id: diff.expected_product_id,
            expected_line_version: diff.expected_line_version,
          }
        : {}),
      condition,
      ...(condition === 'normal'
        ? {}
        : { condition_qty: Math.max(1, Number(row.condition_qty || 1)) }),
      charge_amount: Number(row.damage_charge || 0),
    });
  }
  for (const update of stageUpdates || []) {
    if (update?.field !== 'received' || update?.value !== true) continue;
    const itemType = update.item_type === 'accessory' ? 'accessory' : 'item';
    const key = conditionRowKey(itemType, update.item_id);
    if (byKey.has(key)) continue;
    const row = draft?.[key];
    if (!row?.missing && !row?.damaged) continue;
    byKey.set(key, {
      item_id: update.item_id,
      item_type: itemType,
      ...(update.expected_line_version != null
        ? {
            expected_product_id: update.expected_product_id,
            expected_line_version: update.expected_line_version,
          }
        : {}),
      condition: row.missing ? 'missing' : 'damage',
      condition_qty: Math.max(1, Number(row.condition_qty || 1)),
      charge_amount: Number(row.damage_charge || 0),
    });
  }
  return [...byKey.values()];
}

/** Preview for combined-charge modal on save. */
export function prepareCombinedChargeFromDraft(order, conditionDraft) {
  const lines = buildFlaggedConditionLineBreakdown(order, conditionDraft);
  const total = sumFlaggedConditionCharges(order, conditionDraft);
  const remarks = buildConditionRemarksFromDraft(order, conditionDraft);
  return { lines, total, remarks };
}
