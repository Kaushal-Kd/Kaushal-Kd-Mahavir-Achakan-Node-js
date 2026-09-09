import { useCallback, useEffect, useRef, useState } from 'react';

import { applyConditionPatchToDraft, buildConditionDraftMap, diffConditionDraftForSave, prepareCombinedChargeFromDraft } from './orderConditionDraft.js';
import { applyUpdatesToStageDraft, buildStageDraftMap, diffStageUpdates, stageUpdatesIncludeNewDelivered } from './orderChecklistMerge.js';

export const MIXED_DELIVERY_CONDITION_MESSAGE = 'Unselect the new Delivered ticks and save the condition changes first, then use delivery settlement. Nothing has been saved.';

export function buildChecklistSaveCommand({ order, stageDraft, conditionDraft, stageUpdates, combinedCharge = null, adminPassword }) {
  const updates = stageUpdates ?? diffStageUpdates(order, stageDraft ?? buildStageDraftMap(order), conditionDraft);
  const conditions = diffConditionDraftForSave(order, conditionDraft);
  if (stageUpdatesIncludeNewDelivered(updates) && conditions.length) throw new Error(MIXED_DELIVERY_CONDITION_MESSAGE);
  const amount = Number(combinedCharge?.amount ?? 0);
  if (combinedCharge && (!['number', 'string'].includes(typeof combinedCharge.amount) || !Number.isFinite(amount) || amount < 0)) {
    throw new Error('Review the combined charge amount before saving.');
  }
  if (combinedCharge && amount > 0 && !String(combinedCharge.accountId || '').trim()) {
    throw new Error('Select account for combined charge');
  }
  return { order, stageUpdates: updates, conditionUpdates: conditions, combinedCharge, adminPassword };
}

export async function saveChecklistDraft({ submit, ...draft }) {
  return submit(buildChecklistSaveCommand(draft));
}

export function shouldSendChecklistWhatsApp(result) {
  return Boolean(result?.order) && !result.queued && !result.replayed;
}

export function prepareChecklistCombinedReview(order, conditionDraft) {
  const preview = prepareCombinedChargeFromDraft(order, conditionDraft);
  if (order?.pending_checklist_combined_charge && preview.total === 0 && !preview.remarks) {
    return { ...preview, remarks: 'Conditions corrected; combined missing/damage assessment reset to zero.' };
  }
  return preview;
}

/** Validate every selected booking before enqueuing the first independently atomic command. */
export function buildItemToCollectCommands(selectedLines, pendingEntries = []) {
  const pendingOrders = new Set(pendingEntries.map((entry) => String(entry.entityId)));
  const commands = new Map();
  for (const line of selectedLines.values()) {
    const orderId = String(line.order_id || '');
    if (pendingOrders.has(orderId)) throw new Error('A selected booking has a pending checklist save. Review Pending sync before changing it again.');
    if (!orderId || !/^[a-f\d]{64}$/.test(line.checklist_state_token || '') || !line.product_id ||
        line.replacement_version == null || !Number.isInteger(Number(line.replacement_version))) {
      throw new Error('Clear the selection, refresh the list and reselect these lines. Their original checklist state is unavailable.');
    }
    let command = commands.get(orderId);
    if (!command) {
      command = { orderId, order: { id: orderId, checklist_state_token: line.checklist_state_token }, stageUpdates: [] };
      commands.set(orderId, command);
    }
    if (command.order.checklist_state_token !== line.checklist_state_token) {
      throw new Error('Selected lines from the same booking have different checklist versions. Clear the selection, refresh and reselect them together.');
    }
    command.stageUpdates.push({ item_id: line.id, item_type: 'item', field: 'item_to_collect', value: true,
      expected_product_id: line.product_id, expected_line_version: Number(line.replacement_version) });
    if (command.stageUpdates.length > 500) throw new Error('Select at most 500 lines from one booking in a single save.');
  }
  if (!commands.size) throw new Error('Select at least one product line');
  return [...commands.values()];
}

