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

  it('uses per-side margins when provided', () => {
    const layout = normalizeTokenLayout({
      widthMm: 75,
      heightMm: 50,
      pageMarginMm: 1.5,
      leftMarginMm: 4,
      topMarginMm: 2,
      rightMarginMm: 3,
      bottomMarginMm: 1,
    });
    assert.equal(layout.leftMarginMm, 4);
    assert.equal(layout.topMarginMm, 2);
    assert.equal(layout.rightMarginMm, 3);
    assert.equal(layout.bottomMarginMm, 1);
    const origin = tokenContentOrigin(layout);
    assert.equal(origin.x, 4);
    assert.equal(origin.y, 2);
    assert.equal(origin.widthMm, 68);
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

  it('applies left top right bottom padding independently', () => {
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
      {
        widthMm: 75,
        heightMm: 50,
        leftMarginMm: 4,
        topMarginMm: 2,
        rightMarginMm: 3,
        bottomMarginMm: 1,
      },
      'Accessory token'
    );
    assert.match(html, /padding: 2mm 3mm 1mm 4mm;/);
  });

  it('prints the product name and can hide the barcode', () => {
    const html = buildTokenPrintHtml(
      [
        {
          target: {
            order_number: 'K-0030',
            items: [{ name_snapshot: 'Golden copper', code_snapshot: 'P-2' }],
          },
          barcode: { dataUrl: 'data:image/png;base64,xx', widthPx: 40, heightPx: 10 },
        },
      ],
      {
        widthMm: 75,
        heightMm: 50,
        tokenFields: { product: { barcode: false } },
      },
      'Product token'
    );
    assert.match(html, /<b>Name:<\/b><span>Golden copper<\/span>/);
    assert.match(html, /<b>Code:<\/b><b>P-2<\/b>/);
    assert.match(html, /<b>Pickup:<\/b><b>/);
    assert.match(html, /<b>Return:<\/b><b>/);
    assert.match(html, /<b>Notes:<\/b><b>/);
    assert.doesNotMatch(html, /PRODUCT BARCODE/);
  });
});
