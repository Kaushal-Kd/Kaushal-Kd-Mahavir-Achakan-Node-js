import fp from 'fastify-plugin';
import { v4 as uuid } from 'uuid';

import knex from '../db/knex.js';

/**
 * Attach `request.audit(entity, action, { id, old, new })` helper.
 */
async function auditPlugin(fastify) {
  fastify.decorateRequest('audit', null);
  fastify.addHook('onRequest', async (request) => {
    request.audit = async (entity, action, payload = {}) => {
      try {
        await knex('audit_logs').insert({
          id: uuid(),
          shop_id: request.shopId || null,
          user_id: request.authUser?.id || null,
          user_name: request.authUser?.name || null,
          action,
          entity,
          entity_id: payload.id ? String(payload.id) : null,
          old_value: payload.old ? JSON.stringify(payload.old) : null,
          new_value: payload.new ? JSON.stringify(payload.new) : null,
          ip: request.ip,
          device: request.headers['x-device-name'] || null,
          user_agent: request.headers['user-agent'] || null,
        });
      } catch (err) {
        request.log.warn({ err }, 'Failed to write audit log');
      }
    };
  });
}

export default fp(auditPlugin, { name: 'audit' });
