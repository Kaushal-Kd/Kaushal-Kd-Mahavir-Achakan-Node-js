import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const categoriesApi = {
  list: (params) => api.get('/categories', { params }).then(unwrap),
  create: (payload) => api.post('/categories', payload).then(unwrap),
  update: (id, payload) => api.put(`/categories/${id}`, payload).then(unwrap),
  getAccessoryCategoryMapping: (id) =>
    api.get(`/categories/${id}/accessory-categories`).then(unwrap),
  updateAccessoryCategoryMapping: (id, payload) =>
    api.put(`/categories/${id}/accessory-categories`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/categories', id, body),
};
