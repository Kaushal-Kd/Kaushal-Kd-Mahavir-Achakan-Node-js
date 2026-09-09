import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { orderReplacementsApi } from '../../lib/api/orderReplacements.js';
import { invalidateOrderDomain } from '../../lib/queryInvalidation.js';
import { syncService } from '../../services/syncService.js';
import { useOnlineStatus } from '../useOnlineStatus.js';

export function useOrderReplacementRequirements(orderId, direction, sourceItemIds = []) {
  const online = useOnlineStatus();
  const itemIds = [...sourceItemIds].sort().join(',');
  return useQuery({
    queryKey: ['order-replacements', orderId, direction, itemIds],
    queryFn: () => orderReplacementsApi.list(orderId, {
      direction,
      ...(itemIds ? { source_item_ids: itemIds } : {}),
    }).then((response) => response.data),
    enabled: Boolean(orderId && online),
  });
}

export function useReplaceOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, itemId, payload, metadata }) =>
      syncService.submitOrderItemReplacement(orderId, { ...payload, item_id: itemId }, metadata),
    onSuccess: async (result, variables) => {
      if (result.queued) return;
      await invalidateOrderDomain(queryClient, { orderId: variables.orderId });
      await queryClient.invalidateQueries({ queryKey: ['order-replacements'] });
      await queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });
}
