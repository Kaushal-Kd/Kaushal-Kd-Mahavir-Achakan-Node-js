import ipaddr from 'ipaddr.js';

import knex from '../../db/knex.js';
import { badRequest, ipAccessDenied, notFound } from '../../utils/errors.js';

const GLOBAL_CONFIG_ID = 1;

function parseStoredRanges(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeAddress(address) {
  if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) {
    return address.toIPv4Address();
  }
  return address;
}

function canonicalAddress(address) {
  const normalized = normalizeAddress(address);
  return normalized.kind() === 'ipv6' && normalized.toNormalizedString
    ? normalized.toNormalizedString()
    : normalized.toString();
}

function networkAddress(address, prefix) {
  const bytes = address.toByteArray();
  const wholeBytes = Math.floor(prefix / 8);
  const remainingBits = prefix % 8;
  if (remainingBits && wholeBytes < bytes.length) {
    bytes[wholeBytes] &= 0xff << (8 - remainingBits);
  }
  for (let index = wholeBytes + (remainingBits ? 1 : 0); index < bytes.length; index += 1) {
    bytes[index] = 0;
  }
  return ipaddr.fromByteArray(bytes);
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeIpRange(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('IP address or CIDR range is required');
  try {
    if (!input.includes('/')) return canonicalAddress(ipaddr.process(input));
    let [address, prefix] = ipaddr.parseCIDR(input);
    if (address.kind() === 'ipv6' && address.isIPv4MappedAddress() && prefix < 96) {
      throw new Error('IPv4-mapped IPv6 CIDR ranges must use a prefix from /96 to /128');
    }
    if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) {
      address = address.toIPv4Address();
      prefix -= 96;
    }
    return `${canonicalAddress(networkAddress(address, prefix))}/${prefix}`;
  } catch {
    throw new Error(`Invalid IP address or CIDR range: ${input}`);
  }
}

/**
 * @param {string[]} values
 * @param {number} maxItems
 */
export function normalizeAllowedRanges(values, maxItems) {
  const normalized = [];
  const seen = new Set();
  for (const value of values || []) {
    const rule = normalizeIpRange(value);
    if (seen.has(rule)) continue;
    seen.add(rule);
    normalized.push(rule);
  }
  if (normalized.length > maxItems) {
    throw new Error(`A maximum of ${maxItems} IP addresses or CIDR ranges is allowed`);
  }
  return normalized;
}

function parseClientIp(value) {
  try {
    return normalizeAddress(ipaddr.process(String(value || '').trim()));
  } catch {
    return null;
  }
}

/**
 * @param {string} clientIp
 * @param {string[]} allowedRanges
 */
export function ipMatchesAllowedRanges(clientIp, allowedRanges) {
  const address = parseClientIp(clientIp);
  if (!address) return false;
  return (allowedRanges || []).some((rule) => {
    try {
      const input = String(rule).trim();
      if (!input.includes('/')) {
        const exact = normalizeAddress(ipaddr.process(input));
        return (
          address.kind() === exact.kind() && canonicalAddress(address) === canonicalAddress(exact)
        );
      }
      let [network, prefix] = ipaddr.parseCIDR(input);
      if (network.kind() === 'ipv6' && network.isIPv4MappedAddress() && prefix >= 96) {
        network = network.toIPv4Address();
        prefix -= 96;
      }
      network = normalizeAddress(network);
      return address.kind() === network.kind() && address.match(network, prefix);
    } catch {
      return false;
    }
  });
}

/**
 * Pure policy precedence used by runtime enforcement and unit tests.
 */
export function evaluateIpAccess({
  role,
  userMode = 'inherit',
  userAllowedRanges = [],
  globalEnabled = false,
  globalAllowedRanges = [],
  clientIp,
}) {
  if (role === 'super_admin') {
    return {
      allowed: true,
      restricted: false,
      effective_mode: 'super_admin_bypass',
      allowed_ranges: [],
    };
  }

  let restricted = false;
  let effectiveMode = 'unrestricted';
  let allowedRanges = [];
  if (userMode === 'anywhere') {
    effectiveMode = 'anywhere';
  } else if (userMode === 'restricted') {
    restricted = true;
    effectiveMode = 'user_restricted';
    allowedRanges = userAllowedRanges;
  } else if (globalEnabled) {
    restricted = true;
    effectiveMode = 'global_restricted';
    allowedRanges = globalAllowedRanges;
  }

  return {
    allowed: !restricted || ipMatchesAllowedRanges(clientIp, allowedRanges),
    restricted,
    effective_mode: effectiveMode,
    allowed_ranges: allowedRanges,
  };
}

async function loadPolicyRow(db, userId) {
  return db('users as u')
    .leftJoin('ip_whitelist_config as c', function joinGlobalConfig() {
      this.onVal('c.id', '=', GLOBAL_CONFIG_ID);
    })
    .leftJoin('user_ip_whitelist_policies as p', 'p.user_id', 'u.id')
    .where('u.id', userId)
    .select(
      'u.id',
      'u.role',
      'c.enabled as global_enabled',
      'c.allowed_ranges as global_allowed_ranges',
      'p.mode as user_mode',
      'p.allowed_ranges as user_allowed_ranges'
    )
    .first();
}

