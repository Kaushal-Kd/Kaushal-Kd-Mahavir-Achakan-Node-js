import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const paymentAccountsApi = {
  list: () => api.get('/payment-accounts').then(unwrap),
  create: (payload) => api.post('/payment-accounts', payload).then(unwrap),
  update: (id, payload) => api.put(`/payment-accounts/${encodeURIComponent(id)}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/payment-accounts', encodeURIComponent(id), body),
};
