import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sortLinesForBookingTable } from './bookingAccessoryCart.js';

describe('sortLinesForBookingTable pair order', () => {
  it('keeps unpaired rent products before sale products', () => {
    const sorted = sortLinesForBookingTable([
      { line_id: 's1', product_id: 's', name_snapshot: 'Sale', display_order: 10, accessories: [{ selected: true, type: 'sell' }] },
      { line_id: 'r1', product_id: 'r', name_snapshot: 'Rent', display_order: 10, accessories: [] },
    ]);
    assert.equal(sorted[0].line_id, 'r1');
    assert.equal(sorted[1].line_id, 's1');
  });

  it('places the selected product first and its ID-pulled pair immediately after', () => {
    const group = 'men-angrakhu';
    const sorted = sortLinesForBookingTable([
      {
        line_id: 'pair',
        product_id: 'aa',
        code_snapshot: 'AA-0629[36]',
        name_snapshot: 'ANGRAKHA ANARKALI AA-629[36]',
        display_order: 20,
        pair_group_id: group,
        pair_offset: 1,
        accessories: [],
      },
      {
        line_id: 'selected',
        product_id: group,
        code_snapshot: 'A-0629[36]',
        name_snapshot: 'ANGRAKHU-629[36]',
        display_order: 10,
        pair_group_id: group,
        pair_offset: 0,
        accessories: [],
      },
    ]);
    assert.deepEqual(
      sorted.map((l) => l.code_snapshot),
      ['A-0629[36]', 'AA-0629[36]']
    );
  });

  it('keeps selected-then-pair when accessory fetch later marks the selected line sale-only', () => {
    const group = 'men-angrakhu';
    const sorted = sortLinesForBookingTable([
      {
        line_id: 'pair',
        product_id: 'aa',
        code_snapshot: 'AA-0629[36]',
        display_order: 20,
        pair_group_id: group,
        pair_offset: 1,
        accessories: [{ selected: true, type: 'rent' }],
      },
      {
        line_id: 'selected',
        product_id: group,
        code_snapshot: 'A-0629[36]',
        display_order: 10,
        pair_group_id: group,
        pair_offset: 0,
        accessories: [{ selected: true, type: 'sell' }],
      },
    ]);
    assert.deepEqual(
      sorted.map((l) => l.code_snapshot),
      ['A-0629[36]', 'AA-0629[36]']
    );
  });
});
