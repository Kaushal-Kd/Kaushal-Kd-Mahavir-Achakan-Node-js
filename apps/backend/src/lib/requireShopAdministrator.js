import { forbidden } from '../utils/errors.js';

export async function requireShopAdministrator(db, shopId, actorId) {
  const user = await db('users').where({ id: actorId, is_active: true }).first('id', 'role');
  if (!user || !['super_admin', 'shop_admin'].includes(user.role))
    throw forbidden('A shop administrator is required');
  const shop = await db('shops').where({ id: shopId, is_active: true }).first('id');
  if (
    !shop ||
    (user.role !== 'super_admin' &&
      !(await db('users_shops').where({ shop_id: shopId, user_id: actorId }).first()))
  )
    throw forbidden('You do not administer this shop');
  return user;
}
