import { formatBookingDateTime } from '@wrs/shared';

import { formatItemStageCurrentStatus } from './itemToCollectPdfExport.js';

const GIVEN_STATUS_LABELS = {
  given_with_rent: 'Given with rent',
  pack_with_rent: 'Pack with rent',
  regular: 'Regular',
};

/**
 * @param {import('../utils/pdfRichText.js').PdfRichLine[]} lines
 * @returns {string}
 */
function richLinesToPlain(lines) {
  return (lines || []).map((line) => (line.segments || []).map((s) => s.text).join('')).join('\n');
}

/**
 * @param {string} type
 * @returns {string}
 */
function formatLineType(type) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  if (t === 'sell') return 'Sell';
  return '';
}

/**
 * @param {string} status
 * @returns {string}
 */
function formatGivenStatus(status) {
  const key = String(status || '').trim();
  return GIVEN_STATUS_LABELS[key] || key || '';
}

function shouldIncludeAccessoryInPrepareExport(acc) {
  return !!acc;
}

/**
 * @param {string} category
 * @returns {string}
 */
function accessoryCategoryHeading(category) {
  const cat = String(category ?? '').trim();
  return cat ? `${cat.toUpperCase()}: ` : 'Accessory: ';
}

/**
 * @param {string} heading
 * @param {string} name
 * @param {number} qty
 * @param {string} typeLabel
 * @param {string} [givenLabel]
 * @returns {import('../utils/pdfRichText.js').PdfRichLine}
 */
function buildItemDetailRichLine(heading, name, qty, typeLabel, givenLabel = '') {
  const detailParts = [];
  if (qty > 1) detailParts.push(`Qty ${qty}`);
  if (typeLabel) detailParts.push(typeLabel);
  if (givenLabel) detailParts.push(givenLabel);
  const detailText = detailParts.length ? `, ${detailParts.join(', ')}` : '';

  return {
    segments: [
      { text: heading, bold: true },
      { text: name, bold: false },
      { text: detailText, bold: false },
    ],
  };
}

/**
 * @param {object} acc
 * @returns {import('../utils/pdfRichText.js').PdfRichLine}
 */
function buildAccessoryDetailRichLine(acc, headingPrefix = '') {
  const catLabel = accessoryCategoryHeading(acc?.category_name);
  const heading = headingPrefix ? `${headingPrefix}${catLabel}` : catLabel;
  const accName = String(acc?.name_snapshot ?? '').trim() || '—';
  const qty = Number(acc?.qty ?? 0) || 0;
  const typeLabel = formatLineType(acc?.type);
  const givenLabel = formatGivenStatus(acc?.given_status);
  return buildItemDetailRichLine(heading, accName, qty, typeLabel, givenLabel);
}

/** Same order as booking screen: display_order, then created_at. */
export function comparePrepareExportLines(a, b) {
  const orderA = Number(a?.display_order ?? 0);
  const orderB = Number(b?.display_order ?? 0);
  if (orderA !== orderB) return orderA - orderB;
  const createdA = String(a?.created_at ?? a?.id ?? '');
  const createdB = String(b?.created_at ?? b?.id ?? '');
  return createdA.localeCompare(createdB);
}

/**
 * @param {object} productLine
 * @returns {string}
 */
function formatPrepareProductAvailabilityStatus(productLine) {
  return formatItemStageCurrentStatus(productLine);
}

/**
 * @param {object} productLine
 * @param {number} [index] 1-based position on the booking (matches order screen).
 * @returns {import('../utils/pdfRichText.js').PdfRichLine[]}
 */
