import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConditionDepositReconciliation,
  conditionOperationDateError,
  fundingLotBalances,
  summarizeChargeOperations,
} from './ledgerMath.js';

test('booking condition movements cannot use money released on a later date', () => {
  assert.match(conditionOperationDateError('2026-09-06', '2026-09-07'), /cannot precede/);
  assert.equal(conditionOperationDateError('2026-09-07', '2026-09-07'), null);
  assert.equal(conditionOperationDateError('2026-09-08', new Date('2026-09-07T00:00:00Z')), null);
  assert.equal(conditionOperationDateError('2026-09-01', null), null);
});

test('assessment alone has no held money or recognized income', () => {
  const state = summarizeChargeOperations(100);
  assert.equal(state.held, 0);
  assert.equal(state.uncollected, 100);
  assert.equal(state.settled, 0);
});

test('partial collection refund and settlement consume only the original held lot', () => {
  const operations = [
    { id: 'cash', kind: 'collect', amount: 100 },
    { kind: 'refund', funding_operation_id: 'cash', amount: 40 },
    { kind: 'settle', funding_operation_id: 'cash', amount: 60 },
  ];
  const result = summarizeChargeOperations(100, operations);
  assert.equal(result.held, 0);
  assert.equal(result.settled, 60);
  assert.equal(result.uncollected, 40);
  assert.equal(fundingLotBalances(operations)[0].available, 0);
});

test('retained and direct funds stay separate across partial operations', () => {
  const operations = [
    { id: 'retained', kind: 'retain', amount: 300 },
    { id: 'direct', kind: 'collect', amount: 100 },
    { kind: 'refund', funding_operation_id: 'retained', amount: 100 },
    { kind: 'settle', funding_operation_id: 'retained', amount: 200 },
  ];
  assert.equal(summarizeChargeOperations(400, operations).held, 100);
  assert.deepEqual(
    fundingLotBalances(operations).map((row) => [row.id, row.available]),
    [
      ['retained', 0],
      ['direct', 100],
    ]
  );
});

test('clearing condition preserves recognized history without making income refundable', () => {
  const state = summarizeChargeOperations(0, [
    { kind: 'collect', amount: 100 },
    { kind: 'settle', amount: 80 },
  ]);
  assert.equal(state.held, 20);
  assert.equal(state.refundable_excess, 20);
  assert.equal(state.settled_surplus, 80);
  assert.equal(state.uncollected, 0);
});

test('releasing booking security does not pretend money was paid back to customer', () => {
  const state = summarizeChargeOperations(0, [
    { kind: 'retain', amount: 300 },
    { kind: 'release', amount: 300 },
  ]);
  assert.equal(state.held, 0);
  assert.equal(state.refunded, 0);
  assert.equal(state.released, 300);
});

test('liability roll-forward uses original funding account when payout account changes', () => {
  const report = buildConditionDepositReconciliation(
    [
      {
        id: 'lot',
        kind: 'collect',
        amount: 100,
        payment_account_id: 'cash',
        account_name: 'Cash',
        payment_date: '2026-09-01',
      },
      {
        id: 'refund',
        kind: 'refund',
        amount: 40,
        funding_operation_id: 'lot',
        payment_account_id: 'bank',
        payment_date: '2026-09-05',
      },
      {
        id: 'income',
        kind: 'settle',
        amount: 20,
        funding_operation_id: 'lot',
        payment_date: '2026-09-06',
      },
    ],
    '2026-09-05',
    '2026-09-30'
  );
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].account_id, 'cash');
  assert.equal(report.summary.opening_held, 100);
  assert.equal(report.summary.refunded, 40);
  assert.equal(report.summary.recognized, 20);
  assert.equal(report.summary.closing_held, 40);
  assert.equal(report.rows[0].operations.length, 2);
  assert.equal(report.supplemental, true);
});

test('liability report distinguishes payment and security accounts with matching IDs', () => {
  const report = buildConditionDepositReconciliation(
    [
      {
        id: 'p',
        kind: 'collect',
        amount: 10,
        payment_account_id: 'same',
        payment_date: '2026-09-01',
      },
      {
        id: 's',
        kind: 'retain',
        amount: 30,
        security_account_id: 'same',
        payment_date: '2026-09-01',
      },
    ],
    '2026-09-01',
    '2026-09-02'
  );
  assert.equal(report.rows.length, 2);
  assert.equal(report.summary.closing_held, 40);
});

test('money arithmetic rounds at the currency boundary', () => {
  const state = summarizeChargeOperations(0.3, [
    { kind: 'collect', amount: 0.1 },
    { kind: 'collect', amount: 0.2 },
  ]);
  assert.equal(state.held, 0.3);
  assert.equal(state.uncollected, 0);
});
