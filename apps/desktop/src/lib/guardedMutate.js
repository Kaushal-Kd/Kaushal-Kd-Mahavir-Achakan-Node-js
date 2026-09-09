const mutationLocks = new WeakMap();

/**
 * Prevent double-fire of TanStack Query mutations before isPending updates.
 * @param {{ isPending?: boolean, mutate: Function }} mutation
 * @param {unknown} [variables]
 * @param {object} [options]
 */
export function guardedMutate(mutation, variables, options = {}) {
  if (!mutation?.mutate) return;
  if (mutation.isPending) return;

  let lockRef = mutationLocks.get(mutation);
  if (!lockRef) {
    lockRef = { current: false };
    mutationLocks.set(mutation, lockRef);
  }
  if (lockRef.current) return;
  lockRef.current = true;

  const userOnSettled = options.onSettled;
  mutation.mutate(variables, {
    ...options,
    onSettled: (...args) => {
      lockRef.current = false;
      if (typeof userOnSettled === 'function') userOnSettled(...args);
    },
  });
}
