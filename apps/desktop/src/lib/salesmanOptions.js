import { ROLES } from '@wrs/shared';

/** Users who must not appear in salesman / sales-person pickers. */
export function isSalesmanEligibleUser(user) {
  if (!user?.id) return false;
  if (user.is_active === false) return false;
  return user.role !== ROLES.SUPER_ADMIN && user.role !== 'super_admin';
}

function userBelongsToShop(user, shopId) {
  if (!shopId || !user) return true;
  const ids = user.shop_ids;
  if (!Array.isArray(ids) || ids.length === 0) return true;
  return ids.includes(shopId);
}

/**
 * @param {Array<{ id: string, name?: string, email?: string, role?: string, is_active?: boolean, shop_ids?: string[] }>} users
 * @param {{ id?: string, name?: string, email?: string, role?: string, shop_ids?: string[] }|null|undefined} currentUser
 * @param {Array<{ id?: string, label?: string }>} extra
 * @param {string|null} [shopId]
 * @returns {Array<{ value: string, label: string }>}
 */
export function buildSalesmanSelectOptions(users, currentUser, extra = [], shopId = null) {
  const byId = new Map();
  const add = (id, label) => {
    if (!id) return;
    const name = String(label || '').trim() || 'User';
    if (!byId.has(id)) byId.set(id, name);
  };

  for (const u of users || []) {
    if (!isSalesmanEligibleUser(u)) continue;
    if (!userBelongsToShop(u, shopId)) continue;
    add(u.id, u.name || u.email);
  }

  const currentInList = currentUser?.id && byId.has(currentUser.id);
  const currentInShop =
    isSalesmanEligibleUser(currentUser) &&
    shopId &&
    Array.isArray(currentUser.shop_ids) &&
    currentUser.shop_ids.includes(shopId);
  if (currentInList || currentInShop) {
    add(currentUser.id, currentUser.name || currentUser.email);
  } else if (isSalesmanEligibleUser(currentUser) && !shopId) {
    add(currentUser.id, currentUser.name || currentUser.email);
  }

  for (const row of extra) {
    add(row.id, row.label);
  }

  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
