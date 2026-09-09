import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAppSettingValue } from '@wrs/shared/utils/appSettings.js';

import {
  canReactivateDeliveryReminder,
  deliveryReminderCancellationReason,
  deliveryReminderScheduledAt,
  isDeliveryReminderOrderStatus,
} from './reminderEligibility.js';

test('delivery reminders run only while the booking is in the preparation stage', () => {
  assert.equal(isDeliveryReminderOrderStatus('in_preparation'), true);
  assert.equal(isDeliveryReminderOrderStatus('ready_for_delivery'), false);
  assert.equal(isDeliveryReminderOrderStatus('booked'), false);
  assert.equal(isDeliveryReminderOrderStatus('delivered'), false);
});

test('reminder schedule is a valid instant on the preceding India calendar day', () => {
  assert.equal(deliveryReminderScheduledAt('2026-09-06', '10:00').toISOString(), '2026-09-05T04:30:00.000Z');
  assert.equal(deliveryReminderScheduledAt('2026-01-01', '00:05').toISOString(), '2025-12-30T18:35:00.000Z');
  assert.equal(deliveryReminderScheduledAt('2026-09-06', '999:00').toISOString(), '2026-09-05T04:30:00.000Z');
});

test('reminder time accepts 24-hour boundaries and rejects malformed pasted settings', () => {
  for (const time of ['00:00', '09:05', '23:59']) {
    assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', time).ok, true);
  }
  for (const time of ['24:00', '23:60', '1:05', '12:5', '12:05:00', '123456', 'ab:cd', '-1:00']) {
    assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', time).ok, false, time);
  }
  assert.equal(deliveryReminderScheduledAt('2026-03-01', '00:00').toISOString(), '2026-02-27T18:30:00.000Z');
  assert.equal(deliveryReminderScheduledAt('2028-03-01', '23:59').toISOString(), '2028-02-29T18:29:00.000Z');
});

test('reminder allows partial preparation only the day before current pickup', () => {
  assert.equal(deliveryReminderCancellationReason(
    { delivery_date: '2026-09-06' },
    { status: 'in_preparation', pickup_date: '2026-09-06', items: [{ prepared: false }] },
    '2026-09-05'
  ), null);
});

test('reminder rejects changed pickup date and wrong reminder date', () => {
  const job = { delivery_date: '2026-09-06' };
  assert.equal(deliveryReminderCancellationReason(job, {
    status: 'in_preparation', pickup_date: '2026-09-08',
  }, '2026-09-05'), 'Booking delivery date changed');
  for (const today of ['2026-09-04', '2026-09-06', '2026-09-07']) {
    assert.ok(deliveryReminderCancellationReason(job, {
      status: 'in_preparation', pickup_date: '2026-09-06',
    }, today));
  }
});

test('reminder rejects all non-preparation statuses and missing bookings', () => {
  for (const status of ['ready_for_delivery', 'delivered', 'cancelled', 'returned', 'booked']) {
    assert.equal(deliveryReminderCancellationReason({ delivery_date: '2026-09-06' }, {
      status, pickup_date: '2026-09-06',
    }, '2026-09-05'), 'Booking is no longer eligible');
  }
  assert.ok(deliveryReminderCancellationReason({ delivery_date: '2026-09-06' }, null, '2026-09-05'));
});

test('only cancelled never-sent reminders can reactivate', () => {
  assert.equal(canReactivateDeliveryReminder({ status: 'cancelled' }), true);
  assert.equal(canReactivateDeliveryReminder({ status: 'sent' }), false);
  assert.equal(canReactivateDeliveryReminder({ status: 'processing' }), false);
  assert.equal(canReactivateDeliveryReminder({ status: 'cancelled', sent_at: new Date() }), false);
  assert.equal(canReactivateDeliveryReminder({ status: 'cancelled', message_log_id: 'sent-log' }), false);
});
