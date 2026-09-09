import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const accessoriesApi = {
  list: (params) => api.get('/accessories', { params }).then(unwrap),
  get: (id) => api.get(`/accessories/${id}`).then(unwrap),
  create: (payload) => api.post('/accessories', payload).then(unwrap),
  update: (id, payload) => api.put(`/accessories/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/accessories', id, body),
  activate: (id, admin_password) =>
    api.post(`/accessories/${id}/activate`, { admin_password }).then(unwrap),
  categoryCounts: (params) => api.get('/accessories/category-counts', { params }).then(unwrap),
  recommendations: (params) => api.get('/accessories/recommendations', { params }).then(unwrap),
  checkAvailability: (params) => api.get('/accessories/availability', { params }).then(unwrap),
  outOrders: (id) => api.get(`/accessories/${id}/out-orders`).then(unwrap),
  getCodeFormat: () => api.get('/accessories/code-format').then(unwrap),
  updateCodeFormat: (payload) => api.put('/accessories/code-format', payload).then(unwrap),
  nextCode: (params) => api.get('/accessories/next-code', { params }).then(unwrap),
  lastCode: (params) => api.get('/accessories/last-code', { params }).then(unwrap),
};
