import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findProductCodeNumberConflict } from './productCodeFormat.js';

describe('findProductCodeNumberConflict', () => {
  it('allows the same number with a different size when size is provided', () => {
    const conflict = findProductCodeNumberConflict(
      ['A-888[32]', 'A-777[40]'],
      'A-',
      4,
      888,
      { size: '38' }
    );
    assert.equal(conflict, null);
  });

  it('detects the same number and same size', () => {
    const conflict = findProductCodeNumberConflict(
      ['A-888[32]', 'A-777[40]'],
      'A-',
      4,
      888,
      { size: '32' }
    );
    assert.equal(conflict?.number, 888);
    assert.equal(conflict?.existingCode, 'A-888[32]');
  });

  it('without size option, any code with that number conflicts (next-number sequencing)', () => {
    const conflict = findProductCodeNumberConflict(
      ['A-888[32]', 'A-777[40]'],
      'A-',
      4,
      888
    );
    assert.equal(conflict?.number, 888);
    assert.equal(conflict?.existingCode, 'A-888[32]');
  });

  it('ignores a different number', () => {
    const conflict = findProductCodeNumberConflict(['A-888[32]'], 'A-', 4, 889, { size: '32' });
    assert.equal(conflict, null);
  });

  it('excludes the current product code when editing', () => {
    const conflict = findProductCodeNumberConflict(['A-668[38]', 'A-668[36]'], 'A-', 4, 668, {
      size: '38',
      excludeCode: 'A-668[38]',
    });
    assert.equal(conflict, null);
  });
});
