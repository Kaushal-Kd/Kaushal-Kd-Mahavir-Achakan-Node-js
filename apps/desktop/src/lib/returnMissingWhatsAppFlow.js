import { buildWhatsAppTransactionPdf } from '../utils/whatsappTransactionPdf.js';
import { newMissingLineKeys } from '../utils/whatsappTransactionRows.js';

export async function runReturnMissingWhatsAppFlow({
  wa, orderBefore, orderAfter, orderId, buildDocument = buildWhatsAppTransactionPdf,
}) {
  if (!wa?.runOutbound || !orderAfter || !orderId) return { sent: false, skipped: true };
  const lineKeys = newMissingLineKeys(orderBefore, orderAfter);
  if (!lineKeys.length) return { sent: false, skipped: true };
  return wa.runOutbound({
    templateKey: 'RETURN_MISSING_ITEMS', orderId, order: orderAfter,
    actionLabel: 'Return saved', forcePrompt: true,
    document: buildDocument(orderAfter, 'missing', { lineKeys }),
  });
}
