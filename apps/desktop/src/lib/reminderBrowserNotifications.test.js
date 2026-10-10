import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listRemindersToNotify,
  loadNotifiedKeys,
  persistNotifiedKey,
  reminderNotificationBody,
  reminderOccurrenceKey,
  shouldFireReminderNotification,
  showBrowserReminderNotification,
} from './reminderBrowserNotifications.js';
import { reminderDueAtMs } from './reminderDateTime.js';

test('reminderDueAtMs uses India wall clock (UTC+05:30)', () => {
  const ms = reminderDueAtMs({ reminder_date: '2026-10-09', reminder_time: '8:14 PM' });
  assert.equal(ms, Date.parse('2026-10-09T20:14:00+05:30'));
});

test('occurrence key changes when the reminder is rescheduled', () => {
  const row = { id: 'r1', reminder_date: '2026-10-09', reminder_time: '8:00 PM' };
  assert.equal(reminderOccurrenceKey(row), 'r1::2026-10-09T20:00');
  assert.equal(
    reminderOccurrenceKey({ ...row, reminder_time: '8:15 PM' }),
    'r1::2026-10-09T20:15'
  );
});

test('fires only when due within the grace window and not already shown', () => {
  const row = {
    id: 'r1',
    reminder_date: '2026-10-09',
    reminder_time: '8:14 PM',
    is_completed: false,
  };
  const dueAt = reminderDueAtMs(row);
  const notifiedKeys = new Set();
  assert.equal(
    shouldFireReminderNotification(row, { nowMs: dueAt - 1_000, notifiedKeys, graceMs: 60_000 }),
    false
  );
  assert.equal(
    shouldFireReminderNotification(row, { nowMs: dueAt + 5_000, notifiedKeys, graceMs: 60_000 }),
    true
  );
  assert.equal(
    shouldFireReminderNotification(row, {
      nowMs: dueAt + 5 * 60 * 1000,
      notifiedKeys,
      graceMs: 60_000,
    }),
    false
  );
  notifiedKeys.add(reminderOccurrenceKey(row));
  assert.equal(
    shouldFireReminderNotification(row, { nowMs: dueAt + 5_000, notifiedKeys, graceMs: 60_000 }),
    false
  );
});

test('skips completed reminders and other assignees', () => {
  const dueAt = Date.parse('2026-10-09T20:14:00+05:30');
  const user = { id: 'u-1', name: 'Amit' };
  const rows = [
    {
      id: 'done',
      assignee_user_id: 'u-1',
      reminder_date: '2026-10-09',
      reminder_time: '8:14 PM',
      is_completed: true,
    },
    {
      id: 'other',
      assignee_user_id: 'u-2',
      reminder_date: '2026-10-09',
      reminder_time: '8:14 PM',
    },
    {
      id: 'mine',
      assignee_user_id: 'u-1',
      reminder_date: '2026-10-09',
      reminder_time: '8:14 PM',
    },
  ];
  const due = listRemindersToNotify(rows, {
    user,
    nowMs: dueAt + 1_000,
    notifiedKeys: new Set(),
    graceMs: 60_000,
  });
  assert.deepEqual(
    due.map((row) => row.id),
    ['mine']
  );
});

test('notified store remembers a firing and survives JSON round-trip', () => {
  const memory = {
    data: {},
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = String(value);
    },
  };
  const row = { id: 'r1', reminder_date: '2026-10-09', reminder_time: '8:14 PM' };
  persistNotifiedKey(memory, 'u-1', 'shop-1', reminderOccurrenceKey(row), 1_000);
  const keys = loadNotifiedKeys(memory, 'u-1', 'shop-1', 2_000);
  assert.equal(keys.has('r1::2026-10-09T20:14'), true);
  assert.equal(loadNotifiedKeys(memory, 'u-2', 'shop-1', 2_000).size, 0);
});

test('showBrowserReminderNotification uses the reminder text', () => {
  const created = [];
  function FakeNotification(title, options) {
    created.push({ title, options });
    this.title = title;
    this.options = options;
  }
  FakeNotification.permission = 'granted';
  const row = {
    id: 'r1',
    description: 'CHECK REMAINDER',
    reminder_date: '2026-10-09',
    reminder_time: '8:13 PM',
  };
  assert.equal(showBrowserReminderNotification(row, { NotificationImpl: FakeNotification }), true);
  assert.equal(created[0].title, 'Achakan reminder');
  assert.match(created[0].options.body, /CHECK REMAINDER/);
  assert.equal(reminderNotificationBody(row).includes('09-10-2026'), true);
});
