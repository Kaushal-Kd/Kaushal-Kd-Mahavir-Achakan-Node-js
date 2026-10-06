import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAppSettingValue } from './appSettings.js';

test('automatic WhatsApp time stores 24-hour HH:mm and accepts common picker values', () => {
  assert.deepEqual(validateAppSettingValue('whatsapp.delivery_reminder_time', '09:05'), {
    ok: true,
    value: '09:05',
  });
  assert.deepEqual(validateAppSettingValue('whatsapp.delivery_reminder_time', '12:40 PM'), {
    ok: true,
    value: '12:40',
  });
  assert.deepEqual(validateAppSettingValue('whatsapp.delivery_reminder_time', '12:40:00'), {
    ok: true,
    value: '12:40',
  });
  assert.deepEqual(validateAppSettingValue('whatsapp.delivery_reminder_time', '9:05'), {
    ok: true,
    value: '09:05',
  });
  assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', '09050000').ok, false);
  assert.equal(validateAppSettingValue('whatsapp.delivery_reminder_time', '24:00').ok, false);
});
