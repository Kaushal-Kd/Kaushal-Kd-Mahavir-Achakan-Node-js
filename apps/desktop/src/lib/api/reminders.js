import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const remindersApi = {
  list: () => api.get('/reminders').then(unwrap),
  create: (payload) => api.post('/reminders', payload).then(unwrap),
  update: (id, payload) => api.put(`/reminders/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/reminders', id, body),
};
