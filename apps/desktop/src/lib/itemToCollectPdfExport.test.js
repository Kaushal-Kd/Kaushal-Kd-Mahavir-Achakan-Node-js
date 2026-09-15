import assert from 'node:assert/strict';
import test from 'node:test';

import { ITEM_TO_COLLECT_PDF_EXPORT_COLUMNS } from './itemToCollectPdfExport.js';

test('item-to-collect export keeps design details separate from booking product notes', () => {
  const row = {
    product_catalog_notes: 'Blue thread with gold border',
    tailor_notes: 'Shorten sleeves by one inch',
  };
  const designColumn = ITEM_TO_COLLECT_PDF_EXPORT_COLUMNS.find(
    (column) => column.key === 'design_details'
  );
  const productNotesColumn = ITEM_TO_COLLECT_PDF_EXPORT_COLUMNS.find(
    (column) => column.key === 'product_notes'
  );

  assert.equal(designColumn?.header, 'Design Detail');
  assert.equal(designColumn?.get(row), row.product_catalog_notes);
  assert.equal(productNotesColumn?.get(row), row.tailor_notes);
});
