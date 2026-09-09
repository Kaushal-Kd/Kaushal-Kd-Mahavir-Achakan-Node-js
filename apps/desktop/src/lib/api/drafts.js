import { api, unwrap } from '../api.js';
import { deleteWithAdminPassword } from './deleteWithAdminPassword.js';

/**
 * Drafts API — persistent scratchpad rows for things like the shared
 * availability cart. Each draft has a `kind`, an arbitrary JSON `data` payload,
 * and is scoped to the current shop. The user who created it is joined in as
 * `user_name` / `user_email` on list responses.
 */
export const draftsApi = {
  list: (params) => api.get('/drafts', { params }).then(unwrap),
  create: (payload) => api.post('/drafts', payload).then(unwrap),
  update: (id, payload) => api.put(`/drafts/${id}`, payload).then(unwrap),
  remove: (id, body) => deleteWithAdminPassword('/drafts', id, body),
  bulkDelete: (payload) => api.post('/drafts/bulk-delete', payload).then(unwrap),
};
