import { pdfSafeText } from './pdfSafeText.js';

/**
 * @typedef {{ text: string, bold?: boolean }} PdfTextSegment
 * @typedef {{ segments: PdfTextSegment[] }} PdfRichLine
 */

const FONT_SIZE = 8;
const LINE_H_PER_PT = 0.45;

/**
 * Draw mixed bold/normal lines inside an autoTable cell (clears default text first).
 *
 * @param {import('jspdf').jsPDF} doc
 * @param {{ x: number, y: number, width: number, height: number }} cell
 * @param {PdfRichLine[]} lines
 */
/** Line height (mm) used when drawing rich lines at a font size. */
export function pdfRichLineHeight(fontSize = FONT_SIZE) {
  return (Number(fontSize) > 0 ? Number(fontSize) : FONT_SIZE) * LINE_H_PER_PT;
}

/**
 * Number of printed lines the rich lines take once wrapped to `innerWidth` (mm).
 * Measured in bold so the estimate never comes out short.
 */
export function countPdfRichWrappedLines(doc, lines, innerWidth, fontSize = FONT_SIZE) {
  const list = Array.isArray(lines) ? lines : [];
  if (!(innerWidth > 0)) return list.length;
  doc.setFontSize(Number(fontSize) > 0 ? Number(fontSize) : FONT_SIZE);
  doc.setFont('helvetica', 'bold');
  let count = 0;
  for (const line of list) {
    if (line?.rule) {
      count += 1;
      continue;
    }
    const text = pdfSafeText(
      (Array.isArray(line?.segments) ? line.segments : []).map((seg) => seg.text || '').join('')
    );
    count += Math.max(1, doc.splitTextToSize(text, innerWidth).length);
  }
  doc.setFont('helvetica', 'normal');
  return count;
}

export function drawPdfRichLinesInCell(doc, cell, lines, opts = {}) {
  const fontSize = Number(opts.fontSize) > 0 ? Number(opts.fontSize) : FONT_SIZE;
  const LINE_H = fontSize * LINE_H_PER_PT;
  const pad = 2;
  const maxX = cell.x + cell.width - pad;
  let x = cell.x + pad;
  let y = cell.y + pad + LINE_H;
  const list = Array.isArray(lines) ? lines : [];

  doc.setFontSize(fontSize);
  doc.setTextColor(0, 0, 0);

  for (let li = 0; li < list.length; li += 1) {
    if (li > 0) {
      x = cell.x + pad;
      y += LINE_H;
    }
    if (list[li]?.rule) {
      if (y > cell.y + cell.height - pad) return;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.25);
      doc.line(cell.x + pad, y - 1.2, cell.x + cell.width - pad, y - 1.2);
      continue;
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
