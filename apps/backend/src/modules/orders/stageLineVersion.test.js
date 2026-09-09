import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDeliveryLineVersion } from './stageLineVersion.js';

test('stale/offline checklist cannot deliver a substituted product', () => {
  const row = { product_id: 'new', replacement_version: 1 };
  const update = { item_type: 'item', field: 'delivered', value: true };
  for (const patch of [
    {},
    { expected_product_id: 'old', expected_line_version: 0 },
    { expected_product_id: 'new', expected_line_version: 0 },
  ]) {
    assert.throws(() => assertDeliveryLineVersion(row, { ...update, ...patch }), {
      statusCode: 409,
    });
  }
  assert.doesNotThrow(() =>
    assertDeliveryLineVersion(row, {
      ...update,
      expected_product_id: 'new',
      expected_line_version: 1,
    })
  );
  for (const field of ['item_to_collect', 'prepared', 'received', 'delivered']) {
    for (const value of [true, false]) {
      assert.throws(() => assertDeliveryLineVersion(row, { ...update, field, value }), {
        statusCode: 409,
      });
      assert.doesNotThrow(() =>
        assertDeliveryLineVersion(row, {
          ...update,
          field,
          value,
          expected_product_id: 'new',
          expected_line_version: 1,
        })
      );
    }
  }
});
