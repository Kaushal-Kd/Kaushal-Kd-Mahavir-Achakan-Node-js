import {
  formatDate,
  formatOrderTime12,
  getIndiaDateTimeParts,
  normalizeTime12,
  nowDatetimeLocal,
  parseOrderTimeTo24,
  toISODate,
} from '@wrs/shared';

/** DD-MM-YYYY with optional h:mm AM/PM (avoids relying on a new @wrs/shared export in Vite cache). */
export function formatReminderDateTime(dateValue, timeValue) {
  const datePart = formatDate(dateValue);
  const timePart = timeValue ? formatOrderTime12(timeValue) : '';
  if (!datePart) return timePart || '—';
  if (!timePart || timePart === '—') return datePart;
  return `${datePart}\u00A0${timePart}`;
}

/** `datetime-local` value for right now (India). */
export function nowReminderDatetimeLocal() {
  return nowDatetimeLocal();
}

/**
 * @param {string} datetimeLocal — `YYYY-MM-DDTHH:mm`
 * @returns {{ reminder_date: string, reminder_time: string }}
 */
export function datetimeLocalToReminderFields(datetimeLocal) {
  const raw = String(datetimeLocal || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) {
    const now = nowReminderDatetimeLocal();
    return datetimeLocalToReminderFields(now);
  }
  const reminder_date = match[1];
  const reminder_time = normalizeTime12(match[2]) || '9:00 AM';
  return { reminder_date, reminder_time };
}

/**
 * @param {{ reminder_date?: string, reminder_time?: string|null }} row
 * @returns {string} datetime-local value
 */
export function reminderRowToDatetimeLocal(row) {
  const date = row?.reminder_date ? String(row.reminder_date).slice(0, 10) : toISODate(new Date());
  const t24 = parseOrderTimeTo24(row?.reminder_time) || '09:00';
  return `${date}T${t24}`;
}

export function reminderSortKey(row) {
  const date = String(row?.reminder_date || '').slice(0, 10);
  const time = parseOrderTimeTo24(row?.reminder_time) || '00:00';
  return `${date}T${time}`;
}

function reminderNowSortKey(referenceDate = new Date()) {
  const parts = getIndiaDateTimeParts(referenceDate);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** True when reminder date/time is now or already passed (excludes future). */
export function isReminderDueOrPast(row, referenceDate = new Date()) {
  const dueKey = reminderSortKey(row);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dueKey)) return false;
  return dueKey.localeCompare(reminderNowSortKey(referenceDate)) <= 0;
}
