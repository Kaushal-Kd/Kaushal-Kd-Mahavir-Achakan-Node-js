import { useAuthStore } from '../../stores/authStore.js';
import { api, unwrap } from '../api.js';

const path = (shopId) => `/shop-email-settings/${encodeURIComponent(shopId)}`;

function requestScope(shopId) {
  const user = useAuthStore.getState().user;
  return { wrsEmailScope: { shopId, userId: user?.id, role: user?.role } };
}

export const shopEmailSettingsApi = {
  get: (shopId) => api.get(path(shopId), requestScope(shopId)).then(unwrap),
  save: (shopId, body) => api.put(path(shopId), body, requestScope(shopId)).then(unwrap),
  test: (shopId, revision) =>
    api
      .post(`${path(shopId)}/test`, { expected_revision: revision }, requestScope(shopId))
      .then(unwrap),
};
