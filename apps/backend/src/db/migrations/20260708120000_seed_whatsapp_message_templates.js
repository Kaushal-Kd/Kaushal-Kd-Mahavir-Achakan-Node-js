import {
  WHATSAPP_MESSAGE_REGISTRY,
  defaultWhatsAppTemplatePayload,
  whatsappMessageSettingKey,
} from '@wrs/shared';
import { randomUUID } from 'node:crypto';

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const shops = await knex('shops').select('id');
  for (const shop of shops) {
    const shopId = shop.id;
    for (const def of WHATSAPP_MESSAGE_REGISTRY) {
      const key = whatsappMessageSettingKey(def.key);
      const existing = await knex('settings').where({ shop_id: shopId, key }).first();
      if (!existing) {
        await knex('settings').insert({
          id: randomUUID(),
          shop_id: shopId,
          key,
          value: defaultWhatsAppTemplatePayload(def),
          updated_at: knex.fn.now(),
        });
      }
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  const keys = WHATSAPP_MESSAGE_REGISTRY.map((def) => whatsappMessageSettingKey(def.key));
  await knex('settings').whereIn('key', keys).del();
}
