import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { flattenPurchaseAttachments, normalizePurchaseAttachmentUrls } from './purchaseAttachments.js';

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

  it('flattens selected bill images with stable keys', () => {
    const items = flattenPurchaseAttachments([
      { id: 'p1', purchase_number: 'P001', image_urls: ['a.jpg', 'b.jpg'] },
      { id: 'p2', purchase_number: 'P002', image_urls: '["c.jpg"]' },
      { id: 'p3', purchase_number: 'P003', image_urls: [] },
    ]);
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => item.key),
      ['p1:0', 'p1:1', 'p2:0']
    );
    assert.equal(items[1].url, 'b.jpg');
    assert.equal(items[2].purchase.purchase_number, 'P002');
  });

  it('rejects an empty image PDF', async () => {
    const { buildSelectedPurchaseImagesPdfDoc } = await import('./purchaseCombinedPdf.js');
    await assert.rejects(
      () => buildSelectedPurchaseImagesPdfDoc([]),
      /Select at least one image/
    );
  });

  it('puts the matching purchase table row on each image page', async () => {
    const { buildPurchaseCombinedPdfDoc } = await import('./purchaseCombinedPdf.js');
    const columns = [
      { key: 'purchase_number', header: 'Bill No', get: (r) => r.purchase_number },
      { key: 'vendor_account_name', header: 'Vendor', get: (r) => r.vendor_account_name },
    ];
    const purchases = [
      {
        id: 'p1',
        purchase_number: 'PNM-0004',
        vendor_account_name: 'KAMLESH MODI',
        image_urls: ['https://example.test/bill.jpg'],
      },
      {
        id: 'p2',
        purchase_number: 'PNM-0002',
        vendor_account_name: 'ADIDAS',
        image_urls: [],
      },
    ];
    const doc = await buildPurchaseCombinedPdfDoc(columns, purchases, {
      title: 'Purchases',
      fetchImpl: async () => ({ ok: false }),
    });
    assert.equal(doc.getNumberOfPages(), 2);
  });
});
