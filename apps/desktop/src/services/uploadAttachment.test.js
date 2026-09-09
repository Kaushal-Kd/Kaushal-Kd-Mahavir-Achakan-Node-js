import assert from 'node:assert/strict';
import test from 'node:test';

import { processImageUploadBatch } from './multiImageUploadBatch.js';
import { isAcceptedUploadAttachment, isPdfAttachmentUrl, prepareUploadAttachment } from './uploadAttachment.js';

const noImagePreparation = () => { assert.fail('PDF must not be cropped or image-compressed'); };

test('PDF attachments with browser-omitted or generic MIME are normalized without changing bytes', async () => {
  for (const type of ['', 'application/octet-stream', 'application/pdf']) {
    const file = new File(['%PDF-1.7\nfixture'], 'BILL.PDF', { type });
    const prepared = await prepareUploadAttachment(file, { allowPdf: true, prepareImage: noImagePreparation });
    assert.equal(prepared.type, 'application/pdf');
    assert.equal(prepared.name, 'BILL.PDF');
    assert.equal(await prepared.text(), await file.text());
  }
});

test('a PDF extension or MIME alone cannot pass validation for non-PDF or empty bytes', async () => {
  for (const content of ['', '<html>not a PDF</html>', '%PD']) {
    const file = new File([content], 'bill.pdf', { type: 'application/pdf' });
    await assert.rejects(prepareUploadAttachment(file, { allowPdf: true, prepareImage: noImagePreparation }), /not a valid PDF/);
  }
});

test('image-only uploaders still reject PDFs and conflicting declared content is rejected', async () => {
  const pdf = new File(['%PDF-1.7'], 'bill.pdf', { type: 'application/pdf' });
  assert.equal(isAcceptedUploadAttachment(pdf), false);
  assert.equal(isAcceptedUploadAttachment(pdf, true), true);
  assert.equal(isAcceptedUploadAttachment(new File(['html'], 'bill.pdf', { type: 'text/html' }), true), false);
  await assert.rejects(prepareUploadAttachment(pdf, { prepareImage: noImagePreparation }), /Choose an image/);
  const image = new File(['image'], 'bill.jpg', { type: 'image/jpeg' });
  assert.equal(await prepareUploadAttachment(image, { prepareImage: async (file) => file }), image);
});

test('PDF preview detection handles signed query strings, uppercase suffixes and relative URLs', () => {
  assert.equal(isPdfAttachmentUrl('https://example.invalid/bill.PDF?signature=fixture#page=1'), true);
  assert.equal(isPdfAttachmentUrl('/uploads/bill.pdf?token=fixture'), true);
  assert.equal(isPdfAttachmentUrl('https://example.invalid/photo.jpg?filename=bill.pdf'), false);
  assert.equal(isPdfAttachmentUrl('https://example.invalid/bill.pdf.png'), false);
});

test('mixed batch uploads only validated PDFs and preserves normalized MIME for the fake signed upload', async () => {
  const uploaded = [];
  const files = [
    new File(['%PDF-1.7\nvalid'], 'valid.pdf'),
    new File(['not a PDF'], 'invalid.pdf'),
    new File(['%PDF-' + 'x'.repeat(50)], 'too-large.pdf'),
  ];
  const result = await processImageUploadBatch(files, {
    prepareFile: (file) => prepareUploadAttachment(file, { allowPdf: true, prepareImage: noImagePreparation }),
    uploadFile: async (file) => { uploaded.push(file); return 'https://example.invalid/valid.pdf'; },
    maxFileBytes: 30,
  });
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].type, 'application/pdf');
  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.uploaded, ['https://example.invalid/valid.pdf']);
});
