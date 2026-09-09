import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const incomeEntriesApi = {
  list: (params) => api.get('/income-entries', { params }).then(unwrap),
  create: (payload) => api.post('/income-entries', payload).then(unwrap),
  update: (id, payload) => api.put(`/income-entries/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/income-entries', id, body),
};
