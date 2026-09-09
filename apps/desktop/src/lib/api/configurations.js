import { api, unwrap } from '../api.js';

/**
 * Shop-level configuration lookup lists (colors, sizes, units, tailors).
 *
 * Each list is stored as a per-shop override of the shared defaults.
 * The API returns `{ items, defaults, is_custom }` so the UI can
 * show the current effective values plus offer a "reset to defaults"
 * action.
 */
export const configurationsApi = {
  all: () => api.get('/configurations').then(unwrap),
  get: (type) => api.get(`/configurations/${type}`).then(unwrap),
  update: (type, items) => api.put(`/configurations/${type}`, { items }).then(unwrap),
  reset: (type) => api.post(`/configurations/${type}/reset`).then(unwrap),
  getBillNumbering: () => api.get('/configurations/bill-numbering').then(unwrap),
  updateBillNumbering: (payload) => api.put('/configurations/bill-numbering', payload).then(unwrap),
  getLaundryPriority: () => api.get('/configurations/laundry-priority').then(unwrap),
  updateLaundryPriority: (payload) => api.put('/configurations/laundry-priority', payload).then(unwrap),
  getAppSettings: () => api.get('/configurations/app-settings').then(unwrap),
  updateAppSetting: (key, value) =>
    api.put(`/configurations/app-settings/${encodeURIComponent(key)}`, { value }).then(unwrap),
  getWhatsAppMessages: () => api.get('/configurations/whatsapp-messages').then(unwrap),
  updateWhatsAppMessages: (payload) =>
    api.put('/configurations/whatsapp-messages', payload).then(unwrap),
};
