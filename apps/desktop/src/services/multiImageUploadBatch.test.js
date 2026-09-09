import assert from 'node:assert/strict';
import test from 'node:test';

import { processImageUploadBatch } from './multiImageUploadBatch.js';

const files = [
  { name: 'one.jpg', size: 1 },
  { name: 'two.jpg', size: 1 },
  { name: 'three.jpg', size: 1 },
];

test('prepares sequentially, uploads concurrently, and preserves selected order', async () => {
  const prepareEvents = [];
  let activePrepare = 0;
  let maxActivePrepare = 0;
  const result = await processImageUploadBatch(files, {
    maxFileBytes: 10,
    workerCount: 2,
    prepareFile: async (file) => {
      activePrepare += 1;
      maxActivePrepare = Math.max(maxActivePrepare, activePrepare);
      prepareEvents.push(file.name);
      await Promise.resolve();
      activePrepare -= 1;
      return file;
    },
    uploadFile: async (file) => {
      await new Promise((resolve) => setTimeout(resolve, file.name === 'one.jpg' ? 10 : 1));
      return `https://images.test/${file.name}`;
    },
  });

  assert.equal(maxActivePrepare, 1);
  assert.deepEqual(prepareEvents, ['one.jpg', 'two.jpg', 'three.jpg']);
  assert.deepEqual(result.uploaded, [
    'https://images.test/one.jpg',
    'https://images.test/two.jpg',
    'https://images.test/three.jpg',
  ]);
});

test('a cancelled crop skips one image without blocking the rest', async () => {
  const cancelled = new Error('crop_cancelled');
  const result = await processImageUploadBatch(files, {
    maxFileBytes: 10,
    prepareFile: async (file) => {
      if (file.name === 'two.jpg') throw cancelled;
      return file;
    },
    isPreparationCancelled: (error) => error === cancelled,
    uploadFile: async (file) => `https://images.test/${file.name}`,
  });

  assert.deepEqual(result.uploaded, [
    'https://images.test/one.jpg',
    'https://images.test/three.jpg',
  ]);
  assert.equal(result.failed, 0);
  assert.equal(result.results[1].cancelled, true);
});

test('reports upload failures and oversized files while retaining successful uploads', async () => {
  const result = await processImageUploadBatch(
    [...files, { name: 'large.jpg', size: 20 }],
    {
      maxFileBytes: 10,
      prepareFile: async (file) => file,
      uploadFile: async (file) => {
        if (file.name === 'two.jpg') throw new Error('upload failed');
        return `https://images.test/${file.name}`;
      },
    }
  );

  assert.equal(result.failed, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.uploaded, [
    'https://images.test/one.jpg',
    'https://images.test/three.jpg',
  ]);
});
