import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSafeThumbObjectPath,
  thumbObjectPathFromOriginal,
  thumbUrlForImage,
} from './gcsImageUrl.js';

test('thumbObjectPathFromOriginal inserts .thumb.webp before the original extension', () => {
  assert.equal(
    thumbObjectPathFromOriginal('products/shop-1/2024/01/abc.jpg'),
    'products/shop-1/2024/01/abc.thumb.webp'
  );
  assert.equal(
    thumbObjectPathFromOriginal('products/shop-1/2024/01/abc.thumb.webp'),
    'products/shop-1/2024/01/abc.thumb.webp'
  );
  assert.equal(thumbObjectPathFromOriginal('imports/file.zip'), '');
});

test('isSafeThumbObjectPath rejects traversal and non-thumb objects', () => {
  assert.equal(isSafeThumbObjectPath('products/a/2024/01/x.thumb.webp'), true);
  assert.equal(isSafeThumbObjectPath('products/a/2024/01/x.jpg'), false);
  assert.equal(isSafeThumbObjectPath('../x.thumb.webp'), false);
  assert.equal(isSafeThumbObjectPath('/products/x.thumb.webp'), false);
  assert.equal(isSafeThumbObjectPath('products//x.thumb.webp'), false);
});

test('thumbUrlForImage rewrites public GCS URLs and leaves signed URLs alone', () => {
  const original = 'https://storage.googleapis.com/weddingachakan/products/a/2024/01/abc.jpeg';
  assert.equal(
    thumbUrlForImage(original),
    'https://storage.googleapis.com/weddingachakan/products/a/2024/01/abc.thumb.webp'
  );
  const signed = `${original}?X-Goog-Signature=1`;
  assert.equal(thumbUrlForImage(signed), signed);
  assert.equal(thumbUrlForImage('https://example.com/logo.svg'), 'https://example.com/logo.svg');
  assert.equal(thumbUrlForImage(''), '');
});
