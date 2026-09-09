import assert from 'node:assert/strict';
import test from 'node:test';

import { createWhatsAppPromptController, createWhatsAppSendScopeGuard, sendOrderWhatsApp } from './whatsappOutboundControl.js';

test('competing WhatsApp confirmations cannot overwrite the visible recipient or strand its promise', async () => {
  const opened = [];
  const controller = createWhatsAppPromptController({ onOpen: (meta) => opened.push(meta), onClose() {} });
  const first = controller.ask({ phone: 'first' });
  assert.equal(await controller.ask({ phone: 'second' }), 'skip');
  assert.deepEqual(opened, [{ phone: 'first' }]);
  controller.finish('send');
  assert.equal(await first, 'send');
});

test('cancel/close and page disposal resolve pending prompts without sending or updating unmounted UI', async () => {
  let closes = 0;
  const controller = createWhatsAppPromptController({ onOpen() {}, onClose() { closes += 1; } });
  const cancelled = controller.ask({});
  controller.finish('skip');
  assert.equal(await cancelled, 'skip');
  assert.equal(closes, 1);
  const disposed = controller.ask({});
  controller.dispose();
  assert.equal(await disposed, 'skip');
  assert.equal(await controller.ask({}), 'skip');
  assert.equal(controller.isActive(), false);
  assert.equal(closes, 1);
  controller.activate();
  const remounted = controller.ask({});
  controller.finish('send');
  assert.equal(await remounted, 'send');
});

function sendOptions(overrides = {}) {
  return {
    templateKey: 'BILL_DELIVER', orderId: 'order', phone: 'fixture',
    template: { attach_bill_pdf: true },
    loadOrder: async () => ({ id: 'order' }),
    buildBillPdf: async () => ({ base64: 'fake-pdf', filename: 'bill.pdf' }),
    sendMessage: async () => ({ ok: true }),
    ...overrides,
  };
}

test('configured bill PDF failure or empty generation does not send a misleading text-only message', async () => {
  let sends = 0;
  for (const buildBillPdf of [async () => { throw new Error('PDF failed'); }, async () => ({})]) {
    await assert.rejects(sendOrderWhatsApp(sendOptions({ buildBillPdf,
      sendMessage: async () => { sends += 1; },
    })), /PDF/);
  }
  assert.equal(sends, 0);
});

test('PDF send uses the committed provided order and propagates real acknowledgment/failure', async () => {
  const committed = { id: 'order', total: 123 };
  const acknowledgment = { data: { status: 'sent' } };
  const result = await sendOrderWhatsApp(sendOptions({
    order: committed,
    loadOrder: async () => { assert.fail('provided order should not be refetched'); },
    buildBillPdf: async (order) => {
      assert.equal(order, committed);
      return { base64: 'confirmed-pdf', filename: 'bill.pdf' };
    },
    sendMessage: async (payload) => {
      assert.equal(payload.document.content_base64, 'confirmed-pdf');
      assert.equal(payload.attach_bill_pdf, true);
      return acknowledgment;
    },
  }));
  assert.equal(result, acknowledgment);
  await assert.rejects(sendOrderWhatsApp(sendOptions({
    sendMessage: async () => { throw new Error('ack uncertain'); },
  })), /ack uncertain/);
});

test('text-only templates never load a bill and cancelled actions never reach the sender', async () => {
  const payload = await sendOrderWhatsApp(sendOptions({
    template: {}, loadOrder: async () => { assert.fail('no bill needed'); },
    sendMessage: async (value) => value,
  }));
  assert.equal(payload.document, undefined);
  let sends = 0;
  await assert.rejects(sendOrderWhatsApp(sendOptions({
    beforeSend: () => { throw new Error('action cancelled'); },
    sendMessage: async () => { sends += 1; },
  })), /cancelled/);
  assert.equal(sends, 0);
});

test('changing shop/login while confirming or preparing a PDF prevents a cross-scope send', async () => {
  for (const nextScope of [
    { userId: 'user-1', shopId: 'shop-2' },
    { userId: 'user-2', shopId: 'shop-1' },
    { userId: '', shopId: '' },
  ]) {
    let scope = { userId: 'user-1', shopId: 'shop-1' };
    const guard = createWhatsAppSendScopeGuard(() => scope, { shop_id: 'shop-1' });
    guard();
    let sends = 0;
    await assert.rejects(sendOrderWhatsApp(sendOptions({
      buildBillPdf: async () => { scope = nextScope; return { base64: 'fixture' }; },
      beforeSend: guard,
      sendMessage: async () => { sends += 1; },
    })), /Shop or login changed/);
    assert.equal(sends, 0);
  }
  assert.throws(createWhatsAppSendScopeGuard(
    () => ({ userId: 'user-1', shopId: 'shop-1' }), { shop_id: 'shop-2' }
  ), /Shop or login changed/);
});
