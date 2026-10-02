import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReminderAssigneeOptions,
  isReminderAssignedToUser,
} from './reminderDateTime.js';

test('assigned user id matches only that person', () => {
  const row = { assignee_user_id: 'u-2', assignee: 'Priya' };
  assert.equal(isReminderAssignedToUser(row, { id: 'u-2', name: 'Priya' }), true);
  assert.equal(isReminderAssignedToUser(row, { id: 'u-1', name: 'Amit' }), false);
});

test('SELF and blank assignee stay visible on every dashboard', () => {
  assert.equal(isReminderAssignedToUser({ assignee: 'SELF' }, { id: 'u-1', name: 'Amit' }), true);
  assert.equal(isReminderAssignedToUser({ assignee: '' }, { id: 'u-1', name: 'Amit' }), true);
});

test('legacy name-only assignee matches that user', () => {
  const row = { assignee: 'Miraj bhai' };
  assert.equal(isReminderAssignedToUser(row, { id: 'u-9', name: 'Miraj bhai' }), true);
  assert.equal(isReminderAssignedToUser(row, { id: 'u-1', name: 'Amit' }), false);
});

test('assignee dropdown lists shop users and keeps the current selection', () => {
  const options = buildReminderAssigneeOptions(
    [
      { id: 'u-2', name: 'Priya' },
      { id: 'u-1', name: 'Amit' },
    ],
    { id: 'u-1', name: 'Amit' },
    'u-9',
    'Old staff'
  );
  assert.deepEqual(
    options.map((row) => row.value),
    ['u-1', 'u-9', 'u-2']
  );
});
