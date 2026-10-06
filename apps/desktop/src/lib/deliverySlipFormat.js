import { resolveOrderContactAddress, resolveOrderContactPhone1 } from '@wrs/shared';

import { accessoryGroupNotes } from './accessoryRemarksDisplay.js';
import { pdfSafeText } from '../utils/pdfSafeText.js';

/**
 * @typedef {'product' | 'accessory' | 'note' | 'comma'} SlipTextSegment
 * @typedef {{ type: SlipTextSegment, text?: string, category?: string, name?: string }} SlipSegment
 */

/**
 * Customer / booking address for print slips.
 * @param {object} [order]
 * @param {object} [row]
 * @returns {string}
 */
export function resolveSlipOrderAddress(order, row) {
  return resolveOrderContactAddress({
    ...(order && typeof order === 'object' ? order : {}),
    ...(row && typeof row === 'object' ? row : {}),
    customer: order?.customer || row?.customer,
    contact_address: row?.contact_address || order?.contact_address,
    customer_address: row?.customer_address || order?.customer_address,
  });
}

/**
 * Customer / pickup name for print slips.
 * @param {object} [order]
 * @param {object} [row]
 * @returns {string}
 */
export function resolveSlipCustomerName(order, row) {
  const customer = order?.customer;
  return String(
    row?.customer_name ||
      order?.customer_name ||
      customer?.name ||
      order?.pickup_name ||
      row?.pickup_name ||
      ''
  ).trim();
}

/**
 * Flatten customer + bill fields for token slip headers.
 * @param {object} order
 * @returns {object}
 */
export function enrichSlipOrderForTokens(order) {
  if (!order || typeof order !== 'object') {
    return {
      customer_name: '',
      customer_phone: '',
      customer_address: '',
      order_number: '',
      pickup_name: '',
      pickup_number: '',
    };
  }
  return {
    ...order,
    customer_name: resolveSlipCustomerName(order),
    customer_phone: resolveOrderContactPhone1(order) || order.pickup_number || '',
    customer_address: resolveSlipOrderAddress(order),
    order_number: order.order_number || '',
    pickup_date: order.pickup_date,
    return_date: order.return_date,
    pickup_name: order.pickup_name || '',
    pickup_number: order.pickup_number || '',
  };
}

/**
 * @param {object} [accessory]
 * @returns {boolean}
 */
export function isPackWithRentAccessory(accessory) {
  return String(accessory?.given_status || '').trim() === 'pack_with_rent';
}

/**
 * @param {Array<{ category_name?: string, name_snapshot?: string, given_status?: string }>} accessories
 * @param {{ includeAll?: boolean }} [options]
 * @returns {Array<{ category: string, name: string }>}
 */
export function buildAccessoryTokenSegments(accessories, options = {}) {
  const list = Array.isArray(accessories) ? accessories : [];
  return list
    .filter((accessory) => options.includeAll || isPackWithRentAccessory(accessory))
    .map((acc) => ({
      category: pdfSafeText(
        String(acc?.category_name ?? '')
          .trim()
          .toUpperCase()
      ),
      name: pdfSafeText(String(acc?.name_snapshot ?? '').trim()),
    }))
    .filter((seg) => seg.category || seg.name);
}

export const DEFAULT_PRODUCT_TOKEN_FIELDS = Object.freeze({
  address: true,
  order: true,
  pickup: true,
  return: true,
  code: true,
  name: true,
  notes: true,
  barcode: true,
});

export const DEFAULT_ACCESSORY_TOKEN_FIELDS = Object.freeze({
  order: true,
  address: true,
  customer: true,
  pickup: true,
  return: true,
  accessories: true,
});

export const PRODUCT_TOKEN_FIELD_OPTIONS = Object.freeze([
  { key: 'address', label: 'Address' },
  { key: 'order', label: 'Order' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'return', label: 'Return' },
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Product name' },
  { key: 'notes', label: 'Notes' },
  { key: 'barcode', label: 'Barcode' },
]);

export const ACCESSORY_TOKEN_FIELD_OPTIONS = Object.freeze([
  { key: 'order', label: 'Order' },
  { key: 'address', label: 'Address' },
  { key: 'customer', label: 'Customer' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'return', label: 'Return' },
  { key: 'accessories', label: 'Accessories' },
]);

/**
 * @param {object} [saved]
 */
export function mergeTokenFields(saved = {}) {
  return {
    product: { ...DEFAULT_PRODUCT_TOKEN_FIELDS, ...(saved.product || {}) },
    accessory: { ...DEFAULT_ACCESSORY_TOKEN_FIELDS, ...(saved.accessory || {}) },
  };
}

/**
 * @param {object} [fields]
 * @param {'product' | 'accessory'} kind
 * @param {string} key
 */
export function isTokenFieldEnabled(fields, kind, key) {
  const group = kind === 'accessory' ? fields?.accessory : fields?.product;
  if (!group || group[key] === undefined) return true;
  return group[key] !== false;
}

function filterTokenFields(rows, fields, kind) {
  return rows.filter((row) => isTokenFieldEnabled(fields, kind, row.key));
}

