import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TOKEN_LABEL_SIZE_MM,
  TOKEN_PRINT_PAGE_MM,
  buildAccessoryTokenSlipPdfDoc,
  normalizeTokenLayout,
  tokenContentOrigin,
} from './deliverySlipPdf.js';

describe('normalizeTokenLayout', () => {
  it('defaults to 75 × 50 mm content on a square 4×4 page', () => {
    const layout = normalizeTokenLayout();
    assert.equal(layout.widthMm, TOKEN_LABEL_SIZE_MM.widthMm);
    assert.equal(layout.heightMm, TOKEN_LABEL_SIZE_MM.heightMm);
    assert.equal(layout.pageWidthMm, TOKEN_PRINT_PAGE_MM.widthMm);
    assert.equal(layout.pageHeightMm, TOKEN_PRINT_PAGE_MM.heightMm);
    assert.equal(layout.leftMarginMm, 8);
    assert.equal(layout.fontSize, 7);
  });

  it('centers the 75 mm sticker on the 4×4 page then insets for the print head', () => {
    const origin = tokenContentOrigin(normalizeTokenLayout());
    assert.equal(origin.gutterMm, 13.3);
    assert.equal(origin.x, 21.3);
    assert.equal(origin.widthMm, 65);
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
    assert.equal(layout.pageWidthMm, 101.6);
    assert.equal(layout.leftMarginMm, 8);
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

describe('token PDF page', () => {
  it('builds a square 4×4 portrait page so the TSC does not rotate the token', async () => {
    const doc = await buildAccessoryTokenSlipPdfDoc({
      slipKind: 'accessory',
      order_number: 'NM-202609122006',
      customer_address: 'SURENDRANAGAR',
      customer_name: 'NEW MAHAVIR ACHAKAN',
      pickup_date: '2026-09-12',
      return_date: '2026-09-15',
      accessories: [{ category_name: 'MALA', name_snapshot: 'MARUN NEW BROCH VALLI' }],
    });
    assert.ok(doc);
    assert.equal(Number(doc.internal.pageSize.getWidth().toFixed(1)), 101.6);
    assert.equal(Number(doc.internal.pageSize.getHeight().toFixed(1)), 101.6);
  });
});
