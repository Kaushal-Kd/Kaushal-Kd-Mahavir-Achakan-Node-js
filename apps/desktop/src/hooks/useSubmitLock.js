import { useCallback, useRef, useState } from 'react';

/**
 * @param {import('react').MutableRefObject<boolean>} lockRef
 * @returns {boolean} true if already locked (caller should return early)
 */
export function guardIfLocked(lockRef) {
  if (lockRef.current) return true;
  lockRef.current = true;
  return false;
}

/**
 * Synchronous ref lock + busy state for async submit handlers.
 * @returns {{ busy: boolean, isLocked: boolean, run: <T>(fn: () => Promise<T>|T) => Promise<T|undefined>, lockRef: import('react').MutableRefObject<boolean> }}
 */
export function useSubmitLock() {
  const lockRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn) => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }, []);

  return {
    busy,
    isLocked: busy,
    run,
    lockRef,
  };
}