export async function saveItemToCollectCommands({ selectedLines, pendingEntries, submit }) {
  const commands = buildItemToCollectCommands(selectedLines, pendingEntries);
  let savedLineCount = 0;
  let queuedLineCount = 0;
  for (const { orderId, ...command } of commands) {
    try {
      const result = await submit(orderId, command);
      if (result.queued) queuedLineCount += command.stageUpdates.length;
      else savedLineCount += command.stageUpdates.length;
    } catch (error) {
      const message = error?.response?.data?.error?.message || error?.message || 'Checklist save failed';
      const accepted = savedLineCount + queuedLineCount;
      throw new Error(accepted
        ? `${accepted} line(s) already saved or queued before this booking failed: ${message}. Review Pending sync, clear the selection and reselect only remaining lines.`
        : message, { cause: error });
    }
  }
  return { savedLineCount, queuedLineCount };
}

/** Rebuild stage/condition drafts from a saved order snapshot. */
export function draftsFromOrder(order) {
  if (!order) return { stageDraft: null, conditionDraft: null };
  return {
    stageDraft: buildStageDraftMap(order),
    conditionDraft: buildConditionDraftMap(order),
  };
}

/** Pending changes are display-only; their original token remains on the queued command. */
export function draftsFromPendingChecklist(order, payload) {
  let conditionDraft = buildConditionDraftMap(order);
  for (const update of payload?.condition_updates || []) {
    const { item_type, item_id, ...patch } = update;
    conditionDraft = applyConditionPatchToDraft(conditionDraft, item_type, item_id, patch);
  }
  return { conditionDraft, stageDraft: applyUpdatesToStageDraft(order, payload?.stage_updates || []) };
}

/** Keep the original base until an explicit reset or a confirmed pending command finishes. */
export function useChecklistDraftState(order, pendingEntry, { enabled = true, scopeKey = order?.id, refetch } = {}) {
  const [draftOrder, setDraftOrder] = useState(null);
  const [stageDraft, setStageDraft] = useState(null);
  const [conditionDraft, setConditionDraft] = useState(null);
  const [refreshingDraft, setRefreshingDraft] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const active = useRef({ scope: null, pendingId: null, base: null });
  const resetDrafts = useCallback((savedOrder) => {
    active.current.base = savedOrder;
    const drafts = draftsFromOrder(savedOrder);
    setDraftOrder(savedOrder); setStageDraft(drafts.stageDraft); setConditionDraft(drafts.conditionDraft);
    setRefreshError('');
  }, []);
  const refreshDrafts = useCallback(async () => {
    const scope = active.current.scope;
    if (active.current.pendingId || !refetch) return;
    setRefreshingDraft(true);
    try {
      const result = await refetch();
      if (active.current.scope !== scope || active.current.pendingId) return;
      if (result.isError || !result.data) throw new Error('Could not refresh the saved booking.');
      resetDrafts(result.data);
    } catch (error) {
      if (active.current.scope === scope && !active.current.pendingId) {
        setRefreshError(error?.message || 'Could not refresh the saved booking.');
      }
    } finally {
      if (active.current.scope === scope) setRefreshingDraft(false);
    }
  }, [refetch, resetDrafts]);
  useEffect(() => {
    if (!enabled) {
      active.current = { scope: null, pendingId: null, base: null };
      setDraftOrder(null); setStageDraft(null); setConditionDraft(null); setRefreshingDraft(false);
      setRefreshError('');
      return;
    }
    if (!order || !scopeKey) return;
    if (active.current.scope !== scopeKey) {
      active.current = { scope: scopeKey, pendingId: null, base: order };
      setRefreshingDraft(false);
      resetDrafts(order);
    }
    if (pendingEntry) {
      if (active.current.pendingId !== pendingEntry.id) {
        active.current.pendingId = pendingEntry.id;
        const drafts = draftsFromPendingChecklist(active.current.base || order, pendingEntry.payload);
        setStageDraft(drafts.stageDraft); setConditionDraft(drafts.conditionDraft);
      }
    } else if (active.current.pendingId) {
      active.current.pendingId = null;
      if (refetch) {
        void refreshDrafts();
      } else resetDrafts(order);
    }
  }, [enabled, scopeKey, order, pendingEntry, refetch, refreshDrafts, resetDrafts]);
  return { draftOrder: draftOrder || order, stageDraft, setStageDraft, conditionDraft, setConditionDraft,
    resetDrafts, refreshDrafts, refreshingDraft, refreshError, locked: Boolean(pendingEntry) || refreshingDraft || Boolean(refreshError) };
}
