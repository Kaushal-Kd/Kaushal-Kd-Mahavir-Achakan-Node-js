import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const expenseEntriesApi = {
  list: (params) => api.get('/expense-entries', { params }).then(unwrap),
  create: (payload) => api.post('/expense-entries', payload).then(unwrap),
  update: (id, payload) => api.put(`/expense-entries/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/expense-entries', id, body),
};
