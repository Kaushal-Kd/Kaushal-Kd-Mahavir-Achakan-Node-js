import { api, unwrap } from '../api.js';

export const whatsappApi = {
  getConnection: () => api.get('/whatsapp/connection').then(unwrap),
  startConnection: () => api.post('/whatsapp/connection/start').then(unwrap),
  getQr: () => api.get('/whatsapp/connection/qr').then(unwrap),
  logout: () => api.post('/whatsapp/connection/logout').then(unwrap),
  listConnectionLogs: (params) =>
    api.get('/whatsapp/logs/connection', { params }).then(unwrap),
  listMessageLogs: (params) =>
    api.get('/whatsapp/logs/messages', { params }).then(unwrap),
  listReminders: (params) => api.get('/whatsapp/reminders', { params }).then(unwrap),
  runReminders: () => api.post('/whatsapp/reminders/run').then(unwrap),
  sendMessage: (payload) => api.post('/whatsapp/messages/send', payload).then(unwrap),
};
