import {
  createUserSchema,
  loginModeSchema,
  salesmanCommissionSchema,
  updateUserSchema,
} from '@wrs/shared';
import { v4 as uuid } from 'uuid';

import { invalidateAuthCacheForUser } from '../../lib/authCache.js';
import { isOnline } from '../../lib/presence.js';
import knex from '../../db/knex.js';
import { badRequest, forbidden, notFound, conflict } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { hashPassword } from '../../utils/password.js';
import { validate } from '../../utils/validate.js';

import { revokeAllRefreshTokens, sanitizeUser } from '../auth/service.js';
import { getPermissionsForRole, parseStoredPermissions } from '../roles/service.js';
import { shopEmailService } from '../shop-email/service.js';
import { assessLoginReadiness } from './loginReadiness.js';

function normalizeUsername(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function normalizeLoginPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? digits : null;
}

async function assertLoginPhoneAvailable(phone, excludeUserId = null) {
  let qb = knex('users').where({ login_phone: phone });
  if (excludeUserId) qb = qb.whereNot('id', excludeUserId);
  if (await qb.first('id')) throw conflict('Phone number already used for login');
}

function assertTargetRoleAllowed(actor, targetRole) {
  if (actor.role === 'super_admin') return;
  if (actor.role !== 'shop_admin') throw forbidden('Only admins can manage users');
  if (['super_admin', 'shop_admin'].includes(targetRole)) {
    throw forbidden('Shop Admin cannot manage administrator accounts');
  }
}

const COMMISSION_MEMBERSHIP_FIELDS = [
  'commission_basis',
  'commission_rate',
  'manager_user_id',
  'self_booking_commission_rate',
  'self_product_commission_rate',
  'managed_booking_commission_rate',
  'managed_product_commission_rate',
];

function serializeCommissionMembership(row, categoryRates = []) {
  return {
    commission_basis: row?.commission_basis || null,
    commission_rate: Number(row?.commission_rate || 0),
    manager_user_id: row?.manager_user_id || null,
    manager_name: row?.manager_name || null,
    self_booking_rate: Number(row?.self_booking_commission_rate || 0),
    self_product_rate: Number(row?.self_product_commission_rate || 0),
    managed_booking_rate: Number(row?.managed_booking_commission_rate || 0),
    managed_product_rate: Number(row?.managed_product_commission_rate || 0),
    category_rates: categoryRates.map((rate) => ({
      category_id: rate.category_id,
      category_label: rate.category_label || null,
      self_rate: Number(rate.self_rate || 0),
      managed_rate: Number(rate.managed_rate || 0),
    })),
  };
}

