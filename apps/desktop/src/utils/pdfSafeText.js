/** Strip symbols/fonts that break jsPDF built-in fonts (e.g. ₹ → spacing glitches). */
export function pdfSafeText(value) {
  return String(value ?? '')
    .replace(/\u20B9/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}
