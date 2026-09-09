import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const salesApi = {
  list: (params) => api.get('/sales', { params }).then(unwrap),
  get: (id) => api.get(`/sales/${id}`).then(unwrap),
  create: (payload) => api.post('/sales', payload).then(unwrap),
  update: (id, payload) => api.put(`/sales/${id}`, payload).then(unwrap),
  cancel: (id) => api.post(`/sales/${id}/cancel`).then(unwrap),
  recordPayment: (id, payload) => api.post(`/sales/${id}/payments`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/sales', id, body),
};
