import { isPdfAttachmentUrl } from '../services/uploadAttachment.js';
import { buildTablePdfDoc, pdfSafeText } from './tablePdf.js';

export function normalizePurchaseAttachmentUrls(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read attachment'));
    reader.readAsDataURL(blob);
  });
}

function addAttachmentHeader(doc, purchase, attachmentNumber, total) {
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(pdfSafeText(`Purchase ${purchase.purchase_number || purchase.bill_no || ''}`), 10, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Attachment ${attachmentNumber} of ${total}`, 10, 18);
}

async function appendImagePage(doc, purchase, url, attachmentNumber, total, fetchImpl) {
  doc.addPage('a4', 'portrait');
  addAttachmentHeader(doc, purchase, attachmentNumber, total);
  try {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dataUrl = await blobToDataUrl(await response.blob());
    const props = doc.getImageProperties(dataUrl);
    const maxWidth = 190;
    const maxHeight = 260;
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height);
    const width = props.width * ratio;
    const height = props.height * ratio;
    doc.addImage(dataUrl, props.fileType || 'JPEG', (210 - width) / 2, 24, width, height);
  } catch {
    doc.setFontSize(9);
    doc.text('Image could not be embedded. Open the source attachment:', 10, 28);
    doc.textWithLink(pdfSafeText(url).slice(0, 150), 10, 34, { url });
  }
}

function appendPdfLinkPage(doc, purchase, url, attachmentNumber, total) {
  doc.addPage('a4', 'portrait');
  addAttachmentHeader(doc, purchase, attachmentNumber, total);
  doc.setFontSize(10);
  doc.text('Uploaded PDF attachment:', 10, 30);
  doc.setTextColor(12, 110, 225);
  doc.textWithLink('Open attached purchase PDF', 10, 38, { url });
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(pdfSafeText(url), 190), 10, 46);
}

export async function buildPurchaseCombinedPdfDoc(columns, purchases, options = {}) {
  const rows = Array.isArray(purchases) ? purchases : [];
  const doc = buildTablePdfDoc(columns, rows, options);
  const fetchImpl = options.fetchImpl || fetch;

  for (const purchase of rows) {
    const urls = normalizePurchaseAttachmentUrls(purchase.image_urls);
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      if (isPdfAttachmentUrl(url)) {
        appendPdfLinkPage(doc, purchase, url, index + 1, urls.length);
      } else {
        await appendImagePage(doc, purchase, url, index + 1, urls.length, fetchImpl);
      }
    }
  }

  return doc;
}
