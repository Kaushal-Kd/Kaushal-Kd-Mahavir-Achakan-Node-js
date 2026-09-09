import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

export const washingQueueApi = {
  list: () => api.get('/washing-queue').then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/washing-queue', id, body),
  bulkRemove: (ids, admin_password) =>
    api.post('/washing-queue/bulk-remove', { ids, admin_password }).then(unwrap),
};
