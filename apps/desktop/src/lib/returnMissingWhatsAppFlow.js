import { newMissingLineKeys } from '../utils/whatsappTransactionRows.js';

export async function runReturnMissingWhatsAppFlow({
  wa, orderBefore, orderAfter, orderId, buildDocument,
}) {
  if (!wa?.runOutbound || !orderAfter || !orderId) return { sent: false, skipped: true };
  const lineKeys = newMissingLineKeys(orderBefore, orderAfter);
  if (!lineKeys.length) return { sent: false, skipped: true };
  const build =
    buildDocument ||
    (await import('../utils/whatsappTransactionPdf.js')).buildWhatsAppTransactionPdf;
  return wa.runOutbound({
    templateKey: 'RETURN_MISSING_ITEMS', orderId, order: orderAfter,
    actionLabel: 'Return saved', forcePrompt: true,
    document: build(orderAfter, 'missing', { lineKeys }),
  });
}
