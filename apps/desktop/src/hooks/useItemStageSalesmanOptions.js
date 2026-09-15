import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { usersApi } from '../lib/api/users.js';
import { queryKeys } from '../lib/queryKeys.js';
import { useShopStore } from '../stores/shopStore.js';

/**
 * Salesman options for item-stage list filters (multi-select).
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
      .filter((u) => u.is_active !== false && u.role === 'salesman')
      .filter((u) => !selectedShopId || !Array.isArray(u.shop_ids) || u.shop_ids.includes(selectedShopId))
      .map((u) => ({
        value: u.id,
        label: String(u.name || u.email || 'User').trim(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: 'none', label: 'Unassigned' }, ...staff];
  }, [data, selectedShopId]);

  return { options, loading: isLoading };
}
