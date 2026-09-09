export function createVoucherLoadGuard(getScope = () => '') {
  let generation = 0;
  return {
    start() {
      const request = ++generation;
      const scope = getScope();
      return () => generation === request && getScope() === scope;
    },
    cancel() {
      generation += 1;
    },
  };
}
