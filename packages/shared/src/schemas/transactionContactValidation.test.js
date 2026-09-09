import assert from 'node:assert/strict';
import test from 'node:test';

import { createExpenseEntryBodySchema } from './expenseEntry.js';
import { createSaleBodySchema } from './sale.js';

const salePayload = {
  sale_date: '2026-08-17',
  customer_name: 'Customer',
  items: [{ name_snapshot: 'Item' }],
};

const expensePayload = {
  expense_account_id: 'expense-account',
  payment_account_id: 'cash-account',
  name: 'Expense',
  entry_date: '2026-08-17',
  amount: 100,
  details: 'Expense details',
};

test('sale mobile is optional but must be exactly 10 digits when provided', () => {
  assert.equal(createSaleBodySchema.safeParse(salePayload).success, true);
  assert.equal(
    createSaleBodySchema.safeParse({ ...salePayload, contact_no: '1234567890' }).success,
    true
  );
  assert.equal(
    createSaleBodySchema.safeParse({ ...salePayload, contact_no: '12345678901' }).success,
    false
  );
});

test('expense mobile is optional but must be exactly 10 digits when provided', () => {
  assert.equal(createExpenseEntryBodySchema.safeParse(expensePayload).success, true);
  assert.equal(
    createExpenseEntryBodySchema.safeParse({ ...expensePayload, contact_no: '1234567890' }).success,
    true
  );
  assert.equal(
    createExpenseEntryBodySchema.safeParse({ ...expensePayload, contact_no: '12345678901' }).success,
    false
  );
});
