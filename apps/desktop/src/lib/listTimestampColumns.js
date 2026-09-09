import { formatBookingDateTime, formatInstantDateTime, formatPaymentDateTime } from '@wrs/shared';

/** @param {Date|string|number|null|undefined} value */
export function formatTimestampDateTime(value) {
  if (value == null || value === '') return '—';
  return formatInstantDateTime(value) || '—';
}

/** Financial row: prefer recorded timestamp, else business date. */
export function formatFinancialRecordDateTime(row, dateKey = 'entry_date') {
  if (row?.created_at || row?.payment_date || row?.[dateKey] || row?.date) {
    const text = formatPaymentDateTime({
      payment_date: row.payment_date || row[dateKey] || row.date,
      created_at: row.created_at || row.date,
    });
    if (text) return text;
  }
  return formatInstantDateTime(row?.date ?? row?.[dateKey]) || '—';
}

/** @param {Record<string, unknown>} row */
export function formatOrderBookingDateTime(row) {
  const text = formatBookingDateTime(row.booking_date, row.booking_time);
  return text || '—';
}

/** Single column: booking date + time. */
export function buildBookingDateTimeColumn() {
  const cellClass = 'text-xs whitespace-nowrap tabular-nums';
  return {
    key: 'booking_datetime',
    header: 'Booking',
    columnPickerLabel: 'Booking date & time',
    className: cellClass,
    render: (r) => formatOrderBookingDateTime(r),
  };
}

/** @param {Record<string, unknown>} row */
export function orderDeliveredAt(row) {
  if (row._row_kind === 'product') {
    return row.product_delivered_at ?? row.delivered_at ?? null;
  }
  return row.delivered_at ?? null;
}

/** @param {Record<string, unknown>} row */
export function orderReturnedAt(row) {
  if (row._row_kind === 'product') {
    return row.product_received_at ?? row.returned_at ?? row.items_received_at ?? null;
  }
  return row.returned_at ?? row.items_received_at ?? null;
}

/** @param {Record<string, unknown>} row */
export function productRentalDeliveredAt(row) {
  return row.last_delivered_at ?? null;
}

/** @param {Record<string, unknown>} row */
export function productRentalReturnedAt(row) {
  return row.last_returned_at ?? null;
}

/**
 * Delivered and returned columns (date + time combined in each cell).
 * @param {{ getDeliveredAt?: (row: Record<string, unknown>) => unknown, getReturnedAt?: (row: Record<string, unknown>) => unknown }} [opts]
 */
export function buildDeliveredReturnedColumns(opts = {}) {
  const getDeliveredAt = opts.getDeliveredAt ?? orderDeliveredAt;
  const getReturnedAt = opts.getReturnedAt ?? orderReturnedAt;
  const cellClass = 'text-xs whitespace-nowrap tabular-nums';

  return [
    {
      key: 'delivered_datetime',
      header: 'Delivered',
      columnPickerLabel: 'Delivered date & time',
      className: cellClass,
      render: (r) => formatTimestampDateTime(getDeliveredAt(r)),
    },
    {
      key: 'returned_datetime',
      header: 'Returned',
      columnPickerLabel: 'Returned date & time',
      className: cellClass,
      render: (r) => formatTimestampDateTime(getReturnedAt(r)),
    },
  ];
}
