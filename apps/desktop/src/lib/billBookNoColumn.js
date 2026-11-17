import { createElement } from 'react';

/** Manual paper bill-book number entered on the booking (free text, may repeat). */
export function formatBillBookNo(row) {
  return String(row?.bill_book_no ?? '').trim();
}

/** DataTable column for the paper bill-book number. */
export function buildBillBookNoColumn() {
  return {
    key: 'bill_book_no',
    header: 'Bill Book No',
    columnPickerLabel: 'Bill Book No.',
    className: 'text-xs whitespace-nowrap',
    exportValue: formatBillBookNo,
    render: (r) =>
      createElement('span', { className: 'font-mono text-xs text-gray-900' }, formatBillBookNo(r) || '—'),
  };
}
