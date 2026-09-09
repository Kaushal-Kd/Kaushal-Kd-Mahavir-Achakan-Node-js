const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const amount = (value) => `INR ${Number(value || 0).toFixed(2)}`;
const taxLabel = (invoice, line) =>
  invoice.tax_mode === 'igst'
    ? `IGST ${line.tax_rate}%`
    : `CGST ${line.tax_rate / 2}% + SGST ${line.tax_rate / 2}%`;

export function issuedGstDocumentRows(invoice) {
  if (!invoice?.id || !invoice.invoice_number || !invoice.invoice_date)
    throw new Error('Only a server-issued GST invoice can be printed');
  return invoice.lines
    .filter((line) => line.gst_gross > 0)
    .map((line) => [
      line.description,
      line.hsn_sac,
      String(line.qty),
      amount(line.taxable_value),
      taxLabel(invoice, line),
      amount(line.tax_total),
      amount(line.gst_gross),
    ]);
}

export function buildIssuedGstHtml(invoice) {
  const rows = issuedGstDocumentRows(invoice);
  const labels = [
    'Description / GST component',
    'HSN / SAC',
    'Qty',
    'Taxable value',
    'Tax rate',
    'Tax',
    'Total',
  ];
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(invoice.invoice_number)}</title><style>
    @page{size:A4;margin:12mm}body{font:12px Arial,sans-serif;color:#111;background:white;margin:0}h1{font-size:21px;color:#0C6EE1;margin:0 0 8px}h2{font-size:16px;margin:8px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:11px;table-layout:fixed}th,td{border:1px solid #ddd;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#f3f4f6}thead{display:table-header-group}tr{break-inside:avoid}th:first-child{width:26%}.totals{break-inside:avoid;margin-left:auto;width:65%}.muted{color:#555}.sign{margin-top:30px;break-inside:avoid}</style></head><body><main class="bill-document">
    <h1>GST Tax Invoice</h1><h2>${escape(invoice.supplier.name)}</h2><p>${escape(invoice.supplier.address)}<br>GSTIN: ${escape(invoice.supplier.gstin)}</p>
    <p><strong>Invoice: ${escape(invoice.invoice_number)}</strong><br>Issued: ${escape(invoice.invoice_date)}<br>Original ${invoice.source_type === 'sale' ? 'sale' : 'booking'}: ${escape(invoice.source_number)}</p>
    <h2>Bill to: ${escape(invoice.customer_name)}</h2><p>${escape(invoice.customer_address)}<br>GSTIN: ${escape(invoice.recipient_gstin || 'Unregistered')}<br>Place of supply (state code): ${escape(invoice.place_of_supply)}<br>Reverse charge: No</p>
    <table><thead><tr>${labels.map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <table class="totals"><tbody>${[
      ['Taxable value', invoice.taxable_value],
      ['CGST', invoice.cgst],
      ['SGST', invoice.sgst],
      ['IGST', invoice.igst],
      ['Invoice total (GST included)', invoice.grand_total],
    ]
      .map(([label, value]) => `<tr><td>${label}</td><td>${amount(value)}</td></tr>`)
      .join('')}</tbody></table>
    <p class="muted">Allocation: ${escape(invoice.percentage)}% of original ${amount(invoice.total_amount)}. Non-GST components of ${amount(invoice.non_gst_amount)} remain recorded on the original bill. Source quantities identify the original items; this invoice covers the reviewed GST components above. Payments are recorded against the original bill.</p>
    <p class="sign">For ${escape(invoice.supplier.name)}<br><br>Authorized signatory</p></main></body></html>`;
}

export async function buildIssuedGstPdf(invoice) {
  const rows = issuedGstDocumentRows(invoice);
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const doc = new jsPDF();
  const theme = {
    fontSize: 9,
    cellPadding: 2.4,
    overflow: 'linebreak',
    lineColor: [220, 220, 220],
    lineWidth: 0.1,
  };
  doc.setFontSize(18);
  doc.setTextColor(12, 110, 225);
  doc.text('GST Tax Invoice', 14, 17);
  doc.setTextColor(20);
  autoTable(doc, {
    startY: 23,
    theme: 'plain',
    styles: theme,
    body: [
      [
        'Supplier',
        `${invoice.supplier.name}\n${invoice.supplier.address}\nGSTIN: ${invoice.supplier.gstin}`,
      ],
      [
        'Invoice',
        `${invoice.invoice_number}\nIssued: ${invoice.invoice_date}\nOriginal ${invoice.source_type}: ${invoice.source_number}`,
      ],
      [
        'Bill to',
        `${invoice.customer_name}\n${invoice.customer_address}\nGSTIN: ${invoice.recipient_gstin || 'Unregistered'}\nPlace of supply (state code): ${invoice.place_of_supply}\nReverse charge: No`,
      ],
    ],
    columnStyles: { 0: { cellWidth: 30 } },
  });
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 5,
    theme: 'grid',
    rowPageBreak: 'avoid',
    styles: { ...theme, fontSize: 8 },
    headStyles: { fillColor: [12, 110, 225] },
    head: [
      ['Description / GST component', 'HSN/SAC', 'Qty', 'Taxable', 'Tax rate', 'Tax', 'Total'],
    ],
    body: rows,
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 18 },
      2: { cellWidth: 13 },
      4: { cellWidth: 27 },
    },
  });
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 5,
    theme: 'plain',
    rowPageBreak: 'avoid',
    styles: theme,
    body: [
      ['Taxable value', amount(invoice.taxable_value)],
      ['CGST', amount(invoice.cgst)],
      ['SGST', amount(invoice.sgst)],
      ['IGST', amount(invoice.igst)],
      ['Invoice total (GST included)', amount(invoice.grand_total)],
      [
        'Allocation',
        `${invoice.percentage}% of original ${amount(invoice.total_amount)}. Non-GST components: ${amount(invoice.non_gst_amount)}, recorded on the original bill.`,
      ],
      [
        'Reference',
        'Source quantities identify original items. This invoice covers the reviewed GST components. Payments remain recorded against the original bill.',
      ],
      ['Authorized signatory', `For ${invoice.supplier.name}`],
    ],
    columnStyles: { 0: { cellWidth: 55 } },
  });
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.text(`${invoice.invoice_number} | Page ${page} of ${total}`, 14, 290);
  }
  return doc;
}

export async function downloadIssuedGstPdf(invoice) {
  if (
    Array.from(
      [
        invoice.supplier.name,
        invoice.supplier.address,
        invoice.customer_name,
        invoice.customer_address,
        ...invoice.lines.map((line) => line.description),
      ].join('')
    ).some((character) => character.codePointAt(0) > 127)
  ) {
    const { downloadHtmlAsPdf } = await import('../utils/billPdf.js');
    await downloadHtmlAsPdf(
      buildIssuedGstHtml(invoice),
      `${invoice.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`,
      'A4'
    );
    return;
  }
  const doc = await buildIssuedGstPdf(invoice);
  doc.save(`${invoice.invoice_number.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`);
}

export async function printIssuedGstInvoice(invoice) {
  const { renderAndPrint } = await import('../utils/printBill.js');
  renderAndPrint(buildIssuedGstHtml(invoice), { title: invoice.invoice_number });
}
