export function permissionEditorScope(shopId, role) {
  return `${shopId || ''}:${role || ''}`;
}

export function canEditLoadedRolePermissions({ shopId, role, authRole, currentServer, draftScope, loading, error }) {
  return Boolean(shopId) && ['super_admin', 'shop_admin'].includes(authRole) &&
    !['super_admin', 'shop_admin'].includes(role) && Boolean(role) &&
    Boolean(currentServer && typeof currentServer === 'object' && !Array.isArray(currentServer)) &&
    draftScope === permissionEditorScope(shopId, role) && !loading && !error;
}
