import { api, unwrap } from '../api.js';

export const gstApi = {
  candidates: (params) => api.get('/gst/candidates', { params }).then(unwrap),
  candidate: (type, id) => api.get(`/gst/candidates/${type}/${id}`).then(unwrap),
  preview: (payload) => api.post('/gst/invoices/preview', payload).then(unwrap),
  issue: (payload) => api.post('/gst/invoices', payload).then(unwrap),
  invoices: (params) => api.get('/gst/invoices', { params }).then(unwrap),
  invoice: (id) => api.get(`/gst/invoices/${id}`).then(unwrap),
  report: (params) => api.get('/gst/report', { params }).then(unwrap),
  convertToKaccha: (id, payload) => api.post(`/gst/${id}/convert-to-kaccha`, payload).then(unwrap),
};
