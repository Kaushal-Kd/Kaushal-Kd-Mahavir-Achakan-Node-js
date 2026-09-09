import {
  ACTIONS,
  ALL_ROLES,
  ALL_PERMISSION_MODULES,
  defaultPermissionsByRole,
  MENU_PERMISSION_BY_KEY,
  ROLES,
} from '@wrs/shared';

import knex from '../../db/knex.js';

const ALL_ACTIONS = Object.values(ACTIONS);

export function parseStoredPermissions(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** @param {Record<string, Record<string, boolean>>} matrix */
export function normalizeMatrix(matrix) {
  const clean = {};
  for (const m of ALL_PERMISSION_MODULES) {
    clean[m] = {};
    const input = matrix?.[m] || matrix?.[MENU_PERMISSION_BY_KEY[m]?.parent] || {};
    for (const a of ALL_ACTIONS) {
      clean[m][a] = !!input[a];
    }
  }
  return clean;
}

export async function getEffectivePermissionsByRole(shopId = null) {
  const defaults = defaultPermissionsByRole();
  const stored = await knex('role_permissions').select('role', 'permissions');
  const byRole = {};
  for (const row of stored) {
    byRole[row.role] = parseStoredPermissions(row.permissions);
  }
  if (shopId) {
    const shopStored = await knex('shop_role_permissions')
      .where({ shop_id: shopId })
      .select('role', 'permissions');
    for (const row of shopStored) {
      byRole[row.role] = parseStoredPermissions(row.permissions);
    }
  }
  const out = {};
  for (const role of ALL_ROLES) {
    const base =
      role === ROLES.SUPER_ADMIN
        ? normalizeMatrix({})
        : normalizeMatrix(defaults[role] || {});
    if (role === ROLES.SUPER_ADMIN) {
      for (const m of ALL_PERMISSION_MODULES) {
        for (const a of ALL_ACTIONS) base[m][a] = true;
      }
    }
    if (byRole[role]) {
      out[role] = normalizeMatrix(byRole[role]);
      if (role === ROLES.SUPER_ADMIN) {
        for (const m of ALL_PERMISSION_MODULES) {
          for (const a of ALL_ACTIONS) out[role][m][a] = true;
        }
      }
    } else {
      out[role] = base;
    }
  }
  return out;
}

export async function getPermissionsForRole(role, shopId = null) {
  if (!ALL_ROLES.includes(role)) return null;
  const all = await getEffectivePermissionsByRole(shopId);
  return all[role] || null;
}

/**
 * @param {string} role
 * @param {Record<string, Record<string, boolean>>} permissions
 */
export async function syncUserPermissionsForRole(role, permissions, shopId = null) {
  const payload = JSON.stringify(permissions);
  if (shopId) {
    const rows = await knex('users_shops as us')
      .join('users as u', 'u.id', 'us.user_id')
      .where('us.shop_id', shopId)
      .andWhere('u.role', role)
      .andWhere('us.permissions_overridden', false)
      .select('us.user_id');
    const userIds = rows.map((row) => row.user_id);
    if (userIds.length) {
      await knex('users_shops')
        .where({ shop_id: shopId, permissions_overridden: false })
        .whereIn('user_id', userIds)
        .update({ permissions: payload });
    }
    return userIds;
  }
  // Users whose grid was customised on the user screen keep it — a role save
  // must not silently wipe per-user overrides.
  await knex('users').where({ role, permissions_overridden: false }).update({
    permissions: payload,
    updated_at: knex.fn.now(),
  });
  return knex('users').where({ role, permissions_overridden: false }).pluck('id');
}
