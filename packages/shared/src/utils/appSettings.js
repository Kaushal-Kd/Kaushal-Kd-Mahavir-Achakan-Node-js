import { APP_SETTINGS_BY_KEY } from '../constants/appSettingsRegistry.js';

const YES_VALUES = new Set(['yes', '1', 'true', 'y']);

export function parseYesNo(value, defaultValue = 'No') {
  const raw = value != null && String(value).trim() !== '' ? String(value) : defaultValue;
  return YES_VALUES.has(String(raw).trim().toLowerCase());
}

export function formatYesNo(bool) {
  return bool ? 'Yes' : 'No';
}

export function parsePipeNumbers(value, defaultValue = '') {
  const raw = value != null && String(value).trim() !== '' ? String(value) : defaultValue;
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    });
}

export function formatPipeNumbers(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return '';
  return numbers.map((n) => String(Math.max(0, Number(n) || 0))).join('|');
}

const MARGIN_KEYS = ['TopMargin', 'BottomMargin', 'LeftMargin', 'RightMargin'];

export function parseInvoiceMargin(value, defaultValue) {
  let parsed = null;
  if (value != null && String(value).trim() !== '') {
    try {
      const obj = typeof value === 'string' ? JSON.parse(value) : value;
      if (obj && typeof obj === 'object') parsed = obj;
    } catch {
      const legacy = String(value).replace(/^\{|\}$/g, '');
      if (legacy.includes('TopMargin')) {
        try {
          parsed = JSON.parse(
            `{${legacy.replace(/(\w+):/g, '"$1":').replace(/'/g, '"')}}`
          );
        } catch {
          parsed = null;
        }
      }
    }
  }
  const base = defaultValue
    ? parseInvoiceMargin(defaultValue, null)
    : { TopMargin: '0', BottomMargin: '0', LeftMargin: '0', RightMargin: '0' };
  const out = { ...base };
  for (const k of MARGIN_KEYS) {
    if (parsed && parsed[k] != null) out[k] = String(parsed[k]);
  }
  return out;
}

export function formatInvoiceMargin(margin) {
  const normalized = parseInvoiceMargin(margin, null);
  return JSON.stringify(normalized);
}

export function getAppSettingDefinition(key) {
  return APP_SETTINGS_BY_KEY[key] || null;
}

export function getAppSettingValue(storedMap, key) {
  const def = getAppSettingDefinition(key);
  if (!def) return null;
  const row = storedMap?.[key];
  if (row != null && String(row).trim() !== '') return String(row);
  return def.defaultValue;
}

export function buildAppSettingsMap(items) {
  const map = {};
  for (const row of items || []) {
    if (row?.key) map[row.key] = row.value;
  }
  return map;
}

export function getGstFromPercentage(storedMap) {
  const raw = getAppSettingValue(storedMap, 'GST_PERCENTAGE');
  const parts = parsePipeNumbers(raw, '0|0');
  const cgst = parts[0] ?? 0;
  const sgst = parts[1] ?? parts[0] ?? 0;
  const enabled = cgst > 0 || sgst > 0;
  const defaultRate = enabled ? Math.max(cgst, sgst) : 0;
  return { enabled, default_rate: defaultRate, cgst, sgst };
}

export function getNumberSetting(storedMap, key, fallback = 0) {
  const raw = getAppSettingValue(storedMap, key);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

export function validateAppSettingValue(key, value) {
  const def = getAppSettingDefinition(key);
  if (!def) return { ok: false, error: `Unknown setting key: ${key}` };
  const str = value == null ? '' : String(value);
  switch (def.type) {
    case 'yes_no': {
      const v = str.trim().toLowerCase();
      if (v !== 'yes' && v !== 'no') return { ok: false, error: 'Value must be Yes or No' };
      return { ok: true, value: v === 'yes' ? 'Yes' : 'No' };
    }
    case 'number': {
      const n = Number(str);
      if (!Number.isFinite(n) || n < 0 || n > 9999) {
        return { ok: false, error: 'Value must be a number between 0 and 9999' };
      }
      return { ok: true, value: String(Math.floor(n)) };
    }
    case 'text':
    case 'html':
      return { ok: true, value: str };
    case 'time': {
      const time = str.trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return { ok: false, error: 'Time must use 24-hour HH:mm format' };
      }
      return { ok: true, value: time };
    }
    case 'pipe_numbers': {
      const parts = parsePipeNumbers(str, '');
      if (parts.length === 0) return { ok: false, error: 'Use pipe-separated numbers (e.g. 0|0)' };
      for (const p of parts) {
        if (p < 0 || p > 100) return { ok: false, error: 'Each segment must be 0–100' };
      }
      return { ok: true, value: formatPipeNumbers(parts) };
    }
    case 'json_margin': {
      try {
        return { ok: true, value: formatInvoiceMargin(str) };
      } catch {
        return { ok: false, error: 'Invalid margin JSON' };
      }
    }
    case 'select': {
      const allowed = new Set((def.options || []).map((o) => o.value));
      if (!allowed.has(str.trim())) return { ok: false, error: 'Invalid option' };
      return { ok: true, value: str.trim() };
    }
    default:
      return { ok: false, error: 'Unknown setting type' };
  }
}
