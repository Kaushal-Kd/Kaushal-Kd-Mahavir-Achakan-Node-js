import { api, unwrap } from '../api.js';

/**
 * @param {string} path e.g. `/customers`
 * @param {string} id
 * @param {{ admin_password?: string } | undefined} body
 */
export function deleteWithAdminPassword(path, id, body) {
  return api.delete(`${path}/${id}`, { data: body }).then(unwrap);
}
