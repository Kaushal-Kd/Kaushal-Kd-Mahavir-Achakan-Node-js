import { formatBookingDateTime, formatCurrency, formatDate, formatDateTime } from '@wrs/shared';
import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';

import BookingBillLink from './BookingBillLink.jsx';
import SaleBillLink from './SaleBillLink.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';

function formatEventDateTime(row) {
  if (row.event_at) return formatDateTime(row.event_at) || '—';
  return formatBookingDateTime(row.event_date, row.event_time) || formatDate(row.event_date) || '—';
}

const STATUS_TONE = {
  active: 'green',
  cancelled: 'red',
  booked: 'yellow',
  delivered: 'brand',
  returned: 'gray',
  closed: 'gray',
};

const ProductSaleHistoryTable = ({ rows, loading, fetchError, onEditSale, onEditBooking }) => {
  if (loading && rows.length === 0) {
    return <div className="text-center text-sm text-gray-500 py-10">Loading…</div>;
  }
  if (fetchError && rows.length === 0 && !loading) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-4 text-sm text-center">
        {fetchError}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="text-center text-sm text-gray-600 py-6">
        No sale found in this date range. Try Show all sales.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-md relative">
      {fetchError ? (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-xs">
          {fetchError}
        </div>
      ) : null}
      {loading ? (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-sm text-gray-500 z-10 rounded-md">
          Updating…
        </div>
      ) : null}
      <table className="table w-full text-sm">
        <thead>
          <tr>
            <th className="text-left min-w-[5rem]">
              <TableHeaderLabel>Bill No.</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Source</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Date &amp; Time</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Qty</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Amount</TableHeaderLabel>
            </th>
            <th className="text-left min-w-[10rem]">
              <TableHeaderLabel>Customer Name</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Contact Number</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Status</TableHeaderLabel>
            </th>
            <th className="text-right bg-brand text-white normal-case font-semibold">
              <TableHeaderLabel align="right" nowrap>
                Action
              </TableHeaderLabel>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.row_id} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-mono">
                {r.source === 'sale' ? (
                  <SaleBillLink saleId={r.record_id}>{r.bill_no}</SaleBillLink>
                ) : (
                  <BookingBillLink orderId={r.record_id}>{r.bill_no}</BookingBillLink>
                )}
              </td>
              <td className="px-3 py-2 capitalize">{r.source === 'sale' ? 'Sale' : 'Booking'}</td>
              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatEventDateTime(r)}</td>
              <td className="px-3 py-2 text-right font-medium">{r.qty}</td>
              <td className="px-3 py-2 text-right">{formatCurrency(Number(r.amount ?? 0))}</td>
              <td className="px-3 py-2 font-medium text-gray-800 min-w-[10rem]">
                {r.customer_name || '—'}
              </td>
              <td className="px-3 py-2 text-gray-600">{r.customer_phone || '—'}</td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[r.status] || 'gray'}>
                  {String(r.status || '').replace(/_/g, ' ')}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right bg-brand-light/30">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  title={r.source === 'sale' ? 'Edit sale' : 'Edit booking'}
                  aria-label={r.source === 'sale' ? 'Edit sale' : 'Edit booking'}
                  onClick={() =>
                    r.source === 'sale'
                      ? onEditSale(r.record_id)
                      : onEditBooking(r.record_id)
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

ProductSaleHistoryTable.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      row_id: PropTypes.string.isRequired,
      source: PropTypes.oneOf(['sale', 'booking']).isRequired,
      record_id: PropTypes.string.isRequired,
      bill_no: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      event_date: PropTypes.string,
      event_time: PropTypes.string,
      event_at: PropTypes.string,
      qty: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      amount: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      customer_name: PropTypes.string,
      customer_phone: PropTypes.string,
      status: PropTypes.string,
    })
  ).isRequired,
  loading: PropTypes.bool,
  fetchError: PropTypes.string,
  onEditSale: PropTypes.func.isRequired,
  onEditBooking: PropTypes.func.isRequired,
};

ProductSaleHistoryTable.defaultProps = {
  loading: false,
  fetchError: null,
};

export default ProductSaleHistoryTable;
