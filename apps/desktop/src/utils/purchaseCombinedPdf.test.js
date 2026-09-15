import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizePurchaseAttachmentUrls } from './purchaseCombinedPdf.js';

describe('purchase PDF attachments', () => {
  it('accepts API arrays and legacy JSON strings', () => {
    assert.deepEqual(normalizePurchaseAttachmentUrls(['one.jpg', '', 'bill.pdf']), [
      'one.jpg',
      'bill.pdf',
    ]);
    assert.deepEqual(normalizePurchaseAttachmentUrls('["one.jpg","bill.pdf"]'), [
      'one.jpg',
      'bill.pdf',
    ]);
  });

  it('fails closed for malformed attachment data', () => {
    assert.deepEqual(normalizePurchaseAttachmentUrls('{bad json'), []);
    assert.deepEqual(normalizePurchaseAttachmentUrls(null), []);
  });
});
