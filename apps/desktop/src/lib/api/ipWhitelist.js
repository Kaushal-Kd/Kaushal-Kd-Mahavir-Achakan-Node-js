import { api, unwrap } from '../api.js';

export const ipWhitelistApi = {
  shop: () => api.get('/ip-whitelist/shop').then(unwrap),
  shopCommand: (shopId, body) => api.post(`/ip-whitelist/shop/${shopId}/commands`, body).then(unwrap),
  get: () => api.get('/ip-whitelist', { timeout: 10_000 }).then(unwrap),
  updateGlobal: (payload) => api.put('/ip-whitelist/global', payload).then(unwrap),
  updateUser: (userId, payload) => api.put(`/ip-whitelist/users/${userId}`, payload).then(unwrap),
};
