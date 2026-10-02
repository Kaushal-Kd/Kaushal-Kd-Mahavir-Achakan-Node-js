import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS } from '@wrs/shared';
import { useMemo } from 'react';

import { usersApi } from '../lib/api/users.js';
import { isSalesmanEligibleUser } from '../lib/salesmanOptions.js';
import { queryKeys } from '../lib/queryKeys.js';
import { useShopStore } from '../stores/shopStore.js';

function staffOptionLabel(user) {
  const name = String(user?.name || user?.email || 'User').trim() || 'User';
  const roleLabel = ROLE_LABELS[user?.role];
  return roleLabel ? `${name} (${roleLabel})` : name;
}

/**
 * Assigned-to options for item-stage list filters and work transfer.
 * Includes every active shop user (manager, salesman, shop admin, …), not only salesmen.
 */
export function useItemStageSalesmanOptions() {
  const selectedShopId = useShopStore((s) => s.selectedShopId);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.users.dropdown(selectedShopId),
    queryFn: () => usersApi.list({ per_page: 200, is_active: 'true' }),
    staleTime: 60_000,
    enabled: Boolean(selectedShopId),
  });

  const options = useMemo(() => {
    const list = data?.data ?? [];
    const staff = list
      .filter((u) => isSalesmanEligibleUser(u))
      .filter(
        (u) => !selectedShopId || !Array.isArray(u.shop_ids) || u.shop_ids.includes(selectedShopId)
      )
      .map((u) => ({
        value: u.id,
        label: staffOptionLabel(u),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: 'none', label: 'Unassigned' }, ...staff];
  }, [data, selectedShopId]);

  return { options, loading: isLoading };
}
