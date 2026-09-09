import { api, unwrap } from '../api.js';

export const itemsToCollectApi = {
  list: (params) => api.get('/orders/items-to-collect', { params }).then(unwrap),
  listLines: (params) =>
    api.get('/orders/items-to-collect', { params: { ...params, lines: 1 } }).then(unwrap),
};
