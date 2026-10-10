import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loadPairSuggestionsForMatches,
  mergePairSuggestions,
  pickProductsForPairLookup,
  relatedToSuggestionRow,
  resolveBookingAddPrimary,
} from './productPairSuggestions.js';

describe('pickProductsForPairLookup', () => {
  const ang = { id: 'p1', code: 'A-0629[36]', name: 'ANGRAKHU-629[36]' };
  const pair = { id: 'p2', code: 'AA-0629[36]', name: 'ANGRAKHA-629[36]' };
  const other = { id: 'p3', code: 'B-0100[38]', name: 'OTHER' };

  it('returns exact code matches before ranked rows', () => {
    const picked = pickProductsForPairLookup([other, ang, pair], 'A-0629[36]');
    assert.deepEqual(
      picked.map((p) => p.id),
      ['p1']
    );
  });

  it('matches codes case-insensitively', () => {
    const picked = pickProductsForPairLookup([ang], 'a-0629[36]');
    assert.equal(picked[0].id, 'p1');
  });

  it('falls back to code prefix matches', () => {
    const picked = pickProductsForPairLookup([ang, pair, other], 'A-0629');
    assert.deepEqual(
      picked.map((p) => p.id),
      ['p1']
    );
  });

  it('uses the top ranked match when nothing is an exact/prefix hit', () => {
    const picked = pickProductsForPairLookup([other, ang], 'shawl');
    assert.deepEqual(
      picked.map((p) => p.id),
      ['p3']
    );
  });

  it('limits visual-search rows when there is no query', () => {
    const picked = pickProductsForPairLookup([ang, pair, other], '', { limit: 2 });
    assert.deepEqual(
      picked.map((p) => p.id),
      ['p1', 'p2']
    );
  });
});

describe('mergePairSuggestions', () => {
  it('inserts the pair immediately after its matched product', () => {
    const ang = { id: 'p1', code: 'A-0629[36]' };
    const other = { id: 'p3', code: 'B-0100[38]' };
    const pair = {
      id: 'p2',
      code: 'AA-0629[36]',
      suggested_as_pair: true,
      pair_of_product_id: 'p1',
    };
    const merged = mergePairSuggestions([ang, other], new Map([['p1', [pair]]]));
    assert.deepEqual(
      merged.map((p) => p.id),
      ['p1', 'p2', 'p3']
    );
  });

  it('does not duplicate a pair that already matched the search', () => {
    const ang = { id: 'p1', code: 'A-0629[36]' };
    const pair = { id: 'p2', code: 'AA-0629[36]' };
    const merged = mergePairSuggestions(
      [ang, pair],
      new Map([['p1', [{ id: 'p2', code: 'AA-0629[36]', suggested_as_pair: true }]]])
    );
    assert.deepEqual(
      merged.map((p) => p.id),
      ['p1', 'p2']
    );
  });

  it('moves a mapped pair that ranked above the main product to sit under it', () => {
    const ang = { id: 'p1', code: 'A-0634[34]', name: 'ANGRAKHU-634[34]' };
    const pair = { id: 'p2', code: 'AA-0634[34]', name: 'ANGRAKHA ANARKALI AA-634[34]' };
    const merged = mergePairSuggestions(
      [pair, ang],
      new Map([['p1', [{ id: 'p2', code: 'AA-0634[34]', suggested_as_pair: true }]]])
    );
    assert.deepEqual(
      merged.map((p) => p.code),
      ['A-0634[34]', 'AA-0634[34]']
    );
    assert.equal(merged[1].suggested_as_pair, true);
    assert.equal(merged[1].pair_of_product_id, 'p1');
  });
});

describe('relatedToSuggestionRow', () => {
  it('prefers availability fields and tags the pair source', () => {
    const row = relatedToSuggestionRow(
      {
        related_product_id: 'p2',
        code: 'AA-0629[36]',
        name: 'ANGRAKHA',
        price_rent: 10,
        is_recommended: true,
      },
      {
        id: 'p2',
        code: 'AA-0629[36]',
        name: 'ANGRAKHA-629[36]',
        free_qty: 1,
        total_qty: 1,
        can_book: true,
        price_rent: 500,
      },
      { id: 'p1', code: 'A-0629[36]' }
    );
    assert.equal(row.id, 'p2');
    assert.equal(row.suggested_as_pair, true);
    assert.equal(row.pair_of_product_id, 'p1');
    assert.equal(row.pair_of_code, 'A-0629[36]');
    assert.equal(row.free_qty, 1);
    assert.equal(row.price_rent, 500);
    assert.equal(row.name, 'ANGRAKHA-629[36]');
  });
});

describe('loadPairSuggestionsForMatches', () => {
  it('appends mapped pair products that were missing from search hits', async () => {
    const ang = { id: 'p1', code: 'A-0629[36]', name: 'ANGRAKHU-629[36]' };
    const merged = await loadPairSuggestionsForMatches({
      matches: [ang],
      search: 'A-0629[36]',
      availability: { from: '2026-10-06', to: '2026-10-09', qty: 1 },
      getRelatedMapping: async () => ({
        data: {
          products: [
            {
              related_product_id: 'p2',
              code: 'AA-0629[36]',
              name: 'ANGRAKHA-629[36]',
              is_recommended: true,
            },
          ],
        },
      }),
      bookingAvailability: async () => ({
        data: [
          {
            id: 'p2',
            code: 'AA-0629[36]',
            name: 'ANGRAKHA-629[36]',
            free_qty: 1,
            total_qty: 1,
            can_book: true,
          },
        ],
      }),
    });
    assert.deepEqual(
      merged.map((p) => p.id),
      ['p1', 'p2']
    );
    assert.equal(merged[1].suggested_as_pair, true);
    assert.equal(merged[1].pair_of_code, 'A-0629[36]');
    assert.equal(merged[1].free_qty, 1);
  });

  it('still suggests the pair when availability lookup is skipped', async () => {
    const ang = { id: 'p1', code: 'A-0629[36]' };
    const merged = await loadPairSuggestionsForMatches({
      matches: [ang],
      search: 'A-0629[36]',
      forBooking: false,
      getRelatedMapping: async () => ({
        data: {
          products: [{ related_product_id: 'p2', code: 'AA-0629[36]', name: 'ANGRAKHA' }],
        },
      }),
    });
    assert.equal(merged[1].id, 'p2');
    assert.equal(merged[1].suggested_as_pair, true);
    assert.equal(merged[1].code, 'AA-0629[36]');
  });
});

describe('resolveBookingAddPrimary', () => {
  const ang = { id: 'p1', code: 'A-0634[34]', name: 'ANGRAKHU-634[34]' };
  const pair = {
    id: 'p2',
    code: 'AA-0634[34]',
    name: 'ANGRAKHA ANARKALI',
    suggested_as_pair: true,
    pair_of_product_id: 'p1',
    pair_of_code: 'A-0634[34]',
  };

  it('keeps the selected main product', () => {
    assert.equal(resolveBookingAddPrimary(ang, [ang, pair], 'A-0634[34]'), ang);
  });

  it('promotes the main product when a mapped pair is clicked', () => {
    assert.equal(resolveBookingAddPrimary(pair, [ang, pair], 'A-0634').id, 'p1');
  });

  it('keeps the pair when its code was typed exactly', () => {
    assert.equal(resolveBookingAddPrimary(pair, [ang, pair], 'AA-0634[34]'), pair);
  });
});
