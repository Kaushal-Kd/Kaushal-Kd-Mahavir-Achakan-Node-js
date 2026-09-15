import assert from 'node:assert/strict';
import test from 'node:test';

import { cosineSimilarity } from './visualSearchService.js';

test('visual similarity ranks aligned embeddings above unrelated ones', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.ok(cosineSimilarity([1, 1], [0.9, 1]) > 0.99);
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
});
