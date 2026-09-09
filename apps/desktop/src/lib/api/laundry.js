import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const laundryApi = {
  list: (params) => api.get('/laundry', { params }).then(unwrap),
  get: (id) => api.get(`/laundry/${id}`).then(unwrap),
  vendorOutstanding: (params) => api.get('/laundry/vendor-outstanding', { params }).then(unwrap),
  create: (payload) => api.post('/laundry', payload).then(unwrap),
  update: (id, payload) => api.put(`/laundry/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/laundry', id, body),
  markProductReturned: (jobId, lineId) => api.patch(`/laundry/${jobId}/products/${lineId}/return`).then(unwrap),
  markProductCancelled: (jobId, lineId) => api.patch(`/laundry/${jobId}/products/${lineId}/cancel`).then(unwrap),
  markAccessoryReturned: (jobId, lineId, payload) =>
    api.patch(`/laundry/${jobId}/accessories/${lineId}/return`, payload).then(unwrap),
  markAllReturned: (jobId) => api.patch(`/laundry/${jobId}/return-all`).then(unwrap),
  returnSelected: (jobId, payload) => api.patch(`/laundry/${jobId}/return-selected`, payload).then(unwrap),
  getReturnLogs: (jobId) => api.get(`/laundry/${jobId}/return-logs`).then(unwrap),
};
