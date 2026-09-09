import { api, unwrap } from '../api.js';

export const authApi = {
  getMe: () => api.get('/auth/me').then(unwrap),
  updateProfile: (payload) => api.patch('/auth/profile', payload).then(unwrap),
  changePassword: (payload) => api.post('/auth/change-password', payload).then(unwrap),
  requestPasswordOtp: (payload) => api.post('/auth/password-otp/request', payload).then(unwrap),
  confirmPasswordOtp: (payload) => api.post('/auth/password-otp/confirm', payload).then(unwrap),
  verifyShopAdminPassword: (body) => api.post('/auth/verify-shop-admin-password', body).then(unwrap),
  listDevices: (params) => api.get('/auth/devices', { params }).then(unwrap),
  revokeDevice: (id, body) => api.post(`/auth/devices/${id}/revoke`, body).then(unwrap),
  revokeAllDevices: (body) => api.post('/auth/devices/revoke-all', body).then(unwrap),
};