async function assertUsernameAvailable(username, excludeUserId = null) {
  if (!username) return;
  let qb = knex('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]);
  if (excludeUserId) qb = qb.whereNot('id', excludeUserId);
  const dup = await qb.first();
  if (dup) throw conflict('Username already in use');
}

export default async function userRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', fastify.requireShop);

  fastify.get('/login-readiness', async (request) => {
    if (request.authUser.role !== 'super_admin') {
      throw forbidden('Only Super Admin can manage login transition');
    }
    const users = await knex('users').select(
      'id',
      'name',
      'role',
      'phone',
      'login_phone',
      'email',
      'is_active'
    );
    const setting = await knex('system_settings')
      .where({ setting_key: 'auth.login_mode' })
      .first('setting_value');
    return {
      ok: true,
      data: {
        mode: setting?.setting_value === 'phone_only' ? 'phone_only' : 'dual_transition',
        ...assessLoginReadiness(users),
        email_otp_configured: (await shopEmailService.getReadiness(request.shopId)).configured,
        email_otp_shop_id: request.shopId,
      },
    };
  });

  fastify.patch('/login-mode', async (request) => {
    if (request.authUser.role !== 'super_admin') {
      throw forbidden('Only Super Admin can manage login transition');
    }
    const body = validate(loginModeSchema, request.body || {});
    if (body.mode === 'phone_only') {
      const users = await knex('users').select(
        'id',
        'name',
        'role',
        'phone',
        'login_phone',
        'email',
        'is_active'
      );
      if (!assessLoginReadiness(users).ready_for_phone_only) {
        throw badRequest(
          'Resolve all phone and admin email issues before enabling phone-only login'
        );
      }
    }
    await knex('system_settings')
      .insert({
        setting_key: 'auth.login_mode',
        setting_value: body.mode,
        updated_by_user_id: request.authUser.id,
      })
      .onConflict('setting_key')
      .merge({
        setting_value: body.mode,
        updated_by_user_id: request.authUser.id,
        updated_at: knex.fn.now(),
      });
    await request.audit('system_settings', 'UPDATE', {
      id: 'auth.login_mode',
      new: { mode: body.mode },
    });
    return { ok: true, data: { mode: body.mode } };
  });

  fastify.get('/', async (request) => {
    const shopId = request.shopId;

    let qb = knex('users').whereNot('users.role', 'super_admin');
    if (request.query.is_active !== undefined) {
      const raw = String(request.query.is_active).toLowerCase();
      if (raw === 'true' || raw === '1') qb = qb.where({ is_active: true });
      else if (raw === 'false' || raw === '0') qb = qb.where({ is_active: false });
    }

    if (shopId) {
      if (request.authUser.role !== 'super_admin') {
        const allowed = await knex('users_shops')
          .where({ user_id: request.authUser.id, shop_id: shopId })
          .first();
        if (!allowed) throw forbidden('No access to this shop');
      }
      qb = qb
        .join('users_shops as us', 'users.id', 'us.user_id')
        .where('us.shop_id', shopId)
        .groupBy('users.id')
        .select('users.*');
    } else if (request.authUser.role !== 'super_admin') {
      const scope = await knex('users_shops')
        .where({ user_id: request.authUser.id })
        .pluck('shop_id');
      if (!scope.length) {
        return {
          ok: true,
          data: [],
          meta: {
            total: 0,
            page: Math.max(1, Number(request.query.page) || 1),
            per_page: Math.min(200, Math.max(1, Number(request.query.per_page) || 25)),
            total_pages: 0,
          },
        };
      }
      qb = qb
        .join('users_shops as us', 'users.id', 'us.user_id')
        .whereIn('us.shop_id', scope)
        .groupBy('users.id')
        .select('users.*');
    }

    const result = await paginate(qb, {
      page: request.query.page,
      per_page: request.query.per_page,
      search: request.query.search,
      sort: request.query.sort || 'name',
      search_fields: ['name', 'email', 'phone', 'username'],
    });
    const userIds = result.data.map((u) => u.id).filter(Boolean);
    const shopRows = userIds.length
      ? await knex('users_shops as us')
          .join('shops as s', 's.id', 'us.shop_id')
          .leftJoin('users as manager', 'manager.id', 'us.manager_user_id')
          .whereIn('us.user_id', userIds)
          .select(
            'us.user_id',
            's.id as shop_id',
            's.shop_name',
            ...COMMISSION_MEMBERSHIP_FIELDS.map((field) => `us.${field}`),
            'manager.name as manager_name',
            'us.permissions',
            'us.permissions_overridden'
          )
      : [];
    const categoryRows =
      shopId && userIds.length
        ? await knex('commission_category_rates as ccr')
            .join('categories as c', 'c.id', 'ccr.category_id')
            .where('ccr.shop_id', shopId)
            .whereIn('ccr.user_id', userIds)
            .select('ccr.*', 'c.label as category_label')
        : [];
    const categoryRatesByUser = new Map();
    for (const rate of categoryRows) {
      const previous = categoryRatesByUser.get(rate.user_id) || [];
      previous.push(rate);
      categoryRatesByUser.set(rate.user_id, previous);
    }
    const shopsByUser = new Map();
    for (const r of shopRows) {
      const prev = shopsByUser.get(r.user_id) || [];
      prev.push({
        id: r.shop_id,
        name: r.shop_name,
        ...serializeCommissionMembership(r, categoryRatesByUser.get(r.user_id) || []),
        permissions: parseStoredPermissions(r.permissions),
        permissions_overridden: Boolean(r.permissions_overridden),
      });
      shopsByUser.set(r.user_id, prev);
    }
    result.data = result.data.map((row) => {
      const clean = sanitizeUser(row);
      const shops = shopsByUser.get(row.id) || [];
      return {
        ...clean,
        is_online: isOnline(row.last_seen_at),
        shop_ids: shops.map((s) => s.id),
        shop_names: shops.map((s) => s.name),
        ...(shopId
          ? shops.find((shop) => shop.id === shopId) || serializeCommissionMembership(null)
          : serializeCommissionMembership(null)),
        permissions: shopId
          ? shops.find((shop) => shop.id === shopId)?.permissions || clean.permissions
          : clean.permissions,
        permissions_overridden: shopId
          ? Boolean(shops.find((shop) => shop.id === shopId)?.permissions_overridden)
          : Boolean(clean.permissions_overridden),
      };
    });
    return { ok: true, ...result };
  });

  fastify.get('/:id', async (request) => {
    const row = await knex('users').where({ id: request.params.id }).first();
    if (!row) throw notFound('User not found');
    assertTargetRoleAllowed(request.authUser, row.role);
    const shopRows = await knex('users_shops as us')
      .leftJoin('users as manager', 'manager.id', 'us.manager_user_id')
      .where({ 'us.user_id': row.id })
      .select(
        'us.shop_id',
        ...COMMISSION_MEMBERSHIP_FIELDS.map((field) => `us.${field}`),
        'manager.name as manager_name',
        'us.permissions',
        'us.permissions_overridden'
      );
    const selectedShopId = request.shopId;
    const selectedShop = shopRows.find((shop) => shop.shop_id === selectedShopId);
    if (!selectedShop && request.authUser.role !== 'super_admin') {
      throw forbidden('User is not assigned to this shop');
    }
    const categoryRates = selectedShop
      ? await knex('commission_category_rates as ccr')
          .join('categories as c', 'c.id', 'ccr.category_id')
          .where({ 'ccr.shop_id': selectedShopId, 'ccr.user_id': row.id })
          .select('ccr.*', 'c.label as category_label')
          .orderBy('c.label')
      : [];
    return {
      ok: true,
      data: {
        ...sanitizeUser(row),
        shop_ids: shopRows.map((shop) => shop.shop_id),
        ...serializeCommissionMembership(selectedShop, categoryRates),
        permissions: parseStoredPermissions(selectedShop?.permissions),
        permissions_overridden: Boolean(selectedShop?.permissions_overridden),
      },
    };
  });

  fastify.put('/:id/commission', async (request) => {
    if (!['super_admin', 'shop_admin'].includes(request.authUser.role)) {
      throw forbidden('Only shop administrators can edit commission settings');
    }
    const shopId = String(request.headers['x-shop-id'] || '').trim();
    if (!shopId) throw forbidden('Select a shop before editing commission settings');
    if (request.authUser.role !== 'super_admin') {
      const adminScope = await knex('users_shops')
        .where({ user_id: request.authUser.id, shop_id: shopId })
        .first();
      if (!adminScope) throw forbidden('No access to this shop');
    }
    const body = validate(salesmanCommissionSchema, request.body || {});
    const target = await knex('users').where({ id: request.params.id }).first('id', 'role');
    if (!target) throw notFound('User not found');
    if (!['salesman', 'manager'].includes(target.role)) {
      throw badRequest('Commission settings apply only to salesmen and managers');
    }
    const before = await knex('users_shops')
      .where({ user_id: request.params.id, shop_id: shopId })
      .first();
    if (!before) throw notFound('User is not assigned to this shop');
    if (body.manager_user_id) {
      if (target.role !== 'salesman') {
        throw badRequest('Only a salesman can be assigned to a manager');
      }
      const manager = await knex('users_shops as us')
        .join('users as u', 'u.id', 'us.user_id')
        .where({ 'us.shop_id': shopId, 'us.user_id': body.manager_user_id, 'u.role': 'manager' })
        .first('u.id');
      if (!manager) throw badRequest('Selected manager is not assigned to this shop');
    }

    const categoryRates = body.category_rates || [];
    if (new Set(categoryRates.map((rate) => rate.category_id)).size !== categoryRates.length) {
      throw badRequest('Each product category can have only one commission rate');
    }
    if (categoryRates.length) {
      const validCategoryIds = await knex('categories')
        .where({ shop_id: shopId, category_type: 'product' })
        .whereIn(
          'id',
          categoryRates.map((rate) => rate.category_id)
        )
        .pluck('id');
      if (validCategoryIds.length !== categoryRates.length) {
        throw badRequest('One or more commission categories do not belong to this shop');
      }
    }

    let selfBookingRate = Number(body.self_booking_rate ?? 0);
    let selfProductRate = Number(body.self_product_rate ?? 0);
    if (body.basis !== undefined) {
      selfBookingRate = body.basis === 'booking' ? Number(body.rate || 0) : 0;
      selfProductRate = body.basis === 'product' ? Number(body.rate || 0) : 0;
    }
    const managedBookingRate =
      target.role === 'manager' ? Number(body.managed_booking_rate || 0) : 0;
    const managedProductRate =
      target.role === 'manager' ? Number(body.managed_product_rate || 0) : 0;
    const legacyBasis =
      selfBookingRate > 0 && selfProductRate === 0
        ? 'booking'
        : selfProductRate > 0 && selfBookingRate === 0
          ? 'product'
          : null;
    const legacyRate =
      legacyBasis === 'booking' ? selfBookingRate : legacyBasis === 'product' ? selfProductRate : 0;

    await knex.transaction(async (trx) => {
      await trx('users_shops')
        .where({ user_id: request.params.id, shop_id: shopId })
        .update({
          commission_basis: legacyBasis,
          commission_rate: legacyRate,
          manager_user_id: target.role === 'salesman' ? body.manager_user_id || null : null,
          self_booking_commission_rate: selfBookingRate,
          self_product_commission_rate: selfProductRate,
          managed_booking_commission_rate: managedBookingRate,
          managed_product_commission_rate: managedProductRate,
        });
      if (body.category_rates !== undefined) {
        await trx('commission_category_rates')
          .where({ user_id: request.params.id, shop_id: shopId })
          .delete();
        const rows = categoryRates
          .map((rate) => ({
            id: uuid(),
            shop_id: shopId,
            user_id: request.params.id,
            category_id: rate.category_id,
            self_rate: rate.self_rate,
            managed_rate: target.role === 'manager' ? rate.managed_rate : 0,
          }))
          .filter((rate) => Number(rate.self_rate) > 0 || Number(rate.managed_rate) > 0);
        if (rows.length) await trx('commission_category_rates').insert(rows);
      }
    });
    const after = await knex('users_shops')
      .where({ user_id: request.params.id, shop_id: shopId })
      .first();
    await request.audit('users_shops', 'UPDATE_COMMISSION', {
      id: `${request.params.id}:${shopId}`,
      old: before,
      new: after,
    });
    return {
      ok: true,
      data: {
        ...serializeCommissionMembership(
          after,
          await knex('commission_category_rates').where({
            user_id: request.params.id,
            shop_id: shopId,
          })
        ),
      },
    };
  });

  fastify.post('/', async (request) => {
    if (!['super_admin', 'shop_admin'].includes(request.authUser.role)) {
      throw forbidden('Only admins can create users');
    }
    const body = validate(createUserSchema, request.body);
    assertTargetRoleAllowed(request.authUser, body.role);
    if (body.email) {
      const existing = await knex('users').whereRaw('LOWER(email) = ?', [body.email]).first();
      if (existing) throw conflict('Email already in use');
    }
    const loginPhone = normalizeLoginPhone(body.phone);
    await assertLoginPhoneAvailable(loginPhone);
    const username = normalizeUsername(body.username);
    await assertUsernameAvailable(username);
    const id = uuid();
    // If the caller didn't pass an explicit permission grid, snapshot the
    // current effective matrix for the role (stored overrides ∪ defaults).
    // Super-admins are always full-access at runtime, so leave their row null.
    let permissions = body.permissions || null;
    const shopIds =
      request.authUser.role === 'shop_admin'
        ? [request.shopId]
        : [...new Set(body.shop_ids?.length ? body.shop_ids : [request.shopId])];
    if (!permissions && body.role && body.role !== 'super_admin') {
      permissions = await getPermissionsForRole(body.role, shopIds[0]);
    }
    await knex('users').insert({
      id,
      name: body.name,
      email: body.email || null,
      phone: loginPhone,
      login_phone: loginPhone,
      phone2: body.phone2 || null,
      address: body.address || null,
      remark: body.remark || null,
      username,
      role: body.role,
      password_hash: await hashPassword(body.password),
      permissions: permissions ? JSON.stringify(permissions) : null,
      // Only an explicitly supplied grid counts as customised. A role snapshot
      // must stay in the role-wide sync, or the user would silently stop
      // tracking their role from the moment they were created.
      permissions_overridden: !!body.permissions,
      must_change_password: true,
    });
    for (const sid of shopIds) {
      const scopedPermissions = body.permissions || (await getPermissionsForRole(body.role, sid));
      await knex('users_shops')
        .insert({
          user_id: id,
          shop_id: sid,
          permissions: scopedPermissions ? JSON.stringify(scopedPermissions) : null,
          permissions_overridden: Boolean(body.permissions),
        })
        .onConflict()
        .ignore();
    }
    const row = await knex('users').where({ id }).first();
    await request.audit('users', 'CREATE', { id, new: sanitizeUser(row) });
    return { ok: true, data: sanitizeUser(row) };
  });

  fastify.put(
    '/:id',
    {
      // Setting another user's password is gated on the Shop Admin ("Master")
      // password. Ordinary profile edits are not — the gate only applies when
      // a password is actually being changed.
      preHandler: async (request) => {
        if (request.body?.password) await fastify.requireShopAdminPassword(request);
      },
    },
    async (request) => {
      const id = request.params.id;
      const body = validate(updateUserSchema, { ...request.body, id });
      const before = await knex('users').where({ id }).first();
      if (!before) throw notFound('User not found');
      assertTargetRoleAllowed(request.authUser, before.role);
      if (body.role) assertTargetRoleAllowed(request.authUser, body.role);
      const currentMembership = await knex('users_shops')
        .where({ user_id: id, shop_id: request.shopId })
        .first();
      if (!currentMembership && request.authUser.role !== 'super_admin') {
        throw forbidden('User is not assigned to this shop');
      }
      if (body.password && ['super_admin', 'shop_admin'].includes(before.role)) {
        throw badRequest('Administrator passwords must be changed using email OTP');
      }
      const patch = {};
      for (const k of [
        'name',
        'email',
        'phone',
        'phone2',
        'address',
        'remark',
        'username',
        'role',
        'is_active',
      ]) {
        if (body[k] !== undefined) patch[k] = body[k] === '' ? null : body[k];
      }
      if (patch.username !== undefined) {
        patch.username = normalizeUsername(patch.username);
        await assertUsernameAvailable(patch.username, id);
      }
      if (patch.email !== undefined) {
        // `email` is NOT NULL and unique — never blank it, and reject a clash the
        // same way create does rather than surfacing a raw DB error.
        if (patch.email && patch.email !== before.email) {
          const clash = await knex('users')
            .whereRaw('LOWER(email) = ?', [String(patch.email).toLowerCase()])
            .whereNot('id', id)
            .first();
          if (clash) throw conflict('Email already in use');
        }
      }
      const effectiveRole = body.role ?? before.role;
      const effectiveEmail = patch.email !== undefined ? patch.email : before.email;
      if (['super_admin', 'shop_admin'].includes(effectiveRole) && !effectiveEmail) {
        throw badRequest('Email is required for administrator password OTP');
      }
      if (body.phone !== undefined) {
        const loginPhone = normalizeLoginPhone(body.phone);
        await assertLoginPhoneAvailable(loginPhone, id);
        patch.phone = loginPhone;
        patch.login_phone = loginPhone;
      }
      if (body.password) {
        patch.password_hash = await hashPassword(body.password);
        patch.password_changed_at = knex.fn.now();
      }
      patch.updated_at = knex.fn.now();
      await knex('users').where({ id }).update(patch);
      if (body.password) {
        // Force every existing session for this user to re-authenticate with the
        // new password rather than riding an old refresh token.
        await revokeAllRefreshTokens(id);
      }
      if (body.permissions && currentMembership) {
        await knex('users_shops')
          .where({ user_id: id, shop_id: request.shopId })
          .update({
            permissions: JSON.stringify(body.permissions),
            permissions_overridden: true,
          });
      } else if (body.permissions_overridden === false && currentMembership) {
        const perms = await getPermissionsForRole(effectiveRole, request.shopId);
        await knex('users_shops')
          .where({ user_id: id, shop_id: request.shopId })
          .update({
            permissions: perms ? JSON.stringify(perms) : null,
            permissions_overridden: false,
          });
      }
      if (body.role !== undefined && body.role !== before.role) {
        const inheritedMemberships = await knex('users_shops')
          .where({ user_id: id, permissions_overridden: false })
          .select('shop_id');
        for (const membership of inheritedMemberships) {
          const perms = await getPermissionsForRole(body.role, membership.shop_id);
          await knex('users_shops')
            .where({ user_id: id, shop_id: membership.shop_id })
            .update({ permissions: perms ? JSON.stringify(perms) : null });
        }
      }
      if (Array.isArray(body.shop_ids) && request.authUser.role === 'super_admin') {
        const desired = new Set(body.shop_ids);
        const memberships = await knex('users_shops').where({ user_id: id }).select('shop_id');
        const existing = new Set(memberships.map((membership) => membership.shop_id));
        const removed = [...existing].filter((shopId) => !desired.has(shopId));
        if (removed.length) {
          await knex('users_shops').where({ user_id: id }).whereIn('shop_id', removed).del();
        }
        for (const sid of [...desired].filter((shopId) => !existing.has(shopId))) {
          const perms = await getPermissionsForRole(effectiveRole, sid);
          await knex('users_shops').insert({
            user_id: id,
            shop_id: sid,
            permissions: perms ? JSON.stringify(perms) : null,
            permissions_overridden: false,
          });
        }
      }
      const after = await knex('users').where({ id }).first();
      const afterMembership = await knex('users_shops')
        .where({ user_id: id, shop_id: request.shopId })
        .first('permissions', 'permissions_overridden');
      invalidateAuthCacheForUser(id);
      await request.audit('users', 'UPDATE', {
        id,
        old: sanitizeUser(before),
        new: sanitizeUser(after),
      });
      return {
        ok: true,
        data: {
          ...sanitizeUser(after),
          permissions: parseStoredPermissions(afterMembership?.permissions),
          permissions_overridden: Boolean(afterMembership?.permissions_overridden),
        },
      };
    }
  );

  // Soft-delete: deactivate + revoke all refresh tokens so the user is
  // immediately logged out. The row is preserved to keep historical audit /
  // order trails intact.
  fastify.delete('/:id', { preHandler: fastify.requireShopAdminPassword }, async (request) => {
    if (!['super_admin', 'shop_admin'].includes(request.authUser.role)) {
      throw forbidden('Only admins can delete users');
    }
    const id = request.params.id;
    if (id === request.authUser.id) throw forbidden('You cannot delete yourself');
    const before = await knex('users').where({ id }).first();
    if (!before) throw notFound('User not found');
    assertTargetRoleAllowed(request.authUser, before.role);
    if (request.authUser.role === 'shop_admin') {
      const membership = await knex('users_shops')
        .where({ user_id: id, shop_id: request.shopId })
        .first('user_id');
      if (!membership) throw forbidden('User is not assigned to this shop');
    }
    await knex('users').where({ id }).update({ is_active: false, updated_at: knex.fn.now() });
    await knex('refresh_tokens').where({ user_id: id }).update({ revoked_at: knex.fn.now() });
    await request.audit('users', 'DELETE', { id, old: sanitizeUser(before) });
    return { ok: true, data: { id } };
  });
}
