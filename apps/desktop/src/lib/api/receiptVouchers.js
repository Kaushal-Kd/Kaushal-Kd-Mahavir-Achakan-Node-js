import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const receiptVouchersApi = {
  list: (params) => api.get('/receipt-vouchers', { params }).then(unwrap),
  get: (id) => api.get(`/receipt-vouchers/${id}`).then(unwrap),
  create: (payload) => api.post('/receipt-vouchers', payload).then(unwrap),
  update: (id, payload) => api.put(`/receipt-vouchers/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/receipt-vouchers', id, body),
};
