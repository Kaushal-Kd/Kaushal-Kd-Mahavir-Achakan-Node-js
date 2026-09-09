/** Contact-input truncation is unsafe when selecting an actual message recipient. */
export function normalizeWhatsAppRecipient(value) {
  const raw = String(value ?? '').trim();
  if (!raw || !/^\+?[\d\s()-]+$/.test(raw)) return '';
  let digits = raw.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (/^91\d{10}$/.test(digits)) digits = digits.slice(2);
  else if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
  return /^\d{10}$/.test(digits) ? digits : '';
}
