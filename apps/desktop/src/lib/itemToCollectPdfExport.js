import { formatDate, ITEM_LINE_STATUS_LABELS } from '@wrs/shared';

import {
  buildItemStageAllNotesPdfLines,
  formatItemStageAllNotes,
  formatItemStageProductNoteForPdf,
  formatItemStageProductRemarks,
} from './itemStageNotes.js';

export {
  buildItemStageAllNotesPdfLines,
  formatItemStageAllNotes,
  formatItemStageProductRemarks,
};

export function formatItemStageCurrentStatus(row) {
  const code = String(row?.item_status ?? '').trim();
  const label = String(row?.item_status_label ?? '').trim();
  if (label) return label;
  if (code && ITEM_LINE_STATUS_LABELS[code]) return ITEM_LINE_STATUS_LABELS[code];
  return code;
}

/** Fixed columns for Item to Collect table PDF (not tied to on-screen column picker). */
export const ITEM_TO_COLLECT_PDF_EXPORT_COLUMNS = [
  {
    key: 'order_number',
    header: 'Bill no',
    width: 18,
    get: (r) => String(r.order_number ?? '').trim(),
  },
  {
    key: 'sales_person_name',
    header: 'Salesman',
    width: 22,
    get: (r) => String(r.sales_person_name ?? '').trim() || 'Unassigned',
  },
  {
    key: 'item_status',
    header: 'Current status',
    width: 22,
    get: formatItemStageCurrentStatus,
  },
  {
    key: 'product_code',
    header: 'Product code',
    width: 22,
    get: (r) => r.product_code || '',
  },
  {
    key: 'product_remarks',
    header: 'Product remarks',
    width: 28,
    get: formatItemStageProductNoteForPdf,
  },
  {
    key: 'delivery_date',
    header: 'Delivery date',
    width: 22,
    get: (r) => (r.pickup_date ? formatDate(r.pickup_date) : ''),
  },
  {
    key: 'return_date',
    header: 'Return date',
    width: 22,
    get: (r) => (r.return_date ? formatDate(r.return_date) : ''),
  },
  {
    key: 'all_notes',
    header: 'All notes',
    width: 50,
    get: formatItemStageAllNotes,
    richGet: buildItemStageAllNotesPdfLines,
  },
];
