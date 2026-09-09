import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { customOrdersApi } from '../../lib/api/customOrders.js';
import { invalidateCustomOrdersDomain } from '../../lib/queryInvalidation.js';

/**
 * @param {Record<string, unknown>} [params]
 */
export function useCustomOrdersList(params = {}) {
  return useQuery({
    queryKey: ['custom-orders', params],
    queryFn: () => customOrdersApi.list(params),
    keepPreviousData: true,
  });
}

export function useCustomOrderTrialReminders() {
  return useQuery({
    queryKey: ['custom-orders', 'trial-reminders'],
    queryFn: () => customOrdersApi.trialReminders(),
  });
}

/**
 * @param {string|undefined} id
 */
export function useCustomOrder(id) {
  return useQuery({
    queryKey: ['custom-order', id],
    queryFn: () => customOrdersApi.get(id).then((r) => r.data),
    enabled: Boolean(id),
  });
}

export function useCustomOrderMutations() {
  const queryClient = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body) => customOrdersApi.create(body).then((r) => r.data),
    onSuccess: async () => {
      await invalidateCustomOrdersDomain(queryClient);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => customOrdersApi.update(id, body).then((r) => r.data),
    onSuccess: async (_data, { id }) => {
      await invalidateCustomOrdersDomain(queryClient, { orderId: id });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id) => customOrdersApi.cancel(id).then((r) => r.data),
    onSuccess: async (_data, id) => {
      await invalidateCustomOrdersDomain(queryClient, { orderId: id });
    },
  });

  const dismissTrialReminderMut = useMutation({
    mutationFn: (id) => customOrdersApi.dismissTrialReminder(id).then((r) => r.data),
    onSuccess: async (_data, id) => {
      await invalidateCustomOrdersDomain(queryClient, { orderId: id });
    },
  });

  const createProductMut = useMutation({
    mutationFn: ({ id, body }) => customOrdersApi.createProduct(id, body).then((r) => r.data),
    onSuccess: async (_data, { id }) => {
      await invalidateCustomOrdersDomain(queryClient, { orderId: id });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const linkBookingMut = useMutation({
    mutationFn: ({ id, orderId }) => customOrdersApi.linkBooking(id, orderId).then((r) => r.data),
    onSuccess: async (_data, { id }) => {
      await invalidateCustomOrdersDomain(queryClient, { orderId: id });
    },
  });

  return {
    createMut,
    updateMut,
    cancelMut,
    dismissTrialReminderMut,
    createProductMut,
    linkBookingMut,
  };
}
