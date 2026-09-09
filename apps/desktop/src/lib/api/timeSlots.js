import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const timeSlotsApi = {
  list: () => api.get('/time-slots').then(unwrap),
  getDefaults: () => api.get('/time-slots/defaults').then(unwrap),
  updateDefaults: (payload) => api.put('/time-slots/defaults', payload).then(unwrap),
  create: (payload) => api.post('/time-slots', payload).then(unwrap),
  update: (id, payload) => api.put(`/time-slots/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/time-slots', id, body),
};
