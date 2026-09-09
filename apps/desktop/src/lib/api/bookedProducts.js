import { api, unwrap } from '../api.js';

export const bookedProductsApi = {
  list: (params) => api.get('/orders/booked-products', { params }).then(unwrap),
};
