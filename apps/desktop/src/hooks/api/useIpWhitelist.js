import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ipWhitelistApi } from '../../lib/api/ipWhitelist.js';
import { queryKeys } from '../../lib/queryKeys.js';

export function useIpWhitelist() {
  return useQuery({
    queryKey: queryKeys.ipWhitelist.all,
    queryFn: () => ipWhitelistApi.get(),
    retry: false,
  });
}

export function useUpdateGlobalIpWhitelist(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => ipWhitelistApi.updateGlobal(payload),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ipWhitelist.all });
      await options.onSuccess?.(...args);
    },
  });
}

export function useUpdateUserIpWhitelist(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }) => ipWhitelistApi.updateUser(userId, payload),
    ...options,
    onSuccess: async (...args) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.ipWhitelist.all });
      await options.onSuccess?.(...args);
    },
  });
}
