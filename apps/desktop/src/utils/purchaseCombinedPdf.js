import { formatDate } from '@wrs/shared';
import { jsPDF } from 'jspdf';

import { isPdfAttachmentUrl } from '../services/uploadAttachment.js';
import { flattenPurchaseAttachments } from './purchaseAttachments.js';
import { buildTablePdfDoc, pdfSafeText } from './tablePdf.js';

export { flattenPurchaseAttachments, normalizePurchaseAttachmentUrls } from './purchaseAttachments.js';

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read attachment'));
    reader.readAsDataURL(blob);
  });
}

function purchaseDateLabel(purchase) {
  return formatDate(purchase?.purchase_date) || String(purchase?.purchase_date || '').slice(0, 10);
}

function addAttachmentHeader(doc, purchase, attachmentNumber, total) {
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const bill = pdfSafeText(purchase?.purchase_number || purchase?.bill_no || 'Purchase');
  const dateText = purchaseDateLabel(purchase);
  doc.text(dateText ? `${bill} · ${dateText}` : bill, 10, 12);
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

async function appendAttachmentPages(doc, items, fetchImpl) {
  const list = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const purchase = item.purchase || {};
    if (isPdfAttachmentUrl(item.url)) {
      appendPdfLinkPage(doc, purchase, item.url, index + 1, list.length);
    } else {
      await appendImagePage(doc, purchase, item.url, index + 1, list.length, fetchImpl);
    }
  }
}

export async function buildSelectedPurchaseImagesPdfDoc(items, options = {}) {
  const list = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  if (!list.length) {
    throw new Error('Select at least one image');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(pdfSafeText(options.title || 'Purchase images'), 10, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let y = 24;
  if (options.subtitle) {
    doc.text(pdfSafeText(options.subtitle), 10, y);
    y += 7;
  }
  doc.text(`${list.length} attachment(s)`, 10, y);

  await appendAttachmentPages(doc, list, options.fetchImpl || fetch);
  return doc;
}

export async function buildPurchaseCombinedPdfDoc(columns, purchases, options = {}) {
  const rows = Array.isArray(purchases) ? purchases : [];
  const doc = buildTablePdfDoc(columns, rows, options);
  const selectedKeys = options.selectedKeys instanceof Set ? options.selectedKeys : null;
  const items = flattenPurchaseAttachments(rows).filter((item) =>
    selectedKeys ? selectedKeys.has(item.key) : true
  );
  await appendAttachmentPages(doc, items, options.fetchImpl || fetch);
  return doc;
}
