import {
  WHATSAPP_MESSAGE_BY_KEY,
  WHATSAPP_MESSAGE_REGISTRY,
  whatsappMessageSettingKey,
} from '../constants/whatsappMessageRegistry.js';
import { formatYesNo, parseYesNo } from './appSettings.js';

const BILL_PDF_TOKEN_RE = /\{BILL_PDF\}/i;
const LEGACY_BILL_URL_TOKEN_RE = /\{BILL_URL\}/gi;

/** Strip removed legacy token from stored templates. */
export function normalizeWhatsAppTemplateMessage(message) {
  return String(message ?? '')
    .replace(LEGACY_BILL_URL_TOKEN_RE, '{BILL_PDF}')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** @param {string} [message] */
export function messageIncludesBillPdfToken(message) {
  return BILL_PDF_TOKEN_RE.test(String(message ?? ''));
}

/**
 * @param {{ message?: string, attach_bill_pdf?: boolean, order_id?: string|null }} opts
 */
export function shouldAttachBillPdf(opts = {}) {
  const orderId = opts.order_id;
  if (!orderId) return false;
  if (opts.attach_bill_pdf) return true;
  return messageIncludesBillPdfToken(opts.message);
}

export function parseWhatsAppTemplateValue(raw) {
  let obj = raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== 'object') {
    return { is_active: true, message: '', attach_bill_pdf: false };
  }
  return {
    is_active: parseYesNo(obj.is_active, obj.is_active === false ? 'No' : 'Yes'),
    message: normalizeWhatsAppTemplateMessage(obj.message),
    attach_bill_pdf: parseYesNo(obj.attach_bill_pdf, 'No'),
  };
}

export function formatWhatsAppTemplateValue({ is_active, message, attach_bill_pdf }) {
  return JSON.stringify({
    is_active: formatYesNo(!!is_active),
    message: normalizeWhatsAppTemplateMessage(message),
    attach_bill_pdf: formatYesNo(!!attach_bill_pdf),
  });
}

export function getWhatsAppTemplateDefinition(key) {
  return WHATSAPP_MESSAGE_BY_KEY[key] || null;
}

function defaultAttachBillPdfForKey(key) {
  const def = WHATSAPP_MESSAGE_BY_KEY[key];
  return parseYesNo(def?.defaultAttachBillPdf, 'No');
}

export function buildWhatsAppTemplatesFromStored(storedBySettingKey) {
  return WHATSAPP_MESSAGE_REGISTRY.map((def) => {
    const settingKey = whatsappMessageSettingKey(def.key);
    const raw = storedBySettingKey?.[settingKey];
    const parsed = raw != null ? parseWhatsAppTemplateValue(raw) : null;
    const attachDefault = defaultAttachBillPdfForKey(def.key);
    return {
      key: def.key,
      name: def.name,
      is_active: parsed ? parsed.is_active : parseYesNo(def.defaultActive, 'Yes'),
      message: parsed && parsed.message !== '' ? parsed.message : def.defaultMessage,
      attach_bill_pdf: parsed
        ? parsed.attach_bill_pdf
        : attachDefault || messageIncludesBillPdfToken(def.defaultMessage),
    };
  });
}

export function defaultWhatsAppTemplatePayload(def) {
  const attachDefault =
    parseYesNo(def.defaultAttachBillPdf, 'No') || messageIncludesBillPdfToken(def.defaultMessage);
  return formatWhatsAppTemplateValue({
    is_active: parseYesNo(def.defaultActive, 'Yes'),
    message: def.defaultMessage,
    attach_bill_pdf: attachDefault,
  });
}
