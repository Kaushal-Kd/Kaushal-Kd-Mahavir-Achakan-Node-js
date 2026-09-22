import assert from 'node:assert/strict';
import test from 'node:test';

import {
  replacementReminderDescription,
  replacementReminderSchedule,
} from './replacementReminder.js';

test('damage replacement reminders fire on the damage day, not the day before pickup', () => {
  assert.deepEqual(replacementReminderSchedule('2026-09-21'), {
    reminder_date: '2026-09-21',
    reminder_time: '12:00 AM',
  });
});

test('reminder copy names the damaged product and bill so staff can call', () => {
  assert.match(
    replacementReminderDescription('A-12 Sherwani', 'K-0008'),
    /A-12 Sherwani/
  );
  assert.match(replacementReminderDescription('A-12 Sherwani', 'K-0008'), /K-0008/);
  assert.match(replacementReminderDescription('A-12 Sherwani', 'K-0008'), /call the customer/);
});
