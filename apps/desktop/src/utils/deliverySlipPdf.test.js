import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTokenLayout } from './deliverySlipPdf.js';

describe('normalizeTokenLayout', () => {
  it('keeps the established two-column defaults', () => {
    assert.deepEqual(normalizeTokenLayout(), {
      widthMm: 92,
      minHeightMm: 0,
      fontSize: 9,
      lineHeightMm: 5.04,
      pageMarginMm: 10,
      slipPaddingMm: 4,
    });
  });

  it('clamps unsafe values while allowing a manual minimum height', () => {
    assert.deepEqual(
      normalizeTokenLayout({
        widthMm: 500,
        minHeightMm: 120,
        fontSize: 3,
        pageMarginMm: -4,
      }),
      {
        widthMm: 190,
        minHeightMm: 120,
        fontSize: 6,
        lineHeightMm: 3.5,
        pageMarginMm: 3,
        slipPaddingMm: 4,
      }
    );
  });
});
