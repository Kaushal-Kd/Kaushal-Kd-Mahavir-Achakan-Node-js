import { pdfSafeText } from './tablePdf.js';

/**
 * @typedef {{ text: string, bold?: boolean }} PdfTextSegment
 * @typedef {{ segments: PdfTextSegment[] }} PdfRichLine
 */

const FONT_SIZE = 8;
const LINE_H = 3.6;

/**
 * Draw mixed bold/normal lines inside an autoTable cell (clears default text first).
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number, width: number, height: number }} cell
 * @param {PdfRichLine[]} lines
 */
export function drawPdfRichLinesInCell(doc, cell, lines) {
  const pad = 2;
  const maxX = cell.x + cell.width - pad;
  let x = cell.x + pad;
  let y = cell.y + pad + LINE_H;
  const list = Array.isArray(lines) ? lines : [];

  doc.setFontSize(FONT_SIZE);
  doc.setTextColor(0, 0, 0);

  for (let li = 0; li < list.length; li += 1) {
    if (li > 0) {
      x = cell.x + pad;
      y += LINE_H;
    }
    const segments = Array.isArray(list[li]?.segments) ? list[li].segments : [];
    for (const seg of segments) {
      const text = pdfSafeText(seg.text);
      if (!text) continue;
      doc.setFont('helvetica', seg.bold ? 'bold' : 'normal');
      const chunks = text.split(/(\s+)/).filter((c) => c.length > 0);
      for (const chunk of chunks) {
        const w = doc.getTextWidth(chunk);
        if (x + w > maxX && x > cell.x + pad) {
          x = cell.x + pad;
          y += LINE_H;
        }
        if (y > cell.y + cell.height - pad) return;
        doc.text(chunk, x, y);
        x += w;
      }
    }
  }
}
