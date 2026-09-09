import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { usersApi } from '../lib/api/users.js';
import { queryKeys } from '../lib/queryKeys.js';

/**
 * Salesman options for item-stage list filters (multi-select).
 * @param {string} cacheKey — unique per page (e.g. items-to-collect)
 */
export function useItemStageSalesmanOptions() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.users.dropdown,
    queryFn: () => usersApi.list({ per_page: 200, is_active: 'true' }),
    staleTime: 60_000,
  });

  const options = useMemo(() => {
    const list = data?.data ?? [];
    const staff = list
      .filter((u) => u.is_active !== false && u.role === 'salesman')
      .map((u) => ({
        value: u.id,
        label: String(u.name || u.email || 'User').trim(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: 'none', label: 'Unassigned' }, ...staff];
  }, [data]);

  return { options, loading: isLoading };
}
