import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const paymentsApi = {
  list: (params) => api.get('/payments', { params }).then(unwrap),
  securityTransactions: (params) =>
    api.get('/payments/security-transactions', { params }).then(unwrap),
  securityDue: (params) => api.get('/payments/security-due', { params }).then(unwrap),
  create: (payload) => api.post('/payments', payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/payments', id, body),
};
