import { formatDate } from '@wrs/shared';
import { jsPDF } from 'jspdf';

import { isPdfAttachmentUrl } from '../services/uploadAttachment.js';
import { flattenPurchaseAttachments } from './purchaseAttachments.js';
import { appendTableToPdfDoc, buildTablePdfDoc, pdfSafeText } from './tablePdf.js';

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

function fallbackAttachmentHeader(doc, purchase, attachmentNumber, total) {
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const bill = pdfSafeText(purchase?.purchase_number || purchase?.bill_no || 'Purchase');
  const dateText = purchaseDateLabel(purchase);
  doc.text(dateText ? `${bill} · ${dateText}` : bill, 10, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Attachment ${attachmentNumber} of ${total}`, 10, 18);
  return 24;
}

function drawPurchaseRowTable(doc, columns, purchase, attachmentNumber, total) {
  const hasColumns = Array.isArray(columns) && columns.length > 0 && purchase;
  if (!hasColumns) {
    return fallbackAttachmentHeader(doc, purchase, attachmentNumber, total);
  }
  const y = appendTableToPdfDoc(doc, columns, [purchase], { startY: 10, margin: 10 });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Attachment ${attachmentNumber} of ${total}`, 10, y + 6);
  return y + 10;
}

function pageContentBox(doc, topY) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  return {
    x: margin,
    y: topY,
    width: pageW - margin * 2,
    height: Math.max(40, pageH - topY - margin),
  };
}

async function appendImagePage(doc, purchase, url, attachmentNumber, total, fetchImpl, columns) {
  doc.addPage();
  const topY = drawPurchaseRowTable(doc, columns, purchase, attachmentNumber, total);
  const box = pageContentBox(doc, topY);
  try {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dataUrl = await blobToDataUrl(await response.blob());
    const props = doc.getImageProperties(dataUrl);
    const ratio = Math.min(box.width / props.width, box.height / props.height);
    const width = props.width * ratio;
    const height = props.height * ratio;
    doc.addImage(
      dataUrl,
      props.fileType || 'JPEG',
      box.x + (box.width - width) / 2,
      box.y,
      width,
      height
    );
  } catch {
    doc.setFontSize(9);
    doc.text('Image could not be embedded. Open the source attachment:', box.x, box.y + 4);
    doc.textWithLink(pdfSafeText(url).slice(0, 150), box.x, box.y + 10, { url });
  }
}

function appendPdfLinkPage(doc, purchase, url, attachmentNumber, total, columns) {
  doc.addPage();
  const topY = drawPurchaseRowTable(doc, columns, purchase, attachmentNumber, total);
  doc.setFontSize(10);
  doc.text('Uploaded PDF attachment:', 10, topY + 6);
  doc.setTextColor(12, 110, 225);
  doc.textWithLink('Open attached purchase PDF', 10, topY + 14, { url });
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(pdfSafeText(url), 190), 10, topY + 22);
}

async function appendAttachmentPages(doc, items, fetchImpl, columns) {
  const list = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const purchase = item.purchase || {};
    if (isPdfAttachmentUrl(item.url)) {
      appendPdfLinkPage(doc, purchase, item.url, index + 1, list.length, columns);
    } else {
      await appendImagePage(doc, purchase, item.url, index + 1, list.length, fetchImpl, columns);
    }
  }
}

export async function buildSelectedPurchaseImagesPdfDoc(items, options = {}) {
  const list = Array.isArray(items) ? items.filter((item) => item?.url) : [];
  if (!list.length) {
    throw new Error('Select at least one image');
  }

  const columns = Array.isArray(options.columns) ? options.columns : [];
  const doc = columns.length
    ? new jsPDF({
        orientation: columns.length > 7 ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4',
      })
    : new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
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

  await appendAttachmentPages(doc, list, options.fetchImpl || fetch, columns);
  return doc;
}

export async function buildPurchaseCombinedPdfDoc(columns, purchases, options = {}) {
  const rows = Array.isArray(purchases) ? purchases : [];
  const doc = buildTablePdfDoc(columns, rows, options);
  const selectedKeys = options.selectedKeys instanceof Set ? options.selectedKeys : null;
  const items = flattenPurchaseAttachments(rows).filter((item) =>
    selectedKeys ? selectedKeys.has(item.key) : true
  );
  await appendAttachmentPages(doc, items, options.fetchImpl || fetch, columns);
  return doc;
}
