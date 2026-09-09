import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderListQuerySchema, orderReassignSalesmanBodySchema } from './order.js';

describe('orderListQuerySchema', () => {
  it('enables the audit summary while preserving existing list filters', () => {
    assert.deepEqual(
      orderListQuerySchema.parse({
        with_audit_summary: '1',
        search: 'A-100',
        page: '2',
      }),
      {
        with_audit_summary: true,
        search: 'A-100',
        page: '2',
      }
    );
  });

  it('keeps the audit aggregation opt-in', () => {
    assert.deepEqual(orderListQuerySchema.parse({ per_page: '25' }), { per_page: '25' });
  });
});

describe('orderReassignSalesmanBodySchema', () => {
  it('accepts selected product lines and one target salesman', () => {
    assert.equal(
      orderReassignSalesmanBodySchema.safeParse({
        order_item_ids: ['20c68b5f-e5de-44a7-9ca3-a8b31feee0a0'],
        sales_person_id: '8fdca90f-759b-485a-923d-4dfd47c9c739',
      }).success,
      true
    );
  });

  it('requires at least one product line', () => {
    assert.equal(
      orderReassignSalesmanBodySchema.safeParse({
        order_item_ids: [],
        sales_person_id: '8fdca90f-759b-485a-923d-4dfd47c9c739',
      }).success,
      false
    );
  });
});
