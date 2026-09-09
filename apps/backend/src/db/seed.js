import { defaultPermissionsByRole } from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import { env } from '../config/env.js';
import { hashPassword } from '../utils/password.js';
import knex from './knex.js';

async function seed() {
  console.info('[seed] Starting...');

  const existing = await knex('users')
    .whereRaw('LOWER(email) = ?', [env.SEED_ADMIN_EMAIL.toLowerCase()])
    .first();

  let shop = await knex('shops').where({ shop_name: env.SEED_SHOP_NAME }).first();
  if (!shop) {
    const shopId = uuid();
    await knex('shops').insert({
      id: shopId,
      company_name: env.SEED_SHOP_NAME,
      shop_name: env.SEED_SHOP_NAME,
      owner_name: env.SEED_ADMIN_NAME,
      city: 'Ahmedabad',
      state: 'Gujarat',
    });
    shop = await knex('shops').where({ id: shopId }).first();
    console.info(`[seed] Created shop: ${shop.shop_name}`);
  }

  let userId = existing?.id;
  if (!existing) {
    userId = uuid();
    const perms = defaultPermissionsByRole().super_admin;
    await knex('users').insert({
      id: userId,
      name: env.SEED_ADMIN_NAME,
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      phone: env.SEED_ADMIN_PHONE,
      login_phone: env.SEED_ADMIN_PHONE,
      password_hash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'super_admin',
      permissions: JSON.stringify(perms),
      must_change_password: true,
      primary_shop_id: shop.id,
      last_selected_shop_id: shop.id,
    });
    console.info(`[seed] Created super admin: ${env.SEED_ADMIN_EMAIL}`);
  } else {
    console.info('[seed] Super admin already exists, skipping.');
  }

  await knex('users_shops')
    .insert({
      user_id: userId,
      shop_id: shop.id,
      is_default: true,
      permissions: JSON.stringify(defaultPermissionsByRole().super_admin),
      permissions_overridden: false,
    })
    .onConflict(['user_id', 'shop_id'])
    .merge({ is_default: true });

  console.info('[seed] Done.');
  await knex.destroy();
}

seed().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
