import assert from 'node:assert/strict';
import test from 'node:test';

import { expiredReminderOutcome, failedReminderOutcome } from './reminderLease.js';

test('crash before provider dispatch may retry, crash after dispatch needs review', () => {
  assert.equal(expiredReminderOutcome({}), 'pending');
  assert.equal(expiredReminderOutcome({ dispatch_started_at: new Date(), log_status: 'queued' }), 'uncertain');
  assert.equal(expiredReminderOutcome({ dispatch_started_at: new Date(), log_status: 'uncertain' }), 'uncertain');
});

test('durable sent acknowledgment recovers without another send', () => {
  assert.equal(expiredReminderOutcome({ dispatch_started_at: new Date(), log_status: 'sent' }), 'sent');
  assert.equal(failedReminderOutcome({ dispatched: true, logStatus: 'sent', temporary: true }), 'sent');
});

test('only definitely failed pre-dispatch transient attempts are retried automatically', () => {
  assert.equal(failedReminderOutcome({ dispatched: false, temporary: true }), 'pending');
  assert.equal(failedReminderOutcome({ dispatched: false, temporary: false }), 'failed');
  assert.equal(failedReminderOutcome({ dispatched: true, temporary: true }), 'uncertain');
  assert.equal(failedReminderOutcome({ dispatched: true, logStatus: 'failed', temporary: true }), 'pending');
});
