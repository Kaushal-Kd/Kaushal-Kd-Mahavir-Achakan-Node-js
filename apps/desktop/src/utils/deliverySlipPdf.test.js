import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOKEN_LABEL_SIZE_MM, normalizeTokenLayout } from './deliverySlipPdf.js';

describe('normalizeTokenLayout', () => {
  it('defaults to 50 × 75 mm so 75 × 50 stock prints upright', () => {
    const layout = normalizeTokenLayout();
    assert.equal(layout.widthMm, TOKEN_LABEL_SIZE_MM.widthMm);
    assert.equal(layout.heightMm, TOKEN_LABEL_SIZE_MM.heightMm);
    assert.equal(layout.fontSize, 7);
    assert.equal(layout.pageMarginMm, 1.5);
    assert.ok(layout.lineHeightMm < 4);
  });

  it('treats the old A4 token settings as 50 × 75 mm labels', () => {
    const layout = normalizeTokenLayout({
      widthMm: 92,
      minHeightMm: 0,
      fontSize: 9,
      pageMarginMm: 10,
    });
    assert.equal(layout.widthMm, 50);
    assert.equal(layout.heightMm, 75);
    assert.equal(layout.pageMarginMm, 1.5);
  });

  it('turns a 75 × 50 setting into portrait 50 × 75 and clamps tiny fonts', () => {
    const layout = normalizeTokenLayout({
      widthMm: 75,
      heightMm: 50,
      fontSize: 3,
      pageMarginMm: 2,
    });
    assert.equal(layout.widthMm, 50);
    assert.equal(layout.heightMm, 75);
    assert.equal(layout.fontSize, 5.5);
    assert.equal(layout.pageMarginMm, 2);
  });
});
