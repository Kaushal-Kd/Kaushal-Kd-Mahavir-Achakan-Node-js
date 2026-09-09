import { buildWhatsAppTransactionPdf } from '../utils/whatsappTransactionPdf.js';
import { newDeliveredLineKeys } from '../utils/whatsappTransactionRows.js';

import {
  buildStageDraftMap,
  templatesTriggeredByStageDraft,
} from './orderChecklistMerge.js';

export async function runDeliveryWhatsAppFlow({
  wa,
  orderBefore,
  orderAfter,
  orderId,
  stageUpdates,
  actionLabel,
  buildDocument = buildWhatsAppTransactionPdf,
}) {
  if (!wa?.runOutbound || !orderBefore || !orderAfter || !orderId) return [];
  const sentTemplates = [];
  // Notifications describe the committed response, never an optimistic checklist draft.
  const draftAfter = buildStageDraftMap(orderAfter);
  const completedTemplates = templatesTriggeredByStageDraft(orderBefore, draftAfter, {
    excludeDelivered: false,
  });

  const lineKeys = newDeliveredLineKeys(orderBefore, orderAfter, stageUpdates);
  if (lineKeys.length) {
    const result = await wa.runOutbound({
      templateKey: 'DELIVERY_PRODUCT_LIST',
      orderId,
      order: orderAfter,
      actionLabel: 'Delivery saved',
      forcePrompt: true,
      document: buildDocument(orderAfter, 'delivery', { lineKeys }),
    });
    if (result?.sent) sentTemplates.push('DELIVERY_PRODUCT_LIST');
  }

  if (lineKeys.length && completedTemplates.includes('BILL_DELIVER')) {
    const result = await wa.runOutbound({
      templateKey: 'BILL_DELIVER',
      orderId,
      order: orderAfter,
      actionLabel,
      forcePrompt: true,
      silentSkip: false,
    });
    if (result?.sent) sentTemplates.push('BILL_DELIVER');
  }

  return sentTemplates;
}
