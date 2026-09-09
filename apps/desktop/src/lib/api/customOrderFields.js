import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const customOrderFieldsApi = {
  list: (params) => api.get('/custom-order-fields', { params }).then(unwrap),
  create: (body) => api.post('/custom-order-fields', body).then(unwrap),
  update: (id, body) => api.put(`/custom-order-fields/${id}`, body).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/custom-order-fields', id, body),
  reorder: (ordered_ids) =>
    api.post('/custom-order-fields/reorder', { ordered_ids }).then(unwrap),
};