/**
 * Field rows for one pack-with-rent accessory token slip (one per booking).
 * @param {object} target — slip target with slipKind accessory + accessorySegments
 * @param {object} [fields]
 * @returns {Array<{ key: string, label: string, value?: string, wrap?: boolean, richSegments?: Array<{ category: string, name: string }> }>}
 */
export function buildAccessoryTokenSlipFields(target, fields) {
  const address = pdfSafeText(resolveSlipOrderAddress(target));
  const customerName = pdfSafeText(resolveSlipCustomerName(target));

  return filterTokenFields(
    [
      { key: 'order', label: 'Order', value: pdfSafeText(target?.order_number || '') || '—' },
      { key: 'address', label: 'Address', value: address || '—', wrap: true },
      { key: 'customer', label: 'Customer', value: customerName || '—', wrap: true },
      { key: 'pickup', label: 'Pickup', value: formatSlipDate(target?.pickup_date) || '—' },
      { key: 'return', label: 'Return', value: formatSlipDate(target?.return_date) || '—' },
      {
        key: 'accessories',
        label: 'Acc',
        richSegments: Array.isArray(target?.accessorySegments) ? target.accessorySegments : [],
      },
    ],
    fields,
    'accessory'
  );
}

/**
 * One accessory token slip per booking (pack-with-rent accessories only).
 * @param {object} order — full order from ordersApi.get
 * @returns {object | null}
 */
export function buildAccessoryTokenSlipTarget(order) {
  if (!order?.id) return null;
  const accessorySegments = buildAccessoryTokenSegments(order.accessories);
  if (!accessorySegments.length) return null;

  return {
    ...enrichSlipOrderForTokens(order),
    slipKind: 'accessory',
    id: `${order.id}::accessory-token`,
    accessorySegments,
  };
}

/**
 * Product code for print-slip tokens.
 * @param {object} [item]
 * @param {object} [row]
 * @returns {string}
 */
export function resolveSlipProductCode(item, row) {
  return String(item?.code_snapshot || row?.product_code || '').trim();
}

/**
 * Catalog remark from Product module (products.notes).
 * @param {object} [item]
 * @param {object} [row]
 * @returns {string}
 */
export function resolveSlipProductBookingNotes(item, row) {
  return String(item?.tailor_notes || item?.product_note || row?.tailor_notes || '').trim();
}

/**
 * Product display name for print-slip tokens.
 * @param {object} [item]
 * @returns {string}
 */
export function resolveSlipProductName(item) {
  return String(item?.name_snapshot || item?.product_name || '').trim();
}

/**
 * Field rows for one per-product token slip.
 * @param {object} target — slip target with order fields + items[0]
 * @param {object} [fields]
 * @returns {Array<{ key: string, label: string, value: string, wrap?: boolean }>}
 */
export function buildProductTokenSlipFields(target, fields) {
  const item = Array.isArray(target?.items) ? target.items[0] : null;
  const address = pdfSafeText(resolveSlipOrderAddress(target));
  const productCode = pdfSafeText(resolveSlipProductCode(item, target));
  const productName = pdfSafeText(resolveSlipProductName(item));
  const bookingNotes = pdfSafeText(resolveSlipProductBookingNotes(item, target));

  return filterTokenFields(
    [
      { key: 'address', label: 'Address', value: address || '—', wrap: true },
      { key: 'order', label: 'Order', value: pdfSafeText(target?.order_number || '') || '—' },
      { key: 'pickup', label: 'Pickup', value: formatSlipDate(target?.pickup_date) || '—' },
      { key: 'return', label: 'Return', value: formatSlipDate(target?.return_date) || '—' },
      { key: 'code', label: 'Code', value: productCode || '—' },
      { key: 'name', label: 'Name', value: productName || '—', wrap: true },
      { key: 'notes', label: 'Notes', value: bookingNotes || '—', wrap: true },
    ],
    fields,
    'product'
  );
}

/**
 * @param {string|Date|null|undefined} value
 * @returns {string}
 */
export function formatSlipDate(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const iso = raw.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return pdfSafeText(`${m[3]}/${m[2]}/${m[1]}`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return pdfSafeText(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return pdfSafeText(`${dd}/${mm}/${yyyy}`);
}

/**
 * @param {string} nameSnapshot
 * @param {string} codeSnapshot
 * @returns {string}
 */
export function formatProductBase(nameSnapshot, codeSnapshot) {
  const name = String(nameSnapshot ?? '').trim();
  const code = String(codeSnapshot ?? '').trim();
  const bracket = name.match(/\[([^\]]+)\]\s*$/);
  const sizeSuffix = bracket ? ` [${bracket[1]}]` : '';
  const nameWithoutTrailingBracket = bracket ? name.replace(/\s*\[[^\]]+\]\s*$/, '').trim() : name;

  if (code) return pdfSafeText(`${code}${sizeSuffix}`);
  if (nameWithoutTrailingBracket && sizeSuffix) {
    return pdfSafeText(`${nameWithoutTrailingBracket}${sizeSuffix}`);
  }
  return pdfSafeText(name || code);
}

