import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const purchasesApi = {
  list: (params) => api.get('/purchases', { params }).then(unwrap),
  get: (id) => api.get(`/purchases/${id}`).then(unwrap),
  create: (payload) => api.post('/purchases', payload).then(unwrap),
  update: (id, payload) => api.put(`/purchases/${id}`, payload).then(unwrap),
  cancel: (id) => api.post(`/purchases/${id}/cancel`).then(unwrap),
  recordPayment: (id, payload) => api.post(`/purchases/${id}/payments`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/purchases', id, body),
};
