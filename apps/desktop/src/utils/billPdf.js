import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const PAPER_SPECS = {
  A4: { format: 'a4', iframeWidthPx: 794 },
  A5: { format: 'a5', iframeWidthPx: 559 },
  thermal_80: { format: [80, 297], iframeWidthPx: 302 },
  thermal_58: { format: [58, 297], iframeWidthPx: 219 },
};

/** Side margins on the PDF page (mm) — keeps content off the sheet edge. */
const PDF_MARGIN_MM = 8;

function waitForBillDocument(iframe) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      setTimeout(resolve, 500);
    };
    iframe.addEventListener('load', done, { once: true });
    setTimeout(done, 1000);
  });
}

async function renderHtmlToPdfDoc(html, paperSize = 'A4', options = {}) {
  const spec = PAPER_SPECS[paperSize] || PAPER_SPECS.A4;
  const rootSelector = options.rootSelector || '.bill-document';

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${spec.iframeWidthPx}px;min-height:1123px;border:0;visibility:hidden;background:#fff`;
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error('Could not prepare invoice for PDF export');
  }

  doc.open();
  doc.write(html);
  doc.close();
  await waitForBillDocument(iframe);

  const root = doc.querySelector(rootSelector) || doc.querySelector('.bill-document') || doc.body;
  const canvas = await html2canvas(root, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: spec.iframeWidthPx,
    width: root.scrollWidth,
    height: root.scrollHeight,
  });

  const pdf = new jsPDF({ unit: 'mm', format: spec.format, orientation: 'portrait' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = PDF_MARGIN_MM;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const imgWidth = contentWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL('image/png');

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', margin, margin + position, imgWidth, imgHeight, undefined, 'FAST');
  heightLeft -= contentHeight;

  while (heightLeft > 0) {
    pdf.addPage(spec.format, 'portrait');
    position = heightLeft - imgHeight;
    pdf.addImage(imgData, 'PNG', margin, margin + position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= contentHeight;
  }

  document.body.removeChild(iframe);
  return { pdf, paperSize: spec.format };
}

/**
 * Render bill HTML to a PDF Blob (for WhatsApp attachment).
 * @param {string} html
 * @param {string} [paperSize]
 * @returns {Promise<Blob>}
 */
export async function htmlToPdfBlob(html, paperSize = 'A4', options = {}) {
  const { pdf } = await renderHtmlToPdfDoc(html, paperSize, options);
  return pdf.output('blob');
}

/**
 * Render self-contained bill HTML in a hidden iframe and save as PDF file download.
 */
export async function downloadHtmlAsPdf(html, filename, paperSize = 'A4') {
  const spec = PAPER_SPECS[paperSize] || PAPER_SPECS.A4;
  const safeName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  const { pdf } = await renderHtmlToPdfDoc(html, paperSize);
  pdf.save(safeName);
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read PDF'));
    reader.readAsDataURL(blob);
  });
}
