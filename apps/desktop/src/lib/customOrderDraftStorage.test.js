import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isSnapshotTriviallyEmpty } from './customOrderDraftStorage.js';

describe('isSnapshotTriviallyEmpty', () => {
  it('keeps a draft that only has a second product filled', () => {
    const empty = isSnapshotTriviallyEmpty({
      values: {
        customer_name: '',
        items: [
          { design_name: '', product_name: '', category_id: '' },
          { product_name: 'Jacket', category_id: 'c1' },
        ],
      },
    });
    assert.equal(empty, false);
  });

  it('keeps a draft that only has measurements on a second product', () => {
    const empty = isSnapshotTriviallyEmpty({
      values: {
        customer_name: '',
        items: [
          { design_name: '', product_name: '' },
          { measurements: { chest: '40' } },
        ],
      },
    });
    assert.equal(empty, false);
  });
});
