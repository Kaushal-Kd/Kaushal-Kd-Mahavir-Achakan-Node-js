import { api, unwrap } from '../api.js';

export const orderReplacementsApi = {
  list: (orderId, params) => api.get(`/order-replacements/orders/${orderId}`, { params }).then(unwrap),
  replace: (orderId, itemId, payload) => {
    const { item_id: _itemId, ...body } = payload;
    return api.post(`/order-replacements/orders/${orderId}/items/${itemId}`, body).then(unwrap);
  },
};
