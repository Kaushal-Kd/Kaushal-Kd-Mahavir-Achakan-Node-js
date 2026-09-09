import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const journalVouchersApi = {
  list: (params) => api.get('/journal-vouchers', { params }).then(unwrap),
  create: (payload) => api.post('/journal-vouchers', payload).then(unwrap),
  update: (id, payload) => api.put(`/journal-vouchers/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/journal-vouchers', id, body),
};
