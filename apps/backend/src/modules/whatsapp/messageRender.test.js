import assert from 'node:assert/strict';
import test from 'node:test';

import { whatsappOrderItemLabel } from './messageRender.js';

test('WhatsApp accessory labels include category and affected missing quantity', () => {
  assert.equal(
    whatsappOrderItemLabel(
      {
        category_name: 'Safa',
        code_snapshot: 'SF-01',
        name_snapshot: 'Red Safa',
        qty: 3,
        missing_qty: 1,
      },
      'missing'
    ),
    'Safa · SF-01 · Red Safa'
  );
  assert.equal(
    whatsappOrderItemLabel(
      {
        category_name: 'Buttons',
        name_snapshot: 'Gold Button',
        qty: 4,
        missing_qty: 2,
      },
      'missing'
    ),
    'Buttons · Gold Button × 2'
  );
});
