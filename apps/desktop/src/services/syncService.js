import { gstApi } from '../lib/api/gst.js';
import { ipWhitelistApi } from '../lib/api/ipWhitelist.js';
import { orderReplacementsApi } from '../lib/api/orderReplacements.js';
import { ordersApi } from '../lib/api/orders.js';
import { reportsApi } from '../lib/api/reports.js';
import { securityChargesApi } from '../lib/api/securityCharges.js';
import { queryClient } from '../lib/queryClient.js';
import { invalidateOrderDomain } from '../lib/queryInvalidation.js';
import { useAuthStore } from '../stores/authStore.js';
import { useShopStore } from '../stores/shopStore.js';

import { createDeliverySettlementSyncQueue } from './deliverySettlementSyncQueue.js';

const STORAGE_KEY = 'wrs.local.sync_queue.v1';

export function createQueueId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function currentScope() {
  return {
    shopId: useShopStore.getState().selectedShopId || null,
    userId: useAuthStore.getState().user?.id || null,
  };
}

export const syncService = createDeliverySettlementSyncQueue({
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  storageKey: STORAGE_KEY,
  getScope: currentScope,
  hasAuth: () => Boolean(useAuthStore.getState().accessToken),
  submitSettlement: (orderId, payload) => ordersApi.settleDelivery(orderId, payload),
  submitReturnSettlement: (orderId, payload) => ordersApi.settleReturn(orderId, payload),
  submitOrderEdit: (orderId, payload) => ordersApi.update(orderId, payload),
  submitChecklistCommand: (orderId, payload) => ordersApi.checklistCommand(orderId, payload),
  submitSecurityChargeOperation: (chargeId, payload) =>
    securityChargesApi.operate(chargeId, payload),
  submitOrderItemReplacement: (orderId, payload) =>
    orderReplacementsApi.replace(orderId, payload.item_id, payload),
  submitReassignment: (orderId, payload) => ordersApi.reassignSalesman(orderId, payload),
  submitCashReconciliation: (payload) => reportsApi.closeCashCounter(payload),
  submitGstConversion: (sourceId, payload) => gstApi.convertToKaccha(sourceId, payload),
  submitGstIssuance: (payload) => gstApi.issue(payload),
  submitShopIpCommand: (shopId, payload) => ipWhitelistApi.shopCommand(shopId, payload),
  invalidateOrder: (orderId) => invalidateOrderDomain(queryClient, { orderId }),
  invalidateFinance: async () => {
    await queryClient.invalidateQueries({ queryKey: ['reports'] });
    await queryClient.invalidateQueries({ queryKey: ['gst-report'] });
    await queryClient.invalidateQueries({ queryKey: ['gst-invoices'] });
    await queryClient.invalidateQueries({ queryKey: ['gst-candidates'] });
    await queryClient.invalidateQueries({ queryKey: ['shop-ip-policies'] });
    await queryClient.invalidateQueries({ queryKey: ['security-charges'] });
    await queryClient.invalidateQueries({ queryKey: ['order'] });
  },
  createId: createQueueId,
  initialOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncService.setOnline(true));
  window.addEventListener('offline', () => syncService.setOnline(false));
  window.setTimeout(() => syncService.scopeChanged(), 0);
}

useAuthStore.subscribe((state, previous) => {
  if (state.accessToken !== previous.accessToken || state.user?.id !== previous.user?.id) {
    syncService.scopeChanged();
  }
});

useShopStore.subscribe((state, previous) => {
  if (state.selectedShopId !== previous.selectedShopId) syncService.scopeChanged();
});