function buildSinglePrepareLineDetailsRichLines(productLine, index = 0) {
  /** @type {import('../utils/pdfRichText.js').PdfRichLine[]} */
  const lines = [];

  if (productLine?.is_accessory_only) return lines;

  const code = String(productLine?.product_code ?? '').trim();
  const name = String(productLine?.product_name ?? '').trim();
  let productName = code;
  if (name && name !== code) {
    productName = code ? `${code} - ${name}` : name;
  }
  if (productName) {
    const productQty = Number(productLine?.qty ?? 0) || 0;
    const productType = formatLineType(productLine?.line_type);
    const detailParts = [];
    if (productQty > 1) detailParts.push(`Qty ${productQty}`);
    if (productType) detailParts.push(productType);
    const detailText = detailParts.length ? `, ${detailParts.join(', ')}` : '';
    const productHeading = index > 0 ? `Product ${index}: ` : 'Product: ';
    /** @type {import('../utils/pdfRichText.js').PdfTextSegment[]} */
    const segments = [
      { text: productHeading, bold: true },
      { text: productName, bold: false },
      { text: detailText, bold: false },
    ];
    lines.push({ segments });
  }

  const accessories = Array.isArray(productLine?.line_accessories)
    ? productLine.line_accessories
    : [];
  for (const acc of accessories) {
    if (!shouldIncludeAccessoryInPrepareExport(acc)) continue;
    lines.push(buildAccessoryDetailRichLine(acc));
  }

  return lines;
}

/**
 * Product + linked accessories + order-level extra accessories on separate lines.
 * Supports a single product line row or a booking row with `_prepare_lines`.
 * @param {object} row
 * @returns {import('../utils/pdfRichText.js').PdfRichLine[]}
 */
export function buildPreparePdfLineDetailsRichLines(row) {
  /** @type {import('../utils/pdfRichText.js').PdfRichLine[]} */
  const lines = [];

  const productLines = (
    Array.isArray(row?._prepare_lines) && row._prepare_lines.length ? row._prepare_lines : [row]
  )
    .slice()
    .sort(comparePrepareExportLines);

  for (let i = 0; i < productLines.length; i += 1) {
    lines.push(...buildSinglePrepareLineDetailsRichLines(productLines[i], row._prepare_product_index || i + 1));
  }
  if (row._prepare_continued) lines.unshift({ segments: [{ text: 'Continued', bold: false }] });

  const extras = Array.isArray(row?.order_extra_accessories) ? row.order_extra_accessories : [];
  for (const acc of extras) {
    if (!shouldIncludeAccessoryInPrepareExport(acc)) continue;
    lines.push(buildAccessoryDetailRichLine(acc, 'Extra '));
  }

  return lines;
}

/**
 * @param {object} row
 * @returns {string}
 */
export function formatPreparePdfLineDetails(row) {
  return richLinesToPlain(buildPreparePdfLineDetailsRichLines(row));
}

function formatPrepareProductField(row, field) {
  const productLines = (
    Array.isArray(row?._prepare_lines) && row._prepare_lines.length ? row._prepare_lines : [row]
  )
    .slice()
    .sort(comparePrepareExportLines);

  return productLines.filter((line) => !line?.is_accessory_only)
    .map((line) => String(line?.[field] ?? '').trim()).join('\n');
}

export function formatPreparePdfProductNote(row) {
  return formatPrepareProductField(row, 'tailor_notes');
}

export function formatPreparePdfDesignDetails(row) {
  return formatPrepareProductField(row, 'product_catalog_notes');
}

export function formatPreparePdfProductStatus(row) {
  if (row._prepare_product_index) return formatPrepareProductAvailabilityStatus(row._prepare_lines[0]);
  const productLines = (
    Array.isArray(row?._prepare_lines) && row._prepare_lines.length ? row._prepare_lines : [row]
  )
    .slice()
    .sort(comparePrepareExportLines);
  return (
    productLines
      .filter((line) => !line?.is_accessory_only)
      .map((line, index) => {
        const code = String(
          line?.product_code || line?.product_name || `Product ${index + 1}`
        ).trim();
        return `${code}: ${formatPrepareProductAvailabilityStatus(line) || 'Not Available'}`;
      })
      .join('\n') || 'Accessories only'
  );
}

function prepareContactCell(row) {
  const candidates = [
    row.customer_phone ?? row.pickup_number,
    row.customer_whatsapp ?? row.customer_phone2,
  ];
  return [...new Set(candidates.map((value) => String(value || '').trim()).filter(Boolean))].join(
    '\n'
  );
}

/**
 * One export row per booking with all pending prepare lines nested under `_prepare_lines`.
 * @param {object[]} bookings
 * @param {object[]} lines
 * @returns {object[]}
 */
