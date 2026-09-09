import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gstApi } from '../../lib/api/gst.js';
import { syncService } from '../../services/syncService.js';
import { useAuthStore } from '../../stores/authStore.js';
import { useShopStore } from '../../stores/shopStore.js';

export function useGstBills(params, candidates = false) {
  const shopId = useShopStore((s) => s.selectedShopId);
  const userId = useAuthStore((s) => s.user?.id);
  return useQuery({
    queryKey: [candidates ? 'gst-candidates' : 'gst-invoices', shopId, userId, params],
    queryFn: () => (candidates ? gstApi.candidates(params) : gstApi.invoices(params)),
    enabled: Boolean(shopId && userId && params.from && params.to && params.from <= params.to),
    retry: false,
  });
}

export function useIssueGstInvoices(options = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => syncService.submitOrQueueGstIssuance(body),
    ...options,
    onSuccess: async (...args) => {
      await qc.invalidateQueries({ queryKey: ['gst-invoices'] });
      await qc.invalidateQueries({ queryKey: ['gst-candidates'] });
      await options.onSuccess?.(...args);
    },
  });
}
