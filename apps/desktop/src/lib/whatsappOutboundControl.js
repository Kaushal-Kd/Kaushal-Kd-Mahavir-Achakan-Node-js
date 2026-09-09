import { shouldAttachBillPdf } from '@wrs/shared/utils/whatsappMessages.js';

export function createWhatsAppSendScopeGuard(getScope, order = null) {
  const original = getScope();
  return () => {
    const current = getScope();
    if (!original.userId || !original.shopId || current.userId !== original.userId ||
      current.shopId !== original.shopId || (order?.shop_id && String(order.shop_id) !== original.shopId)) {
      throw new Error('Shop or login changed. Reopen the correct booking before sending WhatsApp.');
    }
  };
}

export function createWhatsAppPromptController({ onOpen, onClose }) {
  let resolvePending = null;
  let active = true;
  return {
    activate() { active = true; },
    isActive() { return active; },
    ask(meta) {
      if (!active) return Promise.resolve('skip');
      // Preserve the visible confirmation; a competing action must not replace its recipient.
      if (resolvePending) return Promise.resolve('skip');
      return new Promise((resolve) => {
        resolvePending = resolve;
        onOpen(meta);
      });
    },
    finish(choice) {
      const resolve = resolvePending;
      resolvePending = null;
      onClose();
      resolve?.(choice);
    },
    dispose() {
      active = false;
      const resolve = resolvePending;
      resolvePending = null;
      resolve?.('skip');
    },
  };
}

export async function sendOrderWhatsApp({
  templateKey, orderId, phone, order, template, loadOrder, buildBillPdf, sendMessage, beforeSend,
}) {
  const payload = { template_key: templateKey, order_id: orderId, phone };
  if (shouldAttachBillPdf({
    message: template?.message,
    attach_bill_pdf: template?.attach_bill_pdf,
    order_id: orderId,
  })) {
    const fullOrder = order || await loadOrder(orderId);
    const pdf = await buildBillPdf(fullOrder);
    if (!pdf?.base64) throw new Error('Could not generate bill PDF. WhatsApp was not sent.');
    payload.document = {
      filename: pdf.filename,
      content_base64: pdf.base64,
      mimetype: 'application/pdf',
    };
    payload.attach_bill_pdf = true;
  }
  await beforeSend?.();
  return sendMessage(payload);
}
