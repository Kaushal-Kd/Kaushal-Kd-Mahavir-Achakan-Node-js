import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { groupSelectedLinesByOrder, submitSalesmanReassignment } from './salesmanReassign.js';

describe('groupSelectedLinesByOrder', () => {
  it('groups line ids by booking', () => {
    const selected = new Map([
      ['a', { id: 'a', order_id: 'o1' }],
      ['b', { id: 'b', order_id: 'o1' }],
      ['c', { id: 'c', order_id: 'o2' }],
    ]);
    const grouped = groupSelectedLinesByOrder(selected);
    assert.deepEqual(grouped.get('o1'), ['a', 'b']);
    assert.deepEqual(grouped.get('o2'), ['c']);
  });
});

describe('submitSalesmanReassignment', () => {
  it('rejects empty salesman', async () => {
    await assert.rejects(
      () =>
        submitSalesmanReassignment({
          selectedLines: new Map([['a', { id: 'a', order_id: 'o1' }]]),
          salesPersonId: '',
          submit: async () => ({}),
        }),
      /Select a salesman/
    );
  });

  it('blocks pending bookings', async () => {
    await assert.rejects(
      () =>
        submitSalesmanReassignment({
          selectedLines: new Map([['a', { id: 'a', order_id: 'o1' }]]),
          salesPersonId: 's1',
          pendingOrderIds: new Set(['o1']),
          submit: async () => ({}),
        }),
      /Pending sync/
    );
  });

  it('calls submit once per booking', async () => {
    const calls = [];
    const result = await submitSalesmanReassignment({
      selectedLines: new Map([
        ['a', { id: 'a', order_id: 'o1' }],
        ['b', { id: 'b', order_id: 'o1' }],
        ['c', { id: 'c', order_id: 'o2' }],
      ]),
      salesPersonId: 's1',
      selectedPreview: [{ order_id: 'o1', order_number: 'B-1' }],
      submit: async (orderId, payload, metadata) => {
        calls.push({ orderId, payload, metadata });
        return { queued: orderId === 'o2' };
      },
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].payload.order_item_ids, ['a', 'b']);
    assert.equal(calls[0].metadata.orderNumber, 'B-1');
    assert.equal(result.lineCount, 3);
    assert.equal(result.queued, 1);
  });
});
