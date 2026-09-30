import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  TOKEN_LABEL_SIZE_MM,
  TOKEN_PRINT_PAGE_MM,
  buildAccessoryTokenSlipPdfDoc,
  buildTokenPrintHtml,
  normalizeTokenLayout,
  tokenContentOrigin,
} from './deliverySlipPdf.js';

describe('normalizeTokenLayout', () => {
  it('defaults to a 75 × 50 mm landscape page that matches the sticker', () => {
    const layout = normalizeTokenLayout();
    assert.equal(layout.widthMm, TOKEN_LABEL_SIZE_MM.widthMm);
    assert.equal(layout.heightMm, TOKEN_LABEL_SIZE_MM.heightMm);
    assert.equal(layout.pageWidthMm, TOKEN_PRINT_PAGE_MM.widthMm);
    assert.equal(layout.pageHeightMm, TOKEN_PRINT_PAGE_MM.heightMm);
    assert.equal(layout.pageWidthMm, 75);
    assert.equal(layout.pageHeightMm, 50);
    assert.equal(layout.leftMarginMm, 1.5);
    assert.equal(layout.fontSize, 7);
  });

  it('draws the token with inner margin only — no 4 in centering gutter', () => {
    const origin = tokenContentOrigin(normalizeTokenLayout());
    assert.equal(origin.gutterMm, 0);
    assert.equal(origin.x, 1.5);
    assert.equal(origin.y, 1.5);
    assert.equal(origin.widthMm, 72);
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
    assert.equal(layout.pageWidthMm, 75);
    assert.equal(layout.pageHeightMm, 50);
    assert.equal(layout.leftMarginMm, 1.5);
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
    assert.equal(layout.pageWidthMm, 75);
    assert.equal(layout.pageHeightMm, 50);
    assert.equal(layout.fontSize, 5.5);
  });

  it('uses the template page margin on all four sides', () => {
    const layout = normalizeTokenLayout({
      widthMm: 75,
      heightMm: 50,
      pageMarginMm: 2,
    });
    assert.equal(layout.leftMarginMm, 2);
    assert.equal(layout.rightMarginMm, 2);
    assert.equal(layout.topMarginMm, 2);
    assert.equal(layout.bottomMarginMm, 2);
  });
});

describe('token PDF page', () => {
  it('builds a 75 × 50 mm landscape page so the TSC does not stand the token upright', async () => {
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
    assert.equal(Number(doc.internal.pageSize.getWidth().toFixed(1)), 75);
    assert.equal(Number(doc.internal.pageSize.getHeight().toFixed(1)), 50);
  });

  it('prints a 75 × 50 mm page with the token inset by the page margin', () => {
    const html = buildTokenPrintHtml(
      [
        {
          target: {
            slipKind: 'accessory',
            order_number: 'NM-1',
            customer_name: 'Test',
            accessorySegments: [],
          },
          barcode: null,
        },
      ],
      {},
      'Accessory token'
    );
    assert.match(html, /@page \{ size: 75mm 50mm;/);
    assert.match(html, /padding: 1\.5mm 1\.5mm 1\.5mm 1\.5mm;/);
    assert.match(html, /width: 75mm;/);
    assert.match(html, /height: 50mm;/);
  });
});
