export function deactivateSessionRuntime(runtime) {
  if (!runtime) return null;
  const sock = runtime.sock;
  runtime.sock = null;
  runtime.status = 'disconnected';
  runtime.qrDataUrl = null;
  return sock;
}

export function createScopedSessionOperations() {
  const pending = new Map();
  return (shopId, operation) => {
    const previous = pending.get(shopId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    const settled = current.finally(() => {
      if (pending.get(shopId) === settled) pending.delete(shopId);
    });
    pending.set(shopId, settled);
    return settled;
  };
}

export function queueRuntimeSessionHook(runtime, hook, isCurrent, ...args) {
  runtime.hooksSave = (runtime.hooksSave || Promise.resolve()).then(async () => {
    if (!isCurrent()) return false;
    try {
      await hook?.(...args);
      return true;
    } catch {
      return false;
    }
  });
  return runtime.hooksSave;
}

export async function drainSessionPersistence(runtime) {
  await Promise.all([runtime?.credentialsSave, runtime?.hooksSave]);
}

export async function connectSessionSocket(runtime, makeSocket, options, {
  beforeConnect,
  isCurrent,
}) {
  await beforeConnect?.();
  if (!isCurrent()) return null;
  const sock = makeSocket(options);
  runtime.sock = sock;
  return sock;
}

export function queueSessionCredentialsSave(runtime, saveCreds, isCurrent, onError) {
  // Serialize writes so logout can drain in-flight saves before removing auth files.
  runtime.credentialsSave = (runtime.credentialsSave || Promise.resolve()).then(async () => {
    if (!isCurrent()) return;
    try {
      await saveCreds();
    } catch {
      await onError?.();
    }
  });
  return runtime.credentialsSave;
}
