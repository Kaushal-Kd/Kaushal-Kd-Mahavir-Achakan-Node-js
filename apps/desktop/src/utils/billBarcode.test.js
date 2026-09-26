import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BILL_BARCODE_PREFIX,
  encodeBillBarcodeValue,
  parseBillBarcodeValue,
  resolveBillFromScan,
} from './billBarcode.js';

describe('bill barcode', () => {
  it('encodes a bill number with a stable prefix', () => {
    assert.equal(encodeBillBarcodeValue('INV-0001'), `${BILL_BARCODE_PREFIX}INV-0001`);
    assert.equal(encodeBillBarcodeValue('  BILL:NM-00133  '), 'BILL:NM-00133');
    assert.equal(encodeBillBarcodeValue(''), '');
  });

  it('parses only prefixed bill codes', () => {
    assert.equal(parseBillBarcodeValue('BILL:INV-0001'), 'INV-0001');
    assert.equal(parseBillBarcodeValue('bill:NM-00133'), 'NM-00133');
    assert.equal(parseBillBarcodeValue('INV-0001'), '');
    assert.equal(parseBillBarcodeValue('SH-001'), '');
  });

  it('resolves a scanned bill code to the matching booking', async () => {
    const result = await resolveBillFromScan({
      scanned: 'BILL:INV-0001',
      listOrders: async () => ({
        data: [{ id: 44, order_number: 'INV-0001' }],
      }),
      listSales: async () => ({ data: [] }),
    });
    assert.deepEqual(result, { kind: 'booking', id: 44 });
  });

  it('opens a sale bill when no booking matches', async () => {
    const result = await resolveBillFromScan({
      scanned: 'BILL:SL-009',
      listOrders: async () => ({ data: [] }),
      listSales: async () => ({
        data: [{ id: 9, sale_number: 'SL-009' }],
      }),
    });
    assert.deepEqual(result, { kind: 'sale', id: 9 });
  });

  it('does not treat product codes as bills', async () => {
    const result = await resolveBillFromScan({
      scanned: 'SH-001',
      listOrders: async () => {
        throw new Error('should not search orders');
      },
    });
    assert.deepEqual(result, { kind: 'not_bill' });
  });
});
