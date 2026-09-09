import { ROLES } from '@wrs/shared';

/** Users who must not appear in salesman / sales-person pickers. */
export function isSalesmanEligibleUser(user) {
  if (!user?.id) return false;
  if (user.is_active === false) return false;
  return user.role !== ROLES.SUPER_ADMIN && user.role !== 'super_admin';
}

/**
 * @param {Array<{ id: string, name?: string, email?: string, role?: string, is_active?: boolean }>} users
 * @param {{ id?: string, name?: string, email?: string, role?: string }|null|undefined} currentUser
 * @param {Array<{ id?: string, label?: string }>} extra
 * @returns {Array<{ value: string, label: string }>}
 */
export function buildSalesmanSelectOptions(users, currentUser, extra = []) {
  const byId = new Map();
  const add = (id, label) => {
    if (!id) return;
    const name = String(label || '').trim() || 'User';
    if (!byId.has(id)) byId.set(id, name);
  };

  for (const u of users || []) {
    if (!isSalesmanEligibleUser(u)) continue;
    add(u.id, u.name || u.email);
  }
  if (isSalesmanEligibleUser(currentUser)) {
    add(currentUser.id, currentUser.name || currentUser.email);
  }
  for (const row of extra) {
    add(row.id, row.label);
  }

  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
