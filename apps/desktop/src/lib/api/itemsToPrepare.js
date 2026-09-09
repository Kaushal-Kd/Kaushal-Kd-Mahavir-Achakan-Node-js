import { api, unwrap } from '../api.js';

export const itemsToPrepareApi = {
  list: (params) => api.get('/orders/items-to-prepare', { params }).then(unwrap),
  listLines: (params) =>
    api.get('/orders/items-to-prepare', { params: { ...params, lines: 1 } }).then(unwrap),
};
