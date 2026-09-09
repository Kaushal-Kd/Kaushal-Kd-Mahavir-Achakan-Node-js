import { api, unwrap } from '../api.js';

export const creditNotesApi = {
  list: (params) => api.get('/credit-notes', { params }).then(unwrap),
  customerBalance: (customerId) =>
    api.get(`/credit-notes/customer/${customerId}/balance`).then(unwrap),
  balanceByPhones: ({ phone1, phone2 }) =>
    api
      .get('/credit-notes/balance-by-phones', {
        params: {
          ...(phone1 ? { phone1 } : {}),
          ...(phone2 ? { phone2 } : {}),
        },
      })
      .then(unwrap),
  settle: (id, payload) => api.post(`/credit-notes/${id}/settle`, payload).then(unwrap),
};
