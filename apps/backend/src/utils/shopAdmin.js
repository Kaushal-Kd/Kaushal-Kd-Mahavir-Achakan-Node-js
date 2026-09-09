import knex from '../db/knex.js';
import { forbidden } from './errors.js';
import { verifyPassword } from './password.js';

/**
 * Verify plain password against any active shop_admin linked to the shop.
 * @param {string} shopId
 * @param {string} plainPassword
 */
export async function verifyShopAdminPassword(shopId, plainPassword) {
  if (!shopId) {
    throw forbidden('Shop context is required');
  }

  const admins = await knex('users')
    .join('users_shops as us', 'users.id', 'us.user_id')
    .where({
      'users.role': 'shop_admin',
      'users.is_active': true,
      'us.shop_id': shopId,
    })
    .select('users.password_hash');

  if (!admins.length) {
    throw forbidden('Your Shop Admin password is incorrect. Please try again.');
  }

  const password = String(plainPassword || '');
  for (const admin of admins) {
    if (await verifyPassword(password, admin.password_hash)) return;
  }
  throw forbidden('Your Shop Admin password is incorrect. Please try again.');
}
