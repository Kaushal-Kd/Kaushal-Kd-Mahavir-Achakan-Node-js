import { api, unwrap } from '../api.js';

export const systemLogsApi = {
  list: (params) => api.get('/system-logs', { params }).then(unwrap),
  get: (id) => api.get(`/system-logs/${id}`).then(unwrap),
};
