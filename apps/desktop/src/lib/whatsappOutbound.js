import { WHATSAPP_MESSAGE_BY_KEY } from '@wrs/shared/constants';
import { normalizeWhatsAppRecipient } from '@wrs/shared/utils/whatsappRecipient.js';

import { templatesTriggeredByStageDraft } from './orderChecklistMerge.js';

/** @type {Record<string, string>} */
export const WHATSAPP_TEMPLATE_PROMPT_TITLES = {
  CREATE_BOOKING: 'Send Create Booking message?',
  UPDATE_BOOKING: 'Send Update Booking message?',
  BILL_PREPARED: 'Send Bill Prepared message? (all items prepared)',
  BILL_DELIVER: 'Send Bill Deliver message? (all items delivered)',
  BILL_RETURN: 'Send Bill Return message? (all items received)',
  CANCEL_BOOKING: 'Send Cancel Booking message?',
  LAUNDRY_SLIP: 'Send laundry slip on WhatsApp?',
  DELIVERY_PRODUCT_LIST: 'Send delivered Products + Accessories PDF?',
  RETURN_MISSING_ITEMS: 'Send missing-item details PDF?',
  DELIVERY_REMINDER: 'Send delivery reminder?',
};

/**
 * @param {string} templateKey
 * @returns {string}
 */
export function whatsappTemplateLabel(templateKey) {
  return WHATSAPP_MESSAGE_BY_KEY[templateKey]?.name || templateKey;
}

/**
 * @param {object} [order]
 * @param {object} [customer]
 * @returns {string}
 */
export function resolveOrderWhatsappPhone(order, customer) {
  const cust = customer || order?.customer;
  return [order?.customer_whatsapp, cust?.whatsapp, order?.customer_phone, cust?.phone1, cust?.phone2]
    .map(normalizeWhatsAppRecipient).find(Boolean) || '';
}

/**
 * Run WhatsApp for checklist stage templates (BILL_PREPARED / DELIVER / RETURN).
 * @param {ReturnType<import('../hooks/useWhatsAppOutbound.js').useWhatsAppOutbound>} wa
 * @param {{ order: object, stageDraftAfter: Record<string, object>|null, orderId: string, customer?: object, actionLabel?: string, excludeDelivered?: boolean }} opts
 */
export async function runStageTemplateWhatsApp(wa, opts) {
  const {
    order,
    stageDraftAfter,
    orderId,
    customer: customerIn,
    actionLabel = 'Saved',
    excludeDelivered = false,
  } = opts;
  if (!order || !stageDraftAfter || !orderId || !wa?.runOutbound) return;

  const customer = customerIn || order?.customer || null;
  const templateKeys = templatesTriggeredByStageDraft(order, stageDraftAfter, { excludeDelivered });
  for (const templateKey of templateKeys) {
    await wa.runOutbound({
      templateKey,
      orderId,
      order,
      customer,
      actionLabel,
      silentSkip: false,
    });
  }
}

