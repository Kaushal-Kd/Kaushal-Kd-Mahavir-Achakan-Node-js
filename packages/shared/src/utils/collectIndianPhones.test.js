import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { collectIndianPhones, isIndianPhone, normalizePhone } from './validators.js';

describe('isIndianPhone', () => {
  it('accepts any 10-digit number including leading 1', () => {
    assert.equal(isIndianPhone('1234567890'), true);
    assert.equal(isIndianPhone('9876543210'), true);
  });

  it('accepts 91-prefixed paste after normalize', () => {
    assert.equal(isIndianPhone('911234567890'), true);
    assert.equal(normalizePhone('911234567890'), '1234567890');
  });

  it('rejects too few digits', () => {
    assert.equal(isIndianPhone('12345'), false);
    assert.equal(isIndianPhone(''), false);
  });
});

describe('collectIndianPhones', () => {
  it('dedupes and normalizes two contacts', () => {
    assert.deepEqual(collectIndianPhones('9876543210', '919876543210'), ['9876543210']);
    assert.deepEqual(collectIndianPhones('9876543210', '9123456789'), ['9876543210', '9123456789']);
  });

  it('accepts numbers starting with any digit', () => {
    assert.deepEqual(collectIndianPhones('1234567890'), ['1234567890']);
  });

  it('ignores invalid numbers', () => {
    assert.deepEqual(collectIndianPhones('', '123', null), []);
    assert.deepEqual(collectIndianPhones('12345'), []);
  });
});
