import assert from 'node:assert/strict';
import test from 'node:test';

import { runReturnMissingWhatsAppFlow } from './returnMissingWhatsAppFlow.js';

const accessory = { id: 'a1', accessory_id: 'catalog-a1', qty: 3, category_name: 'Jewellery' };

test('unchanged missing item does not prompt again on a repeated return save', async () => {
  const order = { accessories: [{ ...accessory, missing: true, missing_qty: 1 }] };
  let calls = 0;
  const result = await runReturnMissingWhatsAppFlow({
    wa: { runOutbound: async () => { calls += 1; } },
    orderBefore: order, orderAfter: order, orderId: 'order',
  });
  assert.equal(calls, 0);
  assert.equal(result.skipped, true);
});

test('new or increased missing quantity sends only changed lines and preserves send failure', async () => {
  const calls = [];
  const result = await runReturnMissingWhatsAppFlow({
    wa: { runOutbound: async (payload) => { calls.push(payload); return { sent: false, reason: 'not_connected' }; } },
    orderBefore: { accessories: [{ ...accessory, missing: true, missing_qty: 1 }] },
    orderAfter: { accessories: [{ ...accessory, missing: true, missing_qty: 2 }] },
    orderId: 'order',
    buildDocument: (_order, kind, options) => ({ kind, lineKeys: options.lineKeys }),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].document.lineKeys, ['accessory:a1']);
  assert.equal(calls[0].forcePrompt, true);
  assert.equal(result.sent, false);
});
