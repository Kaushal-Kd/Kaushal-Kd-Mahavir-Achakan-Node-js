import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOKEN_LABEL_SIZE_MM, normalizeTokenLayout } from './deliverySlipPdf.js';

describe('normalizeTokenLayout', () => {
  it('defaults to 75 × 50 mm label stock', () => {
    const layout = normalizeTokenLayout();
    assert.equal(layout.widthMm, TOKEN_LABEL_SIZE_MM.widthMm);
    assert.equal(layout.heightMm, TOKEN_LABEL_SIZE_MM.heightMm);
    assert.equal(layout.fontSize, 7);
    assert.equal(layout.pageMarginMm, 1.5);
    assert.ok(layout.lineHeightMm < 4);
  });

  it('treats the old A4 token settings as 75 × 50 mm labels', () => {
    const layout = normalizeTokenLayout({
      widthMm: 92,
      minHeightMm: 0,
      fontSize: 9,
      pageMarginMm: 10,
    });
    assert.equal(layout.widthMm, 75);
    assert.equal(layout.heightMm, 50);
    assert.equal(layout.pageMarginMm, 1.5);
  });

  it('keeps an explicit 75 × 50 layout and clamps unsafe values', () => {
    const layout = normalizeTokenLayout({
      widthMm: 75,
      heightMm: 50,
      fontSize: 3,
      pageMarginMm: 2,
    });
    assert.equal(layout.widthMm, 75);
    assert.equal(layout.heightMm, 50);
    assert.equal(layout.fontSize, 5.5);
    assert.equal(layout.pageMarginMm, 2);
  });
});
