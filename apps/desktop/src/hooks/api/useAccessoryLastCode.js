import { useQuery } from '@tanstack/react-query';

import { accessoriesApi } from '../../lib/api/accessories.js';
import { useShopStore } from '../../stores/shopStore.js';

export function useAccessoryLastCode(categoryId) {
  const shopId = useShopStore((state) => state.selectedShopId);
  return useQuery({
    queryKey: ['accessories', 'last-code', shopId, categoryId],
    queryFn: () => accessoriesApi.lastCode({ category_id: categoryId }),
    enabled: Boolean(categoryId && shopId),
    staleTime: 30_000,
  });
}