/**
 * @param {{ category_name?: string, name_snapshot?: string }} accessory
 * @returns {SlipSegment}
 */
function accessoryToSegment(accessory) {
  const category = pdfSafeText(
    String(accessory?.category_name ?? '')
      .trim()
      .toUpperCase()
  );
  const name = pdfSafeText(String(accessory?.name_snapshot ?? '').trim());
  if (category && name) {
    return { type: 'accessory', category, name };
  }
  return { type: 'product', text: pdfSafeText(category || name) };
}

/**
 * @param {{ id?: string, name_snapshot?: string, code_snapshot?: string }} item
 * @param {Array<{ order_item_id?: string, category_name?: string, name_snapshot?: string, remarks?: string }>} accessories
 * @returns {SlipSegment[]}
 */
export function buildSlipLineSegments(item, accessories) {
  const list = Array.isArray(accessories) ? accessories : [];
  const itemId = item?.id;
  const linked = itemId ? list.filter((a) => a.order_item_id === itemId) : [];

  /** @type {SlipSegment[]} */
  const segments = [
    { type: 'product', text: formatProductBase(item?.name_snapshot, item?.code_snapshot) },
  ];

  linked.forEach((acc, idx) => {
    segments.push({ type: 'comma' });
    segments.push(accessoryToSegment(acc));
  });

  const notes = accessoryGroupNotes(linked);
  if (notes.length) {
    segments.push({ type: 'comma' });
    segments.push({ type: 'note', text: pdfSafeText(`[${notes.join(' / ')}]`) });
  }

  return trimLeadingCommas(segments);
}

/**
 * Remove leading comma segments.
 * @param {SlipSegment[]} segments
 * @returns {SlipSegment[]}
 */
function trimLeadingCommas(segments) {
  const out = [...segments];
  while (out.length && out[0].type === 'comma') out.shift();
  return out;
}

/**
 * @param {Array<{ order_item_id?: string | null, category_name?: string, name_snapshot?: string, remarks?: string }>} accessories
 * @returns {SlipSegment[][]}
 */
export function buildStandaloneAccessoryLineSegments(accessories) {
  const list = Array.isArray(accessories) ? accessories : [];
  const standalone = list.filter((a) => !a.order_item_id);
  return standalone.map((acc) => {
    const segments = [accessoryToSegment(acc)];
    const note = pdfSafeText(String(acc?.remarks ?? '').trim());
    if (note) {
      segments.push({ type: 'comma' });
      segments.push({ type: 'note', text: `[${note}]` });
    }
    return trimLeadingCommas(segments);
  });
}

/**
 * @param {object[]} rows
 * @returns {object[]}
 */
export function uniqueOrdersFromRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = row.order_id || row.id;
    if (!id || map.has(id)) continue;
    map.set(id, row);
  }
  return [...map.values()];
}

/**
 * One slip per booking, or one slip per product line when productWise is on.
 *
 * @param {object[]} rows
 * @param {boolean} productWise
 * @returns {object[]}
 */
export function buildPrintSlipTargets(rows, productWise) {
  const orders = uniqueOrdersFromRows(rows);
  if (!productWise) return orders;

  const targets = [];
  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      targets.push({
        ...order,
        id: `${order.id}::${item.id}`,
        items: [item],
        accessories: (order.accessories || []).filter((a) => a.order_item_id === item.id),
      });
    }
    const standalone = (order.accessories || []).filter((a) => !a.order_item_id);
    if (standalone.length) {
      targets.push({
        ...order,
        id: `${order.id}::standalone-acc`,
        items: [],
        accessories: standalone,
      });
    }
  }
  return targets;
}

/**
 * One token slip per product line (skips accessory-only rows).
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
export function buildProductTokenSlipTargets(rows) {
  const orders = uniqueOrdersFromRows(rows);
  const targets = [];

  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
      targets.push({
        ...order,
        id: `${order.id}::${item.id}`,
        items: [item],
        accessories: (order.accessories || []).filter((a) => a.order_item_id === item.id),
      });
    }
  }

  return targets;
}

/**
 * Lines for PDF rendering (each line = segments for one product or standalone accessory row).
 *
 * @param {{ items?: object[], accessories?: object[] }} order
 * @returns {SlipSegment[][]}
 */
export function buildSlipProductLineSegmentGroups(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const accessories = Array.isArray(order?.accessories) ? order.accessories : [];
  const lines = items.map((item) => trimLeadingCommas(buildSlipLineSegments(item, accessories)));
  lines.push(...buildStandaloneAccessoryLineSegments(accessories));
  return lines.filter((line) => line.some((s) => (s.text || s.category || s.name || '').length));
}

/** @deprecated Use buildSlipProductLineSegmentGroups for PDF */
export function buildSlipProductLines(order) {
  return buildSlipProductLineSegmentGroups(order).map((segments) =>
    segments
      .map((s) => {
        if (s.type === 'comma') return ',';
        if (s.type === 'accessory') return `${s.category} ${s.name || ''}`.trim();
        return s.text || '';
      })
      .join('')
      .replace(/^,\s*/, '')
  );
}
