import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateCustomOrderWorkshop,
  customOrderItemHasWorkshopData,
  customOrderItemsFromOrder,
  formatCustomOrderMeasurementsSummary,
  formatCustomOrderProductsLabel,
  nextUnlinkedCustomOrderItem,
  primaryCustomOrderItemFields,
} from './customOrderItems.js';

describe('customOrderItemsFromOrder', () => {
  it('uses saved items when present', () => {
    const items = customOrderItemsFromOrder({
      product_name: 'Parent',
      items: [
        { product_name: 'Sherwani', design_name: 'A' },
        { product_name: 'Jacket', design_name: 'B' },
      ],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].product_name, 'Sherwani');
    assert.equal(items[1].product_name, 'Jacket');
  });

  it('falls back to parent product columns', () => {
    const items = customOrderItemsFromOrder({
      design_name: 'Royal',
      product_name: 'Sherwani',
      color: 'Maroon',
      size: '40',
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].product_name, 'Sherwani');
    assert.equal(items[0].design_name, 'Royal');
  });
});

describe('primaryCustomOrderItemFields', () => {
  it('copies the first item onto parent columns', () => {
    const fields = primaryCustomOrderItemFields([
      { product_name: 'Sherwani', category_id: 'c1', color: 'Red' },
      { product_name: 'Jacket' },
    ]);
    assert.equal(fields.product_name, 'Sherwani');
    assert.equal(fields.category_id, 'c1');
    assert.equal(fields.color, 'Red');
  });
});

describe('formatCustomOrderProductsLabel', () => {
  it('joins product names', () => {
    const label = formatCustomOrderProductsLabel({
      items: [{ product_name: 'Sherwani' }, { design_name: 'Jacket design' }],
    });
    assert.equal(label, 'Sherwani, Jacket design');
  });
});

describe('nextUnlinkedCustomOrderItem', () => {
  it('skips already linked lines', () => {
    const next = nextUnlinkedCustomOrderItem({
      items: [
        { id: 'a', product_name: 'Sherwani', linked_product_id: 'p1' },
        { id: 'b', product_name: 'Jacket' },
      ],
    });
    assert.equal(next.id, 'b');
  });
});

describe('custom order item workshop', () => {
  it('hydrates first item from parent measurements when items have none', () => {
    const items = customOrderItemsFromOrder({
      trial_date: '2026-11-01',
      measurements: { chest: '40' },
      given_to_tailor: true,
      tailor_name: 'Raju',
      items: [{ product_name: 'Sherwani' }, { product_name: 'Jacket' }],
    });
    assert.equal(items[0].product_name, 'Sherwani');
    assert.equal(items[0].trial_date, '2026-11-01');
    assert.equal(items[0].measurements.chest, '40');
    assert.equal(items[0].tailor_name, 'Raju');
    assert.equal(items[1].trial_date, '');
    assert.equal(customOrderItemHasWorkshopData(items[1]), false);
  });

  it('keeps per-item workshop when already saved', () => {
    const items = customOrderItemsFromOrder({
      trial_date: '2026-11-01',
      items: [
        { product_name: 'Sherwani', trial_date: '2026-11-02', measurements: { chest: '42' } },
        { product_name: 'Jacket', trial_date: '2026-11-03' },
      ],
    });
    assert.equal(items[0].trial_date, '2026-11-02');
    assert.equal(items[1].trial_date, '2026-11-03');
    assert.equal(items[0].measurements.chest, '42');
  });

  it('aggregates earliest trial and any given-to-tailor', () => {
    const snap = aggregateCustomOrderWorkshop([
      { measurements: { chest: '40' }, trial_date: '2026-11-10' },
      { given_to_tailor: true, tailor_name: 'Kiran', tailor_date: '2026-11-02', trial_date: '2026-11-05' },
    ]);
    assert.equal(snap.measurements.chest, '40');
    assert.equal(snap.given_to_tailor, true);
    assert.equal(snap.tailor_name, 'Kiran');
    assert.equal(snap.trial_date, '2026-11-05');
  });

  it('summarizes measurements per product', () => {
    const label = formatCustomOrderMeasurementsSummary(
      {
        items: [
          { product_name: 'Sherwani', measurements: { c1: '40' } },
          { product_name: 'Jacket', measurements: { c1: '38' } },
        ],
      },
      [{ id: 'c1', label: 'Chest', unit: 'in' }]
    );
    assert.equal(label, 'Sherwani — Chest: 40 in\nJacket — Chest: 38 in');
  });
});
