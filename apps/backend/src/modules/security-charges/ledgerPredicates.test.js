import assert from 'node:assert/strict';
import test from 'node:test';
import Knex from 'knex';

import {
  excludeConditionIncomeCashLeg,
  excludeConditionPaymentMovements,
  excludeDirectConditionPayments,
  retainedConditionAllocationSql,
  retainedConditionAllocationExpression,
} from './ledgerPredicates.js';

const db = Knex({ client: 'mysql2' });

test('ordinary security excludes only proven direct condition payments', () => {
  const sql = db('payments as p').modify(excludeDirectConditionPayments, 'p').toSQL().sql;
  assert.match(sql, /not exists/i);
  assert.match(sql, /cp.payment_id = p.id AND cp.shop_id = p.shop_id/);
  assert.match(sql, /funding_operation_id/);
});

test('filtered allocations bind original source account and operation dates in both branches', () => {
  const query = retainedConditionAllocationExpression(db, 'o.id', {
    securityAccountId: 'security-test',
    from: '2026-09-01',
    to: '2026-09-05',
  }).toSQL();
  assert.match(query.sql, /co.security_account_id = \?/);
  assert.match(query.sql, /co.payment_date >= \?/);
  assert.match(query.sql, /co.payment_date <= \?/);
  assert.match(query.sql, /sc.security_account_id = \?/);
  assert.deepEqual(query.bindings, [
    'security-test',
    '2026-09-01',
    '2026-09-05',
    'security-test',
    '2026-09-01',
    '2026-09-05',
  ]);
});

test('earned-income payment filter excludes condition receipts and refunds', () => {
  const sql = db('payments as p').modify(excludeConditionPaymentMovements, 'p').toSQL().sql;
  assert.match(sql, /not exists/i);
  assert.match(sql, /cp.payment_id = p.id/);
});

test('income recognition cannot create a duplicate cash leg', () => {
  const sql = db('income_entries as ie').modify(excludeConditionIncomeCashLeg, 'ie').toSQL().sql;
  assert.match(sql, /co.income_entry_id = ie.id AND co.shop_id = ie.shop_id/);
});

test('security allocations retain settled funds but release refunds and released holds', () => {
  const sql = retainedConditionAllocationSql('o.id');
  assert.match(sql, /co.kind IN \('release', 'refund'\)/);
  assert.doesNotMatch(sql, /co.kind = 'settle'/);
  assert.match(sql, /sc.money_flow_version IS NULL/);
  assert.doesNotMatch(sql, /sc.status = 'pending'/);
});
