const DEFAULT_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000];

function clonePayload(payload) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function canonicalPayload(value) {
  if (Array.isArray(value)) return value.map(canonicalPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalPayload(value[key])]));
  }
  return value;
}

function persistedCommandPayload(payload) {
  const { admin_password: _password, ...stored } = clonePayload(payload);
  return stored;
}

function commandConflict() {
  const error = new Error('This request key belongs to an existing saved action. Review that action before changing its details.');
  error.response = { status: 409 };
  return error;
}

function assertQueueIdentity(existing, entity, entityId, payload, scope) {
  if (!existing) return;
  if (existing.entity !== entity || existing.entityId !== entityId || !entryMatchesScope(existing, scope) ||
      JSON.stringify(canonicalPayload(existing.payload)) !== JSON.stringify(canonicalPayload(payload))) {
    throw commandConflict();
  }
}

function responseStatus(error) {
  return Number(error?.response?.status || 0);
}

export function isTransientSettlementSyncError(error) {
  const status = responseStatus(error);
  return !error?.response || status === 408 || status === 429 || status >= 500;
}

export function settlementRetryDelay(retryCount, delays = DEFAULT_RETRY_DELAYS_MS) {
  const available = delays.length ? delays : DEFAULT_RETRY_DELAYS_MS;
  const index = Math.min(Math.max(0, Number(retryCount || 1) - 1), available.length - 1);
  return Math.max(0, Number(available[index]) || 0);
}

function readStoredQueue(storage, storageKey) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || '[]');
    return Array.isArray(parsed)
      ? parsed.map((entry) => ({
          ...entry,
          entity: [
            'delivery_settlement',
            'return_settlement',
            'security_charge_operation',
            'order_item_replacement',
            'order_edit',
            'checklist_command',
            'salesman_reassignment',
            'cash_reconciliation',
            'gst_conversion',
          ].includes(entry?.entity)
            ? entry.entity
            : entry?.entity || 'delivery_settlement',
        }))
      : [];
  } catch {
    return [];
  }
}

function entryMatchesScope(entry, scope) {
  return (
    entry.shopId === scope.shopId &&
    entry.userId === scope.userId
  );
}

function errorMessage(error) {
  const message =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    'Could not sync settlement';
  return message;
}

