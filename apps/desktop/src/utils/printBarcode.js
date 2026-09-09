import JsBarcode from 'jsbarcode';

/**
 * Open a print-ready window with N barcode labels for the given product.
 *
 * Each label is a small self-contained card with the product name, the
 * barcode (CODE128) and the human-readable value underneath. The layout
 * uses flex-wrap so any label-stock size will tile nicely.
 *
 * @param {object} opts
 * @param {string} opts.value      Barcode value (usually the product code).
 * @param {string} [opts.name]     Product name to show above the barcode.
 * @param {number} [opts.count]    How many labels to print (default 1).
 * @param {string} [opts.format]   JsBarcode format (default CODE128).
 */
export function printBarcodeLabels({ value, name = '', count = 1, format = 'CODE128' }) {
  if (!value) {
    throw new Error('A barcode value is required to print.');
  }
  const labels = Math.max(1, Math.floor(count) || 1);

  // Render the barcode once as an SVG string, then reuse the markup for every label.
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(tmp, String(value), {
    format,
    width: 2,
    height: 60,
    fontSize: 14,
    displayValue: true,
    margin: 4,
  });
  const svgMarkup = new XMLSerializer().serializeToString(tmp);

  const labelHtml = `
    <div class="label">
      ${name ? `<div class="label-name">${escapeHtml(name)}</div>` : ''}
      <div class="label-barcode">${svgMarkup}</div>
    </div>
  `;

  const doc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Print barcode — ${escapeHtml(value)}</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      body { padding: 10mm; }
      .sheet { display: flex; flex-wrap: wrap; gap: 6mm; }
      .label {
        border: 1px dashed #cfcfcf;
        padding: 4mm 4mm 3mm;
        min-width: 50mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        page-break-inside: avoid;
      }
      .label-name {
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 3px;
        max-width: 55mm;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label-barcode svg { display: block; }
      @media print {
        body { padding: 0; }
        .label { border: 0; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">${labelHtml.repeat(labels)}</div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          window.focus();
          window.print();
        }, 100);
      });
      window.addEventListener('afterprint', function () { window.close(); });
    </script>
  </body>
</html>`;

  const win = window.open('', '_blank', 'width=720,height=720');
  if (!win) {
    throw new Error('Popup blocked — please allow popups to print barcodes.');
  }
  win.document.open();
  win.document.write(doc);
  win.document.close();
}

/**
 * Print many products in one print dialog — each entry repeats by `count` (qty).
 *
 * @param {Array<{ value: string, name?: string, count?: number }>} items
 * @param {{ format?: string }} [opts]
 */
export function printBarcodeLabelsBulk(items, { format = 'CODE128' } = {}) {
  const list = (items || []).filter((x) => x && String(x.value || '').trim());
  if (!list.length) {
    throw new Error('No barcodes to print.');
  }

  const labelChunks = [];
  for (const { value, name = '', count = 1 } of list) {
    const labels = Math.max(1, Math.floor(Number(count)) || 1);
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(tmp, String(value), {
      format,
      width: 2,
      height: 60,
      fontSize: 14,
      displayValue: true,
      margin: 4,
    });
    const svgMarkup = new XMLSerializer().serializeToString(tmp);
    const singleLabel = `
    <div class="label">
      ${name ? `<div class="label-name">${escapeHtml(name)}</div>` : ''}
      <div class="label-barcode">${svgMarkup}</div>
    </div>`;
    labelChunks.push(singleLabel.repeat(labels));
  }

  const doc = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Print barcodes — ${list.length} item(s)</title>
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #000; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      body { padding: 10mm; }
      .sheet { display: flex; flex-wrap: wrap; gap: 6mm; }
      .label {
        border: 1px dashed #cfcfcf;
        padding: 4mm 4mm 3mm;
        min-width: 50mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        page-break-inside: avoid;
      }
      .label-name {
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 3px;
        max-width: 55mm;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .label-barcode svg { display: block; }
      @media print {
        body { padding: 0; }
        .label { border: 0; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">${labelChunks.join('')}</div>
    <script>
      window.addEventListener('load', function () {
        setTimeout(function () {
          window.focus();
          window.print();
        }, 100);
      });
      window.addEventListener('afterprint', function () { window.close(); });
    </script>
  </body>
</html>`;

  const win = window.open('', '_blank', 'width=720,height=720');
  if (!win) {
    throw new Error('Popup blocked — please allow popups to print barcodes.');
  }
  win.document.open();
  win.document.write(doc);
  win.document.close();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
