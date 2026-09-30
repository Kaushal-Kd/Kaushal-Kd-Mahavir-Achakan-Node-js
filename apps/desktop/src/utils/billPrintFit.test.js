import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BILL_PRINT_FIT,
  billPageContentHeightPx,
  computeBillPrintFitVars,
  mmToPx,
  searchBillFitLevel,
} from './billPrintFit.js';

describe('bill print one-page fit', () => {
  it('converts millimetres at CSS 96dpi', () => {
    assert.equal(mmToPx(25.4), 96);
  });

  it('uses the CSS page box (A4 minus @page margins) as the fit target', () => {
    const available = billPageContentHeightPx({ pageHeightMm: 297, pageMarginMm: 8 });
    assert.ok(available > mmToPx(270));
    assert.ok(available < mmToPx(290));
  });

  it('keeps comfortable type at t=0 and the readable compact floor at t=1', () => {
    const normal = computeBillPrintFitVars(0, {
      productSize: 12,
      accessorySize: 11,
      baseSize: 12,
      headingSize: 20,
    });
    assert.equal(normal.productSize, 12);
    assert.equal(normal.accessorySize, 11);
    assert.equal(normal.padY, 7);
    assert.equal(normal.chrome, 1);
    assert.equal(normal.zoom, 1);

    const compact = computeBillPrintFitVars(1, {
      productSize: 12,
      accessorySize: 11,
      baseSize: 12,
      headingSize: 20,
    });
    assert.equal(compact.productSize, BILL_PRINT_FIT.productMin);
    assert.equal(compact.accessorySize, BILL_PRINT_FIT.accessoryMin);
    assert.equal(compact.padY, BILL_PRINT_FIT.padYMin);
    assert.equal(compact.chrome, BILL_PRINT_FIT.chromeMin);
    assert.ok(compact.productSize >= 8);
    assert.ok(compact.accessorySize >= 7);
  });

  it('stays at t=0 when the bill already fits', () => {
    assert.deepEqual(searchBillFitLevel({ overflowsAt: () => false }), { t: 0 });
  });

  it('picks the smallest compactness that fits instead of a row-count guess', () => {
    const overflowUntil = 0.4;
    const { t } = searchBillFitLevel({
      overflowsAt: (value) => value < overflowUntil,
      maxIter: 14,
    });
    assert.ok(t >= overflowUntil);
    assert.ok(t < overflowUntil + 0.05);
  });

  it('returns t=1 when even compact type still overflows, so zoom can finish the job', () => {
    assert.deepEqual(searchBillFitLevel({ overflowsAt: () => true }), { t: 1 });
  });
});
