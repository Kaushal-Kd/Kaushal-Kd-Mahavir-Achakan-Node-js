const USER_TTL_MS = 60_000;
const SHOP_ACCESS_TTL_MS = 60_000;

/** @type {Map<string, { user: object, expiresAt: number }>} */
const userCache = new Map();

/** @type {Map<string, { allowed: boolean, expiresAt: number }>} */
const shopAccessCache = new Map();

function safeParseJSON(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch {
    return null;
  }
}

function permissionsEmpty(perms) {
  if (!perms || typeof perms !== 'object') return true;
  return Object.keys(perms).length === 0;
}

/**
 * @param {string} userId
 */
export function invalidateAuthCacheForUser(userId) {
  const id = String(userId);
  userCache.delete(id);
  for (const key of shopAccessCache.keys()) {
    if (key.startsWith(`${id}:`)) shopAccessCache.delete(key);
  }
}

/**
 * @param {import('knex').Knex} db
 * @param {string} userId
 */
export async function loadCachedAuthUser(db, userId) {
  const id = String(userId);
  const now = Date.now();
  const hit = userCache.get(id);
  if (hit && hit.expiresAt > now) return hit.user;

  const user = await db('users').where({ id, is_active: true }).first();
  if (!user) return null;
  user.permissions = safeParseJSON(user.permissions);
  if (user.role !== 'super_admin' && permissionsEmpty(user.permissions)) {
    const { getPermissionsForRole } = await import('../modules/roles/service.js');
    const rolePerms = await getPermissionsForRole(user.role);
    if (rolePerms) user.permissions = rolePerms;
  }
  userCache.set(id, { user, expiresAt: now + USER_TTL_MS });
  return user;
}

/**
 * Hydrate permissions from role matrix when user snapshot is empty.
 * @param {object} user
 */
export async function hydrateUserPermissions(user) {
  if (!user || user.role === 'super_admin') return user;
  const perms = safeParseJSON(user.permissions);
  if (!permissionsEmpty(perms)) {
    user.permissions = perms;
    return user;
  }
  const { getPermissionsForRole } = await import('../modules/roles/service.js');
  const rolePerms = await getPermissionsForRole(user.role);
  user.permissions = rolePerms || {};
  return user;
}

/**
 * Applies the permission snapshot for one shop. Per-user overrides live on the
 * membership row; inherited users are refreshed from the shop role matrix.
 * @param {import('knex').Knex} db
 * @param {object} user
 * @param {string} shopId
 */
export async function hydrateShopPermissions(db, user, shopId) {
  if (!user || ['super_admin', 'shop_admin'].includes(user.role)) return user;
  const membership = await db('users_shops')
    .where({ user_id: user.id, shop_id: shopId })
    .first('permissions', 'permissions_overridden');
  if (!membership) return null;
  const stored = safeParseJSON(membership.permissions);
  if (membership.permissions_overridden && !permissionsEmpty(stored)) {
    user.permissions = stored;
    return user;
  }
  const { getPermissionsForRole } = await import('../modules/roles/service.js');
  user.permissions = (await getPermissionsForRole(user.role, shopId)) || stored || {};
  return user;
}

/**
 * @param {import('knex').Knex} db
 * @param {string} userId
 * @param {string} shopId
 * @param {string} role
 */
export async function hasCachedShopAccess(db, userId, shopId, role) {
  if (role === 'super_admin') return true;

  const key = `${String(userId)}:${String(shopId)}`;
  const now = Date.now();
  const hit = shopAccessCache.get(key);
  if (hit && hit.expiresAt > now) return hit.allowed;

  const access = await db('users_shops').where({ user_id: userId, shop_id: shopId }).first();
  const allowed = !!access;
  shopAccessCache.set(key, { allowed, expiresAt: now + SHOP_ACCESS_TTL_MS });
  return allowed;
}
