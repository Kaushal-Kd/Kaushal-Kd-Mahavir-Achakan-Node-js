import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { shopEmailSettingsApi } from '../../lib/api/shopEmailSettings.js';
import { assertEmailSettingsScope } from '../../lib/shopEmailSettingsState.js';
import { syncService } from '../../services/syncService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';
import { useOnlineStatus } from '../useOnlineStatus.js';

function currentScope() {
  const user = useAuthStore.getState().user;
  return { userId: user?.id, role: user?.role, shopId: useShopStore.getState().selectedShopId };
}

export function useShopEmailSettings(shopId, userId, role) {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const key = ['shop-email-settings', shopId, userId, role];
  const query = useQuery({
    queryKey: key,
    queryFn: () => shopEmailSettingsApi.get(shopId),
    enabled: Boolean(shopId && userId && online && ['super_admin', 'shop_admin'].includes(role)),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  // Do not put SMTP passwords in a mutation cache or the durable offline queue.
  const run = useCallback(
    async (operation, body) => {
      assertEmailSettingsScope({ shopId, userId, role }, currentScope());
      if (!syncService.getState().online)
        throw new Error('Connect to the server to change or test email settings.');
      if (busyRef.current) throw new Error('Wait for the current email request to finish.');
      busyRef.current = true;
      setBusy(true);
      try {
        const result =
          operation === 'save'
            ? await shopEmailSettingsApi.save(shopId, body)
            : await shopEmailSettingsApi.test(shopId, body.expected_revision);
        assertEmailSettingsScope({ shopId, userId, role }, currentScope());
        if (operation === 'save')
          queryClient.setQueryData(['shop-email-settings', shopId, userId, role], result);
        await queryClient.invalidateQueries({
          queryKey: ['shop-email-settings', shopId, userId, role],
        });
        if (operation === 'save')
          await queryClient.invalidateQueries({ queryKey: ['users', 'login-readiness'] });
        return result;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [queryClient, role, shopId, userId]
  );
  return { ...query, online, busy, run };
}
