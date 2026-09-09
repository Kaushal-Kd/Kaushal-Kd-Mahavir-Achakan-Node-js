import JsBarcode from 'jsbarcode';

const DEFAULT_FORMAT = 'CODE128';

/**
 * Render a scannable barcode as a PNG data URL for jsPDF addImage.
 *
 * @param {string} value — usually product code
 * @param {{ format?: string, width?: number, height?: number }} [opts]
 * @returns {Promise<{ dataUrl: string, widthPx: number, heightPx: number } | null>}
 */
export function barcodeToDataUrl(value, opts = {}) {
  const code = String(value ?? '').trim();
  if (!code) return Promise.resolve(null);

  const format = opts.format || DEFAULT_FORMAT;
  const barWidth = opts.width ?? 2;
  const barHeight = opts.height ?? 40;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, code, {
      format,
      width: barWidth,
      height: barHeight,
      fontSize: 10,
      displayValue: true,
      margin: 2,
    });
  } catch {
    return Promise.resolve(null);
  }

  const svgString = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width === 0 || canvas.height === 0) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        widthPx: canvas.width,
        heightPx: canvas.height,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
