import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { securityChargesApi } from '../../lib/api/securityCharges.js';
import {
  invalidateAccountingDomain,
  invalidateSecurityChargesDomain,
} from '../../lib/queryInvalidation.js';
import { syncService } from '../../services/syncService.js';
import { useOnlineStatus } from '../useOnlineStatus.js';

export function useSecurityChargeOperations(chargeId, orderId) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const detail = useQuery({
    queryKey: ['security-charges', 'operations', chargeId],
    queryFn: () => securityChargesApi.operations(chargeId),
    enabled: Boolean(chargeId),
  });
  const mutation = useMutation({
    mutationFn: (body) => syncService.submitSecurityChargeOperation(chargeId, body, { orderId }),
    onSuccess: async (result) => {
      if (result.queued) return;
      await invalidateSecurityChargesDomain(queryClient, { orderId });
      await invalidateAccountingDomain(queryClient);
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
  return { detail, mutation, online };
}