export function createDeliverySettlementSyncQueue(options) {
  const {
    storage,
    storageKey,
    getScope,
    hasAuth,
    submitSettlement,
    submitReturnSettlement,
    submitSecurityChargeOperation,
    submitOrderItemReplacement,
    submitOrderEdit,
    submitChecklistCommand,
    submitReassignment,
    submitCashReconciliation,
    submitGstConversion,
    submitGstIssuance,
    submitShopIpCommand,
    invalidateOrder,
    invalidateFinance,
    createId,
    now = () => Date.now(),
    setTimer = (fn, delay) => setTimeout(fn, delay),
    clearTimer = (id) => clearTimeout(id),
    retryDelays = DEFAULT_RETRY_DELAYS_MS,
    initialOnline = true,
  } = options;

  let queue = readStoredQueue(storage, storageKey);
  const retryOverrides = new Map();
  const directSubmissions = new Set();
  let retryTimer = null;
  const listeners = new Set();
  const state = {
    online: initialOnline,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
  };

  const currentScope = () => getScope() || { shopId: null, userId: null };
  const scopedEntries = () => {
    const scope = currentScope();
    return queue.filter((entry) => entryMatchesScope(entry, scope));
  };
  const snapshot = () => {
    const scoped = scopedEntries();
    const first = scoped[0];
    const entries = scoped.map((entry, index) => ({
      ...entry,
      payload: clonePayload(entry.payload),
      blockedBy: index > 0 ? first.id : null,
      blockedReason: index > 0
        ? first.status === 'failed'
          ? 'Waiting for the earlier action to be reviewed, retried, or removed.'
          : 'Waiting for the earlier action to sync first.'
        : null,
    }));
    return {
      ...state,
      syncing: state.syncing || scoped.some((entry) => directSubmissions.has(entry.id)),
      lastError: entries.find((entry) => entry.error)?.error || null,
      queued: entries.filter((entry) => entry.status === 'pending').length,
      failed: entries.filter((entry) => entry.status === 'failed').length,
      entries,
    };
  };
  const notify = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  };
  const persist = () => {
    storage?.setItem(storageKey, JSON.stringify(queue));
    notify();
  };
  const cancelRetryTimer = () => {
    if (retryTimer == null) return;
    clearTimer(retryTimer);
    retryTimer = null;
  };

  let flushQueue;

  const scheduleRetry = () => {
    if (retryTimer != null || !state.online || !hasAuth()) return;
    const first = scopedEntries()[0];
    if (!first || first.status !== 'pending') return;
    if (directSubmissions.has(first.id)) return;
    const nextAt = Number(first.nextAttemptAt || now());
    retryTimer = setTimer(
      () => {
        retryTimer = null;
        void flushQueue();
      },
      Math.max(0, nextAt - now())
    );
  };

  const enqueueSettlement = (orderId, payload, metadata = {}, capturedScope = currentScope()) => {
    const scope = { ...capturedScope };
    payload = clonePayload(payload);
    if (!scope.shopId || !scope.userId) {
      throw new Error('A signed-in user and selected shop are required to queue a settlement');
    }
    const existing = queue.find((entry) => entry.id === payload.idempotency_key);
    assertQueueIdentity(existing, 'delivery_settlement', orderId, payload, scope);
    const entry = {
      id: payload.idempotency_key,
      entity: 'delivery_settlement',
      entityId: orderId,
      orderNumber: metadata.orderNumber || existing?.orderNumber || null,
      shopId: scope.shopId,
      userId: scope.userId,
      payload,
      status: 'pending',
      retryCount: Number(existing?.retryCount || 0),
      error: null,
      createdAt: existing?.createdAt || new Date(now()).toISOString(),
      nextAttemptAt: Number(existing?.nextAttemptAt || now()),
    };
    const previousQueue = [...queue];
    const index = queue.findIndex((row) => row.id === entry.id);
    if (index >= 0) queue[index] = entry;
    else queue.push(entry);
    try { persist(); } catch (error) { queue = previousQueue; notify(); throw error; }
    return { ...entry };
  };

  const enqueueCommand = (entity, entityId, payload, metadata = {}, capturedScope = currentScope()) => {
    const scope = { ...capturedScope };
    if (!scope.shopId || !scope.userId) {
      throw new Error('A signed-in user and selected shop are required to queue this action');
    }
    const persistedPayload = persistedCommandPayload(payload);
    const id = persistedPayload.idempotency_key || createId();
    const existing = queue.find((entry) => entry.id === id);
    assertQueueIdentity(existing, entity, entityId, persistedPayload, scope);
    const entry = {
      id,
      entity,
      entityId,
      orderNumber: metadata.label || metadata.orderNumber || existing?.orderNumber || null,
      shopId: scope.shopId,
      userId: scope.userId,
      payload: persistedPayload,
      requiresMasterPassword: Boolean(metadata.requiresMasterPassword),
      status: 'pending',
      retryCount: Number(existing?.retryCount || 0),
      error: null,
      createdAt: existing?.createdAt || new Date(now()).toISOString(),
      nextAttemptAt: Number(existing?.nextAttemptAt || now()),
    };
    const previousQueue = [...queue];
    const index = queue.findIndex((row) => row.id === id);
    if (index >= 0) queue[index] = entry;
    else queue.push(entry);
    try { persist(); } catch (error) { queue = previousQueue; notify(); throw error; }
    return { ...entry };
  };

  flushQueue = async ({ force = false } = {}) => {
    if (!state.online || state.syncing || !hasAuth()) return snapshot();
    cancelRetryTimer();
    const scope = currentScope();
    state.syncing = true;
    state.lastError = null;
    notify();
    try {
      for (const queuedEntry of [...queue]) {
        const activeScope = currentScope();
        if (
          !hasAuth() ||
          activeScope.shopId !== scope.shopId ||
          activeScope.userId !== scope.userId
        ) {
          break;
        }
        const entry = queue.find((row) => row.id === queuedEntry.id);
        if (!entry || !entryMatchesScope(entry, scope)) continue;
        if (directSubmissions.has(entry.id)) break;
        if (entry.status !== 'pending') break;
        if (!force && Number(entry.nextAttemptAt || 0) > now()) break;
        try {
          const overrides = retryOverrides.get(entry.id) || {};
          retryOverrides.delete(entry.id);
          const submissionPayload = { ...entry.payload, ...overrides };
          if (entry.entity === 'salesman_reassignment') {
            await submitReassignment(entry.entityId, submissionPayload);
          } else if (entry.entity === 'return_settlement' || entry.entity === 'security_charge_operation' || entry.entity === 'order_item_replacement' || entry.entity === 'order_edit' || entry.entity === 'checklist_command') {
            const handler = {
              return_settlement: submitReturnSettlement,
              security_charge_operation: submitSecurityChargeOperation,
              order_item_replacement: submitOrderItemReplacement,
              order_edit: submitOrderEdit,
              checklist_command: submitChecklistCommand,
            }[entry.entity];
            if (!submissionPayload.idempotency_key || typeof handler !== 'function') {
              const error = new Error('This saved action needs review before it can be submitted again');
              error.response = { status: 409 };
              throw error;
            }
            await handler(entry.entityId, submissionPayload);
          } else if (entry.entity === 'cash_reconciliation') {
            await submitCashReconciliation(submissionPayload);
          } else if (entry.entity === 'gst_conversion') {
            await submitGstConversion(entry.entityId, submissionPayload);
          } else if (entry.entity === 'gst_issuance') {
            await submitGstIssuance(submissionPayload);
          } else if (entry.entity === 'shop_ip_command') {
            await submitShopIpCommand(entry.entityId, submissionPayload);
          } else if (entry.entity === 'delivery_settlement') {
            await submitSettlement(entry.entityId, submissionPayload);
          } else {
            const error = new Error('Unsupported saved action; review or remove it');
            error.response = { status: 409 };
            throw error;
          }
          queue = queue.filter((row) => row.id !== entry.id);
          persist();
          if (['cash_reconciliation', 'gst_conversion', 'gst_issuance', 'shop_ip_command', 'security_charge_operation'].includes(entry.entity)) {
            await invalidateFinance?.(entry);
          } else {
            await invalidateOrder?.(entry.entityId);
            if (entry.entity === 'checklist_command') await invalidateFinance?.(entry);
          }
        } catch (error) {
          const transient = isTransientSettlementSyncError(error);
          const retryCount = Number(entry.retryCount || 0) + 1;
          const message = errorMessage(error);
          queue = queue.map((row) =>
            row.id === entry.id
              ? {
                  ...row,
                  status: transient ? 'pending' : 'failed',
                  retryCount,
                  error: message,
                  nextAttemptAt: transient
                    ? now() + settlementRetryDelay(retryCount, retryDelays)
                    : null,
                }
              : row
          );
          state.lastError = message;
          persist();
          break;
        }
      }
      state.lastSyncAt = new Date(now()).toISOString();
    } finally {
      state.syncing = false;
      notify();
      scheduleRetry();
    }
    return snapshot();
  };

  const setOnline = (online) => {
    state.online = Boolean(online);
    if (!state.online) cancelRetryTimer();
    notify();
    if (state.online) void flushQueue({ force: true });
  };

  const scopeChanged = () => {
    cancelRetryTimer();
    notify();
    void flushQueue({ force: true });
  };

  const retry = async (id, overrides = {}) => {
    if (Object.keys(overrides || {}).some((key) => key !== 'admin_password')) throw commandConflict();
    const scope = currentScope();
    let found = false;
    queue = queue.map((entry) => {
      if (entry.id !== id || !entryMatchesScope(entry, scope)) return entry;
      found = true;
      return { ...entry, status: 'pending', error: null, nextAttemptAt: now() };
    });
    if (!found) return snapshot();
    if (overrides && Object.keys(overrides).length) retryOverrides.set(id, { ...overrides });
    persist();
    return flushQueue({ force: true });
  };

  const remove = (id) => {
    if (directSubmissions.has(id)) return false;
    const scope = currentScope();
    const next = queue.filter((entry) => entry.id !== id || !entryMatchesScope(entry, scope));
    if (next.length === queue.length) return false;
    queue = next;
    persist();
    scheduleRetry();
    return true;
  };

  const submitOrQueueSettlement = async (orderId, payload, metadata = {}) => {
    const scope = { ...currentScope() };
    payload = clonePayload(payload);
    assertQueueIdentity(queue.find((entry) => entry.id === payload.idempotency_key), 'delivery_settlement', orderId, payload, scope);
    const blocked = queue.some((entry) => entryMatchesScope(entry, scope));
    const entry = enqueueSettlement(orderId, payload, metadata, scope);
    if (!state.online || blocked) {
      scheduleRetry();
      return { queued: true, response: null };
    }
    return submitDirectEntry(entry, () => submitSettlement(orderId, payload));
  };

  const submitOrQueueSalesmanReassignment = (orderId, payload, metadata = {}) =>
    submitOrQueueCommand({ entity: 'salesman_reassignment', entityId: orderId, payload, metadata, submit: submitReassignment });

  const submitDirectEntry = async (entry, submit) => {
    directSubmissions.add(entry.id);
    notify();
    try {
      const response = await submit();
      queue = queue.filter((row) => row.id !== entry.id);
      persist();
      return { queued: false, response };
    } catch (error) {
      const transient = isTransientSettlementSyncError(error);
      const retryCount = Number(entry.retryCount || 0) + 1;
      const message = errorMessage(error);
      queue = queue.map((row) => row.id === entry.id ? {
        ...row, status: transient ? 'pending' : 'failed', retryCount, error: message,
        nextAttemptAt: transient ? now() + settlementRetryDelay(retryCount, retryDelays) : null,
      } : row);
      state.lastError = message;
      persist();
      if (!transient) throw error;
      return { queued: true, response: null };
    } finally {
      directSubmissions.delete(entry.id);
      notify();
      scheduleRetry();
    }
  };

  const submitOrQueueCommand = async ({ entity, entityId, payload, metadata, submit }) => {
    const scope = { ...currentScope() };
    payload = clonePayload(payload);
    assertQueueIdentity(queue.find((entry) => entry.id === payload.idempotency_key), entity, entityId, persistedCommandPayload(payload), scope);
    if (entity === 'checklist_command') {
      const previous = queue.find((entry) => entry.entity === entity && entry.entityId === entityId && entryMatchesScope(entry, scope));
      if (previous) {
        if (previous.id !== payload.idempotency_key) {
          const error = new Error('This booking already has a saved checklist action. Review or sync it before submitting another.');
          error.response = { status: 409 };
          throw error;
        }
        return { queued: true, response: null };
      }
    }
    const blocked = queue.some((entry) => entryMatchesScope(entry, scope));
    const entry = enqueueCommand(entity, entityId, payload, metadata, scope);
    if (!state.online || blocked) {
      scheduleRetry();
      return { queued: true, response: null };
    }
    return submitDirectEntry(entry, () => submit(entityId, payload));
  };

  return {
    getState: snapshot,
    getScope: () => ({ ...currentScope() }),
    getEntries: () => snapshot().entries,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    createIdempotencyKey: createId,
    getEntriesForOrder: (orderId) =>
      snapshot().entries
        .filter((entry) => String(entry.entityId) === String(orderId))
        .map((entry) => ({ ...entry })),
    enqueueDeliverySettlement: enqueueSettlement,
    submitOrQueueDeliverySettlement: submitOrQueueSettlement,
    submitOrQueueReturnSettlement: (orderId, payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'return_settlement', entityId: orderId, payload, metadata, submit: submitReturnSettlement }),
    submitSecurityChargeOperation: (chargeId, payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'security_charge_operation', entityId: chargeId, payload, metadata, submit: submitSecurityChargeOperation }),
    submitOrderItemReplacement: (orderId, payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'order_item_replacement', entityId: orderId, payload, metadata, submit: submitOrderItemReplacement }),
    submitOrderEdit: (orderId, payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'order_edit', entityId: orderId, payload, metadata, submit: submitOrderEdit }),
    submitChecklistCommand: (orderId, payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'checklist_command', entityId: orderId, payload, metadata, submit: submitChecklistCommand }),
    submitOrQueueSalesmanReassignment,
    submitOrQueueCashReconciliation: (payload, metadata = {}) =>
      submitOrQueueCommand({
        entity: 'cash_reconciliation',
        entityId: payload.payment_account_id,
        payload,
        metadata,
        submit: (_entityId, body) => submitCashReconciliation(body),
      }),
    submitOrQueueGstConversion: (sourceId, payload, metadata = {}) =>
      submitOrQueueCommand({
        entity: 'gst_conversion',
        entityId: sourceId,
        payload,
        metadata,
        submit: (id, body) => submitGstConversion(id, body),
      }),
    submitOrQueueGstIssuance: (payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'gst_issuance', entityId: payload.idempotency_key, payload, metadata, submit: (_id, body) => submitGstIssuance(body) }),
    submitOrQueueShopIpCommand: (shopId, payload, metadata = {}) =>
      submitOrQueueCommand({ entity: 'shop_ip_command', entityId: shopId, payload, metadata, submit: submitShopIpCommand }),
    sync: () => flushQueue({ force: true }),
    retry,
    remove,
    setOnline,
    scopeChanged,
    destroy() {
      cancelRetryTimer();
      listeners.clear();
    },
  };
}