/**
 * @param {string} userId
 * @param {string} clientIp
 * @param {import('knex').Knex | import('knex').Knex.Transaction} [db]
 */
export async function resolveIpAccess(userId, clientIp, db = knex) {
  const row = await loadPolicyRow(db, userId);
  if (!row) throw notFound('User or IP whitelist configuration not found');
  return evaluateIpAccess({
    role: row.role,
    userMode: row.user_mode || 'inherit',
    userAllowedRanges: parseStoredRanges(row.user_allowed_ranges),
    globalEnabled: Boolean(row.global_enabled),
    globalAllowedRanges: parseStoredRanges(row.global_allowed_ranges),
    clientIp,
  });
}

/**
 * @param {string} userId
 * @param {string} clientIp
 * @param {import('knex').Knex | import('knex').Knex.Transaction} [db]
 */
export async function assertIpAccess(userId, clientIp, db = knex) {
  const result = await resolveIpAccess(userId, clientIp, db);
  if (!result.allowed) throw ipAccessDenied(clientIp);
  return result;
}

export async function getAdminIpWhitelist(currentIp) {
  const config = await knex('ip_whitelist_config').where({ id: GLOBAL_CONFIG_ID }).first();
  const users = await knex('users as u')
    .leftJoin('user_ip_whitelist_policies as p', 'p.user_id', 'u.id')
    .whereNot('u.role', 'super_admin')
    .select('u.id', 'u.name', 'u.email', 'u.role', 'u.is_active', 'p.mode', 'p.allowed_ranges')
    .orderBy('u.name');
  const globalAllowedRanges = parseStoredRanges(config?.allowed_ranges);
  return {
    current_ip: currentIp,
    global: {
      enabled: Boolean(config?.enabled),
      allowed_ranges: globalAllowedRanges,
    },
    users: users.map((user) => {
      const mode = user.mode || 'inherit';
      const allowedRanges = parseStoredRanges(user.allowed_ranges);
      const effective = evaluateIpAccess({
        role: user.role,
        userMode: mode,
        userAllowedRanges: allowedRanges,
        globalEnabled: Boolean(config?.enabled),
        globalAllowedRanges,
        clientIp: currentIp,
      });
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: Boolean(user.is_active),
        mode,
        allowed_ranges: allowedRanges,
        effective_mode: effective.effective_mode,
        current_ip_allowed: effective.allowed,
      };
    }),
  };
}

export async function updateGlobalIpWhitelist(body, actorUserId) {
  let ranges;
  try {
    ranges = normalizeAllowedRanges(body.allowed_ranges, 100);
  } catch (error) {
    throw badRequest(error.message);
  }
  const before = await knex('ip_whitelist_config').where({ id: GLOBAL_CONFIG_ID }).first();
  await knex('ip_whitelist_config')
    .where({ id: GLOBAL_CONFIG_ID })
    .update({
      enabled: body.enabled,
      allowed_ranges: JSON.stringify(ranges),
      updated_by_user_id: actorUserId,
      updated_at: knex.fn.now(),
    });
  return {
    before: {
      enabled: Boolean(before?.enabled),
      allowed_ranges: parseStoredRanges(before?.allowed_ranges),
    },
    after: { enabled: body.enabled, allowed_ranges: ranges },
  };
}

export async function updateUserIpWhitelist(userId, body, actorUserId) {
  const user = await knex('users').where({ id: userId }).first('id', 'role');
  if (!user) throw notFound('User not found');
  if (user.role === 'super_admin') {
    throw badRequest('Super administrators always bypass IP whitelisting');
  }
  let ranges;
  try {
    ranges = normalizeAllowedRanges(body.allowed_ranges, 50);
  } catch (error) {
    throw badRequest(error.message);
  }
  if (body.mode !== 'restricted') ranges = [];
  const before = await knex('user_ip_whitelist_policies').where({ user_id: userId }).first();
  if (body.mode === 'inherit') {
    await knex('user_ip_whitelist_policies').where({ user_id: userId }).del();
  } else {
    await knex('user_ip_whitelist_policies')
      .insert({
        user_id: userId,
        mode: body.mode,
        allowed_ranges: JSON.stringify(ranges),
        updated_by_user_id: actorUserId,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .onConflict('user_id')
      .merge({
        mode: body.mode,
        allowed_ranges: JSON.stringify(ranges),
        updated_by_user_id: actorUserId,
        updated_at: knex.fn.now(),
      });
  }
  return {
    before: before
      ? { mode: before.mode, allowed_ranges: parseStoredRanges(before.allowed_ranges) }
      : { mode: 'inherit', allowed_ranges: [] },
    after: { mode: body.mode, allowed_ranges: ranges },
  };
}
