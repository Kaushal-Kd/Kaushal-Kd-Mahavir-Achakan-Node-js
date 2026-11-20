import { ACTIONS, hasPermission } from '@wrs/shared';

import { useAuthStore } from '../stores/authStore.js';

/** Sensitive-data permission: may this user see purchase / cost prices? */
export function useCanSeePurchasePrice() {
  const user = useAuthStore((s) => s.user);
  return hasPermission(user, 'sensitive.purchase_price', ACTIONS.VIEW);
}
