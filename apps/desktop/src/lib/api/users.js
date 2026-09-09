import { api, unwrap } from '../api.js';

export const usersApi = {
  get: (id) => api.get(`/users/${id}`).then(unwrap),
  list: (params) => api.get('/users', { params }).then(unwrap),
  loginReadiness: () => api.get('/users/login-readiness').then(unwrap),
  setLoginMode: (mode) => api.patch('/users/login-mode', { mode }).then(unwrap),
  updateLoginIdentity: (id, { phone, email }) =>
    api.put(`/users/${id}`, { phone, email }).then(unwrap),
  updateCommission: (id, payload) => api.put(`/users/${id}/commission`, payload).then(unwrap),
};
