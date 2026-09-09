import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const customOrdersApi = {
  list: (params) => api.get('/custom-orders', { params }).then(unwrap),
  trialReminders: () => api.get('/custom-orders/trial-reminders').then(unwrap),
  dismissTrialReminder: (id) =>
    api.post(`/custom-orders/${id}/dismiss-trial-reminder`).then(unwrap),
  get: (id) => api.get(`/custom-orders/${id}`).then(unwrap),
  create: (body) => api.post('/custom-orders', body).then(unwrap),
  update: (id, body) => api.put(`/custom-orders/${id}`, body).then(unwrap),
  cancel: (id, body) => deleteWithAdminPassword('/custom-orders', id, body),
  createProduct: (id, body = {}) => api.post(`/custom-orders/${id}/create-product`, body).then(unwrap),
  linkBooking: (id, orderId) =>
    api.post(`/custom-orders/${id}/link-booking`, { order_id: orderId }).then(unwrap),
};
