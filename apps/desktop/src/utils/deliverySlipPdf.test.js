import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TOKEN_LABEL_SIZE_MM, normalizeTokenLayout } from './deliverySlipPdf.js';

describe('normalizeTokenLayout', () => {
  it('defaults to 75 × 50 mm with a left inset for the TSC print head', () => {
    const layout = normalizeTokenLayout();
    assert.equal(layout.widthMm, TOKEN_LABEL_SIZE_MM.widthMm);
    assert.equal(layout.heightMm, TOKEN_LABEL_SIZE_MM.heightMm);
    assert.equal(layout.leftMarginMm, 6);
    assert.equal(layout.fontSize, 7);
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
    assert.equal(layout.leftMarginMm, 6);
  });

  it('keeps 75 × 50 when the template stores the swapped 50 × 75 pair', () => {
    const layout = normalizeTokenLayout({
      widthMm: 50,
      heightMm: 75,
      fontSize: 3,
      pageMarginMm: 2,
    });
    assert.equal(layout.widthMm, 75);
    assert.equal(layout.heightMm, 50);
    assert.equal(layout.fontSize, 5.5);
  });
});
