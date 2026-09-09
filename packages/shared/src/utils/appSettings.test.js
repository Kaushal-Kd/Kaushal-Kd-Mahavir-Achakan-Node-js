import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAppSettingValue } from './appSettings.js';

test('automatic WhatsApp time accepts exactly 24-hour HH:mm', () => {
  assert.deepEqual(validateAppSettingValue('whatsapp.delivery_reminder_time', '09:05'), {
    ok: true,
    value: '09:05',
  });
  assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', '9:05').ok, false);
  assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', '09:05:00').ok, false);
  assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', '09050000').ok, false);
});
