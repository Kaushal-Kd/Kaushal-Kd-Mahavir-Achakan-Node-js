import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { buildWhatsAppTransactionRows } from './whatsappTransactionRows.js';

function orderParty(order) {
  return order?.customer?.name || order?.customer_name || order?.pickup_name || 'Customer';
}

function pdfDocument(order, kind, options) {
  const isMissing = kind === 'missing';
  const title = isMissing ? 'Return — Missing Items' : 'Delivery Product List';
  const lines = buildWhatsAppTransactionRows(order, kind, options);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setFontSize(16);
  doc.text(title, 14, 16);
  doc.setFontSize(10);
  doc.text(`Bill: ${order?.order_number || order?.bill_no || '—'}`, 14, 24);
  doc.text(`Customer: ${orderParty(order)}`, 14, 30);
  if (order?.contact_address || order?.customer?.address) {
    doc.text(`Address: ${order.contact_address || order.customer.address}`, 14, 36, { maxWidth: 180 });
  }
  autoTable(doc, {
    startY: order?.contact_address || order?.customer?.address ? 43 : 36,
    head: [
      isMissing
        ? ['Code', 'Category', 'Product / Accessory', 'Qty', 'Status', 'Charge']
        : ['Code', 'Category', 'Product / Accessory', 'Qty', 'Issue Type'],
    ],
    body: lines.map((row) => [
      row.code,
      row.category,
      row.name,
      String(row.qty),
      isMissing ? row.status : row.type,
      ...(isMissing ? [`INR ${row.charge.toFixed(2)}`] : []),
    ]),
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [12, 110, 225] },
  });
  return doc;
}

export function buildWhatsAppTransactionPdf(order, kind = 'delivery', options = {}) {
  const doc = pdfDocument(order, kind, options);
  const prefix = kind === 'missing' ? 'missing-items' : 'delivery-items';
  return {
    filename: `${prefix}-${order?.order_number || 'bill'}.pdf`,
    content_base64: doc.output('datauristring').split(',')[1],
    mimetype: 'application/pdf',
  };
}
