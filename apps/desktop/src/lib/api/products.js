import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const productsApi = {
  list: (params) => api.get('/products', { params }).then(unwrap),
  get: (id) => api.get(`/products/${id}`).then(unwrap),
  create: (payload) => api.post('/products', payload).then(unwrap),
  update: (id, payload) => api.put(`/products/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/products', id, body),
  bulkDeactivate: (ids, admin_password) =>
    api.post('/products/bulk-deactivate', { ids, admin_password }).then(unwrap),
  bulkActivate: (ids, admin_password) =>
    api.post('/products/bulk-activate', { ids, admin_password }).then(unwrap),
  getCodeFormat: () => api.get('/products/code-format').then(unwrap),
  updateCodeFormat: (payload) => api.put('/products/code-format', payload).then(unwrap),
  nextCode: (params) => api.get('/products/next-code', { params }).then(unwrap),
  lastCode: (params) => api.get('/products/last-code', { params }).then(unwrap),
  checkCodeNumberTaken: (params) => api.get('/products/code-number-taken', { params }).then(unwrap),
  categoryCounts: () => api.get('/products/category-counts').then(unwrap),
  checkAvailability: (params) => api.get('/products/availability', { params }).then(unwrap),
  checkSellAvailability: (params) => api.get('/products/sell-availability', { params }).then(unwrap),
  availabilityList: (params) => api.get('/products/availability-list', { params }).then(unwrap),
  bookingAvailability: (params) => api.get('/products/booking-availability', { params }).then(unwrap),
  pendingWashing: () => api.get('/products/pending-washing').then(unwrap),
  inventory: (params) => api.get('/products/inventory', { params }).then(unwrap),
  rentalHistory: (id, params) =>
    api.get(`/products/${id}/rental-history`, { params }).then(unwrap),
  saleHistory: (id, params) => api.get(`/products/${id}/sale-history`, { params }).then(unwrap),
  getAccessoryMapping: (id) => api.get(`/products/${id}/accessory-mapping`).then(unwrap),
  updateAccessoryMapping: (id, payload) =>
    api.put(`/products/${id}/accessory-mapping`, payload).then(unwrap),
  getRelatedMapping: (id, params) =>
    api.get(`/products/${id}/related-products`, { params }).then(unwrap),
  updateRelatedMapping: (id, payload) =>
    api.put(`/products/${id}/related-products`, payload).then(unwrap),
  exportAll: (params) => api.get('/products/export', { params }).then(unwrap),
};
