import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipWhitelistApi } from '../../lib/api/ipWhitelist.js';
import { syncService } from '../../services/syncService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';

export function useShopIpPolicies() {
  const shopId = useShopStore((s) => s.selectedShopId);
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: ['shop-ip-policies', shopId, userId],
    queryFn: () => ipWhitelistApi.shop(),
    enabled: Boolean(shopId && userId),
    retry: false,
  });
}

export function useSaveShopIpPolicy(options = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shopId, body }) => syncService.submitOrQueueShopIpCommand(shopId, body),
    ...options,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ['shop-ip-policies'] });
      await options.onSuccess?.(...args);
    },
  });
}
