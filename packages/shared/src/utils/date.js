/**
 * Indian-locale date helpers (DD-MM-YYYY).
 * Kept dependency-free so both backend and frontend can use it.
 */

/** IANA zone for all user-visible date/time in this product. */
export const INDIA_TIME_ZONE = 'Asia/Kolkata';

const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/;
const TIMEZONE_LESS_INSTANT_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?$/;

function isTimezoneLessDateTimeString(value) {
  const raw = String(value ?? '').trim();
  if (!MYSQL_DATETIME_RE.test(raw)) return false;
  return !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
}

function hasExplicitTimezone(value) {
  const raw = String(value ?? '').trim();
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
}

/**
 * Parse audit timestamps (MySQL TIMESTAMP / API ISO) as UTC instants.
 * Timezone-less datetime strings are treated as UTC wall digits, not IST.
 * @param {Date|string|number|null|undefined} value
 * @returns {Date|null}
 */
export function parseInstant(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  if (hasExplicitTimezone(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (isTimezoneLessDateTimeString(raw)) {
    const m = raw.match(TIMEZONE_LESS_INSTANT_RE);
    if (m) {
      const d = new Date(`${m[1]}T${m[2]}Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const normalized = raw.replace(' ', 'T');
    const d = new Date(`${normalized}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Never localize a date-bearing string. Any remaining string that carries a
  // calendar date but no timezone is treated as a UTC instant so display never
  // depends on the viewer's machine timezone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
    const d = new Date(`${raw.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') return null;

  return toDate(value);
}

/**
 * Serialize an audit timestamp to ISO-8601 UTC (with Z).
 * @param {Date|string|number|null|undefined} value
 * @returns {string|null}
 */
export function serializeInstant(value) {
  const d = parseInstant(value);
  return d ? d.toISOString() : null;
}

/**
 * India month bucket YYYY-MM for dashboards and reports.
 * @param {Date|string|number|null|undefined} [value]
 * @returns {string}
 */
export function toIndiaYearMonth(value = new Date()) {
  const parts = getIndiaDateTimeParts(parseInstant(value) || toDate(value) || new Date());
  if (!parts) return '';
  return `${parts.year}-${parts.month}`;
}

/**
 * @param {Date} date
 * @returns {{ year: string, month: string, day: string, hour: string, minute: string, second?: string } | null}
 */
export function getIndiaDateTimeParts(date) {
  const d = toDate(date);
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = Object.fromEntries(
    fmt.formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value])
  );
  if (!map.year || !map.month || !map.day) return null;
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour ?? '00',
    minute: map.minute ?? '00',
    second: map.second ?? '00',
  };
}

/**
 * @param {Date|string|number|null|undefined} value
 * @returns {Date|null}
 */
export function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Calendar YYYY-MM-DD prefix (from MySQL DATE/DATETIME or ISO) → DD-MM-YYYY without timezone shift.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatIsoDateDisplay(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}-${mo}-${y}`;
}

/**
 * Normalize booking delivery/return time to HH:MM for storage and display.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function normalizeOrderTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Stored/display time pattern: `h:mm AM` or `h:mm PM`. */
export const TIME_12H_REGEX = /^(?:[01]?[0-9]|1[0-2]):[0-5]\d (AM|PM)$/;

export function formatOrderTime(value) {
  return formatOrderTime12(value);
}

/**
 * Parse HH:MM (24h) or h:mm AM/PM into 24-hour HH:MM for datetime-local inputs.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function parseOrderTimeTo24(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const minutes = Number(ampm[2]);
    const period = ampm[3].toUpperCase();
    if (!Number.isFinite(h) || !Number.isFinite(minutes)) return null;
    if (h < 1 || h > 12 || minutes < 0 || minutes > 59) return null;
    if (period === 'AM' && h === 12) h = 0;
    else if (period === 'PM' && h !== 12) h += 12;
    return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return normalizeOrderTime(raw);
}

/**
 * Display order/booking time as 12-hour clock with AM/PM.
 * Accepts stored 12h or legacy 24h HH:MM values.
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function formatOrderTime12(value) {
  const t24 = parseOrderTimeTo24(value);
  if (!t24) return '—';
  const [hStr, mStr] = t24.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '—';
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Normalize time for DB storage: `h:mm AM` / `h:mm PM` (12-hour).
 * Used for booking, delivery, return, and configured time slots.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function normalizeTime12(value) {
  const t24 = parseOrderTimeTo24(value);
  if (!t24) return null;
  return formatOrderTime12(t24);
}

/** @deprecated Use normalizeTime12 — kept for booking-specific imports. */
export const normalizeBookingTime = normalizeTime12;

/**
 * Half-hour grid 6:00 AM – 10:30 PM for default slots and fallback selects.
 * @returns {string[]}
 */
export function defaultHalfHourTimes12() {
  const out = [];
  for (let h = 6; h <= 22; h += 1) {
    out.push(formatOrderTime12(`${String(h).padStart(2, '0')}:00`));
    out.push(formatOrderTime12(`${String(h).padStart(2, '0')}:30`));
  }
  return out;
}

/** System fallback when no shop default delivery slot is configured. */
export const FALLBACK_DEFAULT_DELIVERY_TIME = '3:30 PM';

/** System fallback when no shop default return slot is configured. */
export const FALLBACK_DEFAULT_RETURN_TIME = '12:00 PM';

/**
 * Value for `<input type="datetime-local">` (YYYY-MM-DDTHH:mm).
 * @param {string|null|undefined} datePart YYYY-MM-DD
 * @param {string|null|undefined} timePart HH:MM
 * @returns {string}
 */
export function toDatetimeLocalValue(datePart, timePart) {
  const d = String(datePart ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const t = parseOrderTimeTo24(timePart) || '00:00';
  return `${d}T${t}`;
}

/**
 * @param {string|null|undefined} value datetime-local or date-only string
 * @returns {{ date: string, time: string|null }}
 */
export function splitDatetimeLocal(value) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})/);
  if (m) {
    return { date: m[1], time: normalizeOrderTime(m[2]) };
  }
  const dateOnly = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    return { date: dateOnly, time: null };
  }
  return { date: '', time: null };
}

/**
 * Current India date/time for datetime-local inputs.
 * @returns {string}
 */
export function nowDatetimeLocal() {
  const parts = getIndiaDateTimeParts(new Date());
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * ISO date (YYYY-MM-DD) for <input type="date"> in India calendar.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function toISODate(value) {
  const raw = String(value ?? '').trim();
  const wall = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (wall && (isTimezoneLessDateTimeString(raw) || /^\d{4}-\d{2}-\d{2}$/.test(raw))) {
    return wall[1];
  }
  const parts = getIndiaDateTimeParts(value);
  if (!parts) return '';
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Booking date + optional time for lists and detail views.
 * @param {string|null|undefined} bookingDate
 * @param {string|null|undefined} bookingTime
 * @returns {string}
 */
export function formatBookingDateTime(bookingDate, bookingTime) {
  const datePart = formatIsoDateDisplay(bookingDate) || formatDate(bookingDate);
  if (!datePart) return '';
  const timePart = formatOrderTime12(bookingTime);
  return timePart && timePart !== '—' ? `${datePart} ${timePart}` : datePart;
}

/**
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
/**
 * Display reminder date + optional time (DD-MM-YYYY h:mm AM/PM).
 * @param {string|null|undefined} dateValue
 * @param {string|null|undefined} timeValue
 * @returns {string}
 */
export function formatReminderDateTime(dateValue, timeValue) {
  const datePart = formatDate(dateValue);
  const timePart = timeValue ? formatOrderTime12(timeValue) : '';
  if (!datePart) return timePart || '—';
  if (!timePart || timePart === '—') return datePart;
  return `${datePart} ${timePart}`;
}

export function formatDate(value) {
  const fromIso = formatIsoDateDisplay(value);
  if (fromIso) return fromIso;
  const parts = getIndiaDateTimeParts(value);
  if (parts) return `${parts.day}-${parts.month}-${parts.year}`;
  return '';
}

/**
 * Parse MySQL / API datetime strings stored without timezone (IST wall clock).
 * @param {Date|string|number|null|undefined} value
 * @returns {{ year: string, month: string, day: string, hour: string, minute: string } | null}
 */
export function parseWallClockDateTimeParts(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return getIndiaDateTimeParts(value);
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return {
    year: m[1],
    month: m[2],
    day: m[3],
    hour: m[4] ?? '00',
    minute: m[5] ?? '00',
  };
}

function formatPartsDateTime(parts, { includeSeconds = false } = {}) {
  if (!parts) return '';
  const datePart = `${parts.day}-${parts.month}-${parts.year}`;
  const hasTime = includeSeconds
    ? !(parts.hour === '00' && parts.minute === '00' && (parts.second ?? '00') === '00')
    : !(parts.hour === '00' && parts.minute === '00');
  if (!hasTime && !includeSeconds) {
    const raw = `${parts.year}-${parts.month}-${parts.day}`;
    if (!String(raw).includes(':')) return datePart;
  }
  const timePart = formatOrderTime12(`${parts.hour}:${parts.minute}`);
  if (!timePart || timePart === '—') return datePart;
  if (includeSeconds && parts.second && parts.second !== '00') {
    return `${datePart} ${timePart}:${parts.second}`;
  }
  return `${datePart} ${timePart}`;
}

/**
 * Format user-entered / DATETIME wall-clock values (no UTC shift).
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function formatWallClockDateTime(value) {
  if (value == null || value === '') return '';
  return formatPartsDateTime(parseWallClockDateTimeParts(value));
}

/**
 * Format audit instants as DD-MM-YYYY h:mm AM/PM in India time.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function formatInstantDateTime(value) {
  if (value == null || value === '') return '';
  const instant = parseInstant(value);
  if (instant) {
    const parts = getIndiaDateTimeParts(instant);
    if (parts) return formatPartsDateTime(parts);
  }
  return formatIsoDateDisplay(value) || '';
}

/**
 * Format as DD-MM-YYYY h:mm AM/PM in India time (Asia/Kolkata).
 * Defaults to instant conversion for audit timestamps.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function formatDateTime(value) {
  return formatInstantDateTime(value);
}

/**
 * Audit / export rows: DD-MM-YYYY HH:mm:ss in India time.
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function formatAuditDateTime(value) {
  if (value == null || value === '') return '';
  const instant = parseInstant(value);
  const parts = instant ? getIndiaDateTimeParts(instant) : getIndiaDateTimeParts(value);
  if (!parts) return formatIsoDateDisplay(value) || '';
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second ?? '00'}`;
}

/**
 * MySQL DATE / driver values → YYYY-MM-DD without locale string bugs.
 * Avoid parsing strings like "Thu Jul 09" (which map to year 2001 in JS).
 * @param {Date|string|number|null|undefined} value
 * @returns {string}
 */
export function normalizeSqlDateToIso(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    const parts = getIndiaDateTimeParts(value);
    if (!parts) return '';
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  const raw = String(value).trim();
  const wall = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (wall) return wall[1];
  if (typeof value === 'number') return toISODate(value);
  return '';
}

/**
 * Format a payment row for transaction logs (India time).
 * Uses payment_date for the calendar day and created_at for record time.
 * @param {{ payment_date?: string|null, entry_date?: string|null, created_at?: string|null }|null|undefined} row
 * @returns {string}
 */
export function formatPaymentDateTime(row) {
  if (!row || typeof row !== 'object') return '';

  const businessIso =
    normalizeSqlDateToIso(row.payment_date) || normalizeSqlDateToIso(row.entry_date);
  const datePart = businessIso ? formatIsoDateDisplay(businessIso) : '';
  const instant = parseInstant(row.created_at);

  if (datePart && instant) {
    const parts = getIndiaDateTimeParts(instant);
    const timePart = parts ? formatOrderTime12(`${parts.hour}:${parts.minute}`) : '';
    if (timePart && timePart !== '—') return `${datePart} ${timePart}`;
    return datePart;
  }

  if (datePart) return datePart;
  return formatInstantDateTime(row.created_at) || '';
}

/**
 * India calendar date as YYYY-MM-DD. Use for MySQL DATE filters and “today” KPIs.
 * @param {Date|string|number|null|undefined} [value]
 * @returns {string}
 */
export function toLocalISODate(value = new Date()) {
  return toISODate(value);
}

/** Today as YYYY-MM-DD in India. */
export function todayIndiaISODate() {
  return toLocalISODate(new Date());
}

/**
 * @param {Date|string} from
 * @param {Date|string} to
 * @returns {number} Days between (integer, inclusive of start, exclusive of end).
 */
export function diffDays(from, to) {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
  return Math.round(ms / 86400000);
}

/**
 * @param {Date|string} date
 * @param {number} days
 * @returns {Date|null}
 */
export function addDays(date, days) {
  const d = toDate(date);
  if (!d) return null;
  const copy = new Date(d);
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
}

/**
 * Convenience: today at 00:00.
 * @returns {Date}
 */
export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
