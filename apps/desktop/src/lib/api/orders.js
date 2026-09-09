import { api, unwrap } from '../api.js';
import { getApiErrorMessage } from '../apiError.js';

export const ordersApi = {
  list: (params) => api.get('/orders', { params }).then(unwrap),
  get: (id) => api.get(`/orders/${id}`).then(unwrap),
  create: (payload) => api.post('/orders', payload).then(unwrap),
  update: (id, payload) => api.put(`/orders/${id}`, payload).then(unwrap),
  verifyAdminPassword: (body) => api.post('/orders/verify-admin-password', body).then(unwrap),
  setStage: (id, body) => api.post(`/orders/${id}/stage`, body).then((r) => unwrap(r).data),
  setStageBulk: (id, body) =>
    api.post(`/orders/${id}/stage-bulk`, body).then((r) => unwrap(r).data),
  setStageBatch: (id, body) =>
    api.post(`/orders/${id}/stage-batch`, body).then((r) => unwrap(r).data),
  settleDelivery: (id, body) => api.post(`/orders/${id}/delivery-settlement`, body).then(unwrap),
  settleReturn: (id, body) => api.post(`/orders/${id}/return-settlement`, body).then(unwrap),
  checklistCommand: (id, body) => api.post(`/orders/${id}/checklist-command`, body).then(unwrap),
  reassignSalesman: (id, body) => api.post(`/orders/${id}/reassign-salesman`, body).then(unwrap),
  setCondition: (id, body) => api.post(`/orders/${id}/condition`, body).then((r) => unwrap(r).data),
  checklistCombinedCharge: (id, body) =>
    api.post(`/orders/${id}/checklist-combined-charge`, body).then((r) => unwrap(r).data),
  adjustDiscountTotal: (id, payload) =>
    api.post(`/orders/${id}/discount-total`, payload).then(unwrap),
  setSecurityStatus: (id, payload) =>
    api.post(`/orders/${id}/security-status`, payload).then(unwrap),
  cancel: (id, payload = {}) => api.post(`/orders/${id}/cancel`, payload).then(unwrap),
  remove: async (id, body) => {
    try {
      const response = await api.delete(`/orders/${id}`, { data: body });
      return unwrap(response);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Could not delete booking');
      const wrapped = new Error(message);
      wrapped.status = err?.response?.status;
      wrapped.cause = err;
      throw wrapped;
    }
  },
};
