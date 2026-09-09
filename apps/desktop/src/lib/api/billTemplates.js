import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const billTemplatesApi = {
  list: () => api.get('/bill-templates').then(unwrap),
  get: (id) => api.get(`/bill-templates/${id}`).then(unwrap),
  create: (payload) => api.post('/bill-templates', payload).then(unwrap),
  update: (id, payload) => api.put(`/bill-templates/${id}`, payload).then(unwrap),
  setDefault: (id) => api.post(`/bill-templates/${id}/default`).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/bill-templates', id, body),
};