export function buildPrepareBookingExportRows(bookings, lines) {
  const linesByOrder = new Map();
  for (const line of lines || []) {
    const orderId = String(line?.order_id ?? '').trim();
    if (!orderId) continue;
    if (!linesByOrder.has(orderId)) linesByOrder.set(orderId, []);
    linesByOrder.get(orderId).push(line);
  }

  const rows = [];
  for (const booking of bookings || []) {
    const orderId = String(booking?.order_id ?? booking?.id ?? '').trim();
    const prepareLines = (linesByOrder.get(orderId) || []).slice().sort(comparePrepareExportLines);
    if (!prepareLines.length) continue;

    const extraAccessories = prepareLines[0]?.order_extra_accessories || [];

    rows.push({
      ...booking,
      order_id: orderId,
      _prepare_lines: prepareLines,
      order_extra_accessories: extraAccessories,
    });
  }

  return rows;
}

function splitPrepareNote(value) {
  let rest = String(value || '').trim();
  const parts = [];
  while (rest.length > 600) {
    const space = rest.lastIndexOf(' ', 600);
    const end = space > 300 ? space : 600;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  parts.push(rest);
  return parts;
}

/** Repeat product identity for long-note continuations instead of orphaning notes across pages. */
export function buildPrepareProductExportRows(bookings, lines) {
  return buildPrepareBookingExportRows(bookings, lines).flatMap((booking) => {
    const products = booking._prepare_lines.filter((line) => !line.is_accessory_only);
    const result = products.flatMap((line, index) => {
      const designs = splitPrepareNote(line.product_catalog_notes);
      const notes = splitPrepareNote(line.tailor_notes);
      return Array.from({ length: Math.max(designs.length, notes.length) }, (_, part) => ({
        ...booking,
        _prepare_product_index: index + 1,
        _prepare_continued: part > 0,
        _prepare_lines: [{ ...line, product_catalog_notes: designs[part] || '',
          tailor_notes: notes[part] || '', line_accessories: part ? [] : line.line_accessories }],
        order_extra_accessories: [],
      }));
    });
    if (booking.order_extra_accessories.length) {
      result.push({
        ...booking,
        _prepare_lines: [{ is_accessory_only: true }],
      });
    }
    return result;
  });
}

/** Fixed columns for Prepare Item table PDF export. */
export const ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS = [
  {
    key: 'order_number',
    header: 'Bill no',
    width: 16,
    get: (r) => String(r.order_number ?? r.bill_no ?? '').trim(),
  },
  {
    key: 'customer_name',
    header: 'Customer name',
    width: 21,
    get: (r) => String(r.customer_name ?? r.pickup_name ?? '').trim(),
  },
  {
    key: 'customer_address',
    header: 'Address',
    width: 21,
    get: (r) => String(r.customer_address ?? '').trim(),
  },
  {
    key: 'customer_phone',
    header: 'Mobile / WhatsApp',
    width: 22,
    get: prepareContactCell,
  },
  {
    key: 'line_details',
    header: 'Product & accessories',
    width: 47,
    get: formatPreparePdfLineDetails,
  },
  {
    key: 'design_details',
    header: 'Design Details',
    width: 33,
    get: formatPreparePdfDesignDetails,
  },
  {
    key: 'product_note',
    header: 'Product Note',
    width: 33,
    get: formatPreparePdfProductNote,
  },
  {
    key: 'customer_notes',
    header: 'Customer note',
    width: 24,
    get: (r) => String(r.customer_notes ?? '').trim(),
  },
  {
    key: 'delivery_datetime',
    header: 'Delivery date',
    width: 19,
    get: (r) => formatBookingDateTime(r.pickup_date, r.delivery_time) || '',
  },
  {
    key: 'return_datetime',
    header: 'Return date',
    width: 19,
    get: (r) => formatBookingDateTime(r.return_date, r.return_time) || '',
  },
];

export const ITEM_TO_PREPARE_PRINT_COLUMNS = [
  ...ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS.slice(0, 7),
  {
    key: 'product_status',
    header: 'Product Status',
    width: 22,
    get: formatPreparePdfProductStatus,
  },
  ...ITEM_TO_PREPARE_PDF_EXPORT_COLUMNS.slice(7),
];
