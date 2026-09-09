import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const securityAccountsApi = {
  list: () => api.get('/security-accounts').then(unwrap),
  create: (payload) => api.post('/security-accounts', payload).then(unwrap),
  update: (id, payload) => api.put(`/security-accounts/${encodeURIComponent(id)}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/security-accounts', encodeURIComponent(id), body),
};
