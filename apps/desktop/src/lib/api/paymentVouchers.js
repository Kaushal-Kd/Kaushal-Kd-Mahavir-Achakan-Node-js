import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const paymentVouchersApi = {
  list: (params) => api.get('/payment-vouchers', { params }).then(unwrap),
  get: (id) => api.get(`/payment-vouchers/${id}`).then(unwrap),
  create: (payload) => api.post('/payment-vouchers', payload).then(unwrap),
  update: (id, payload) => api.put(`/payment-vouchers/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/payment-vouchers', id, body),
};
