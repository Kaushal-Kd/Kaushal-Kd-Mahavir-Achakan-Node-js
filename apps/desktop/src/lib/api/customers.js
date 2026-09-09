import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const customersApi = {
  list: (params) => api.get('/customers', { params }).then(unwrap),
  get: (id) => api.get(`/customers/${id}`).then(unwrap),
  search: (q) => api.get('/customers/search', { params: { q } }).then(unwrap),
  create: (payload) => api.post('/customers', payload).then(unwrap),
  quickAvailabilityCreate: (payload) =>
    api.post('/customers/quick-availability', payload).then(unwrap),
  update: (id, payload) => api.put(`/customers/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/customers', id, body),
};
