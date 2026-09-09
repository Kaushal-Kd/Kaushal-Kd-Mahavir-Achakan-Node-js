import { api, unwrap } from '../api.js';

export const securityChargesApi = {
  list: (params) => api.get('/security-charges', { params }).then(unwrap),
  pendingTotal: (orderId) =>
    api.get(`/security-charges/order/${orderId}/pending-total`).then(unwrap),
  create: (payload) => api.post('/security-charges', payload).then(unwrap),
  syncReturnSettlement: (payload) =>
    api.post('/security-charges/sync-return-settlement', payload).then(unwrap),
  settle: (id, payload) => api.post(`/security-charges/${id}/settle`, payload).then(unwrap),
  operations: (id) => api.get(`/security-charges/${id}/operations`).then(unwrap),
  operate: (id, payload) => api.post(`/security-charges/${id}/operations`, payload).then(unwrap),
};
