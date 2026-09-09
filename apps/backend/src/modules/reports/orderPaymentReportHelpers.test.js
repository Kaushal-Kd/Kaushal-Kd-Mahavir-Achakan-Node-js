import assert from 'node:assert/strict';
import test from 'node:test';

import { sqlPaymentOrderStatusExpr } from './orderPaymentReportHelpers.js';

test('finance status SQL prioritizes immutable event stage over later order milestones', () => {
  const sql = sqlPaymentOrderStatusExpr();
  assert.ok(sql.indexOf("p.payment_stage = 'booking'") < sql.indexOf('o.returned_at'));
  assert.match(sql, /p.payment_stage = 'return' THEN 'returned'/);
});

test('legacy status SQL does not treat backfilled buckets as observed events', () => {
  const sql = sqlPaymentOrderStatusExpr();
  assert.match(sql, /order_status_at_payment NOT IN \('booked', 'delivered', 'returned'\)/);
  assert.doesNotMatch(
    sql,
    /order_status_at_payment IN \('partially_returned', 'returned', 'closed'\)/
  );
  assert.match(sql, /o.status IN \('partially_returned', 'returned', 'closed'\) THEN 'returned'/);
  assert.match(sql, /DATE_ADD\(p.created_at, INTERVAL 330 MINUTE\)/);
  assert.match(sql, /DATE_ADD\(o.delivered_at, INTERVAL 330 MINUTE\)/);
});
