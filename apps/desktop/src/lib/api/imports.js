import { api, unwrap } from '../api.js';

export const importsApi = {
  getProductTemplate: () => api.get('/imports/products/template').then(unwrap),
  getAccessoryTemplate: () => api.get('/imports/accessories/template').then(unwrap),
  uploadProducts: (payload) => api.post('/imports/products/upload', payload, { timeout: 0 }).then(unwrap),
  uploadAccessories: (payload) =>
    api.post('/imports/accessories/upload', payload, { timeout: 0 }).then(unwrap),
  listHistory: (params) => api.get('/imports/history', { params }).then(unwrap),
  getErrorExport: (id) => api.get(`/imports/${id}/errors`).then(unwrap),
  getProductBulkDeleteTemplate: () => api.get('/imports/products/bulk-delete/template').then(unwrap),
  previewProductBulkDelete: (payload) =>
    api.post('/imports/products/bulk-delete/preview', payload).then(unwrap),
  bulkDeleteProducts: (payload) => api.post('/imports/products/bulk-delete', payload).then(unwrap),
};
