import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapExpenseEntryRow,
  mapExpensePaymentRow,
  mapIncomeEntryRow,
  mapPaymentVoucherRow,
  mapReceiptVoucherRow,
  mergeByDate,
} from './incomeExpenseService.js';

test('finance voucher references preserve document kind separately from linked bills', () => {
  const payment = mapPaymentVoucherRow({
    source_id: 'pv-id',
    voucher_number: 'PV-10',
    bill_kind: 'purchase',
    bill_id: 'purchase-id',
    purchase_number: 'PUR-9',
  });
  assert.equal(payment.bill_no, 'PV-10');
  assert.equal(payment.reference_kind, 'payment_voucher');
  assert.equal(payment.voucher_id, 'pv-id');
  assert.equal(payment.linked_bill_id, 'purchase-id');
  assert.equal(payment.linked_bill_number, 'PUR-9');
  const receipt = mapReceiptVoucherRow({ source_id: 'rv-id', voucher_number: 'RV-10' });
  assert.equal(receipt.reference_kind, 'receipt_voucher');
  assert.equal(receipt.voucher_id, 'rv-id');
  assert.equal(receipt.bill_no, 'RV-10');
});

test('finance entry numbers and sale refunds retain their correct document identity', () => {
  assert.equal(mapIncomeEntryRow({ entry_number: 'IN-10' }).bill_no, 'IN-10');
  assert.equal(mapExpenseEntryRow({ entry_number: 'EX-10' }).bill_no, 'EX-10');
  const refund = mapExpensePaymentRow({
    sale_id: 'sale-id',
    sale_number: 'S-10',
    payment_category: 'refund',
    amount: 7,
  });
  assert.equal(refund.bill_no, 'S-10');
  assert.equal(refund.sale_id, 'sale-id');
  assert.match(refund.details, /^REFUND \(SALE/);
});

test('finance merge applies chronological direction before limiting and breaks ties stably', () => {
  const rows = [
    { source_id: 'b', date: '2031-04-02' },
    { source_id: 'a', date: '2031-04-02' },
  ];
  const other = [
    { source_id: 'old', date: '2031-04-01' },
    { source_id: 'new', date: '2031-04-03' },
  ];
  assert.deepEqual(
    mergeByDate(rows, other, 2, 'asc').map((row) => row.source_id),
    ['old', 'a']
  );
  assert.deepEqual(
    mergeByDate(rows, other, 2, 'desc').map((row) => row.source_id),
    ['new', 'a']
  );
});
