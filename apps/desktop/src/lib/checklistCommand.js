function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function reviewError(message) {
  const error = new Error(message);
  error.response = { status: 409, data: { error: { message } } };
  return error;
}

export function checklistCommandFingerprint(payload) {
  const { idempotency_key: _key, admin_password: _secret, ...command } = payload;
  return JSON.stringify(canonical(JSON.parse(JSON.stringify(command))));
}

export function buildChecklistCommandPayload(orderId, {
  order, stageUpdates = [], conditionUpdates = [], combinedCharge = null, adminPassword,
}) {
  if (!order || (order.id && String(order.id) !== String(orderId)) || !/^[a-f\d]{64}$/.test(order.checklist_state_token || '')) {
    throw reviewError('Refresh this booking before changing its checklist. The original checklist state is unavailable.');
  }
  if (!Array.isArray(stageUpdates) || !Array.isArray(conditionUpdates) || stageUpdates.length > 500 || conditionUpdates.length > 500) {
    throw reviewError('A checklist command can contain at most 500 stage and 500 condition updates.');
  }
  if (!stageUpdates.length && !conditionUpdates.length && !combinedCharge) {
    throw reviewError('There are no checklist changes to save.');
  }
  return JSON.parse(JSON.stringify({
    expected_state_token: order.checklist_state_token,
    stage_updates: stageUpdates,
    condition_updates: conditionUpdates,
    ...(combinedCharge ? { combined_assessment: {
      amount: combinedCharge.amount,
      remarks: combinedCharge.remarks || null,
      payment_account_id: combinedCharge.accountId || null,
    } } : {}),
    ...(adminPassword ? { admin_password: adminPassword } : {}),
  }));
}

export function findPendingChecklistCommand(entries, orderId) {
  return (entries || []).find((entry) => entry.entity === 'checklist_command' && String(entry.entityId) === String(orderId)) || null;
}

export function createChecklistCommandSubmitter({ queue, afterSave }) {
  const requestKeys = new Map();
  return async (orderId, options) => {
    const body = buildChecklistCommandPayload(orderId, options);
    const fingerprint = checklistCommandFingerprint(body);
    const scope = queue.getScope();
    const scopeKey = `${scope.shopId}:${scope.userId}:${orderId}`;
    const pending = findPendingChecklistCommand(queue.getEntries(), orderId);
    if (pending && checklistCommandFingerprint(pending.payload) !== fingerprint) {
      throw reviewError('This booking already has a saved checklist action. Review or sync it before submitting another.');
    }
    const previous = requestKeys.get(scopeKey);
    const key = pending?.id || (previous?.fingerprint === fingerprint ? previous.key : queue.createIdempotencyKey());
    requestKeys.set(scopeKey, { fingerprint, key });
    const result = await queue.submitChecklistCommand(orderId, { ...body, idempotency_key: key }, {
      orderNumber: options.order.order_number,
      requiresMasterPassword: Boolean(options.adminPassword),
    });
    if (result.queued) return { queued: true, order: null, replayed: false };
    const response = result.response;
    const order = response?.data;
    if (!order || typeof order !== 'object') throw new Error('Checklist response did not include the saved booking. Refresh before continuing.');
    const activeScope = queue.getScope();
    if (scope.shopId === activeScope.shopId && scope.userId === activeScope.userId) {
      await afterSave?.(orderId, order);
    }
    return { queued: false, order, replayed: Boolean(response.replayed) };
  };
}
