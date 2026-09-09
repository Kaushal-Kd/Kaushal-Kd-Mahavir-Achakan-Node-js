import { formatBookingDateTime, formatCurrency, formatDate } from '@wrs/shared';
import { Pencil } from 'lucide-react';
import PropTypes from 'prop-types';

import BookingBillLink from './BookingBillLink.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';

const STATUS_TONE = {
  booked: 'yellow',
  pending: 'yellow',
  confirmed: 'brand',
  item_to_collect: 'brand',
  in_preparation: 'brand',
  ready_for_delivery: 'brand',
  delivered: 'brand',
  partially_returned: 'yellow',
  returned: 'gray',
  cancelled: 'gray',
  closed: 'gray',
};

const ProductHistoryTable = ({ rows, loading, fetchError, onEdit }) => {
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
    return <div className="text-center text-sm text-gray-600 py-10">No Record Found</div>;
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
              <TableHeaderLabel>Status</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Delivery Date &amp; Time</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Return Date &amp; Time</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Rent</TableHeaderLabel>
            </th>
            <th className="text-right">
              <TableHeaderLabel align="right">Qty</TableHeaderLabel>
            </th>
            <th className="text-left min-w-[10rem]">
              <TableHeaderLabel>Customer Name</TableHeaderLabel>
            </th>
            <th className="text-left">
              <TableHeaderLabel>Contact Number</TableHeaderLabel>
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
            <tr key={r.order_item_id} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-mono">
                <BookingBillLink orderId={r.order_id}>{r.bill_no}</BookingBillLink>
              </td>
              <td className="px-3 py-2">
                <Badge tone={STATUS_TONE[r.status] || 'gray'}>
                  {String(r.status || '').replace(/_/g, ' ')}
                </Badge>
              </td>
              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                {formatBookingDateTime(r.pickup_date, r.delivery_time) ||
                  formatDate(r.pickup_date) ||
                  '—'}
              </td>
              <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                {r.return_date
                  ? formatBookingDateTime(r.return_date, r.return_time) || formatDate(r.return_date)
                  : '—'}
              </td>
              <td className="px-3 py-2 text-right">{formatCurrency(Number(r.rent ?? 0))}</td>
              <td className="px-3 py-2 text-right font-medium">{r.qty}</td>
              <td className="px-3 py-2 font-medium text-gray-800 min-w-[10rem]">
                {r.customer_name || '—'}
              </td>
              <td className="px-3 py-2 text-gray-600">{r.customer_phone || '—'}</td>
              <td className="px-3 py-2 text-right bg-brand-light/30">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={Pencil}
                  title="Edit booking"
                  aria-label="Edit booking"
                  onClick={() => onEdit(r.order_id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

ProductHistoryTable.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      order_id: PropTypes.string.isRequired,
      order_item_id: PropTypes.string.isRequired,
      bill_no: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      status: PropTypes.string,
      pickup_date: PropTypes.string,
      delivery_time: PropTypes.string,
      return_date: PropTypes.string,
      return_time: PropTypes.string,
      qty: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      rent: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
      customer_name: PropTypes.string,
      customer_phone: PropTypes.string,
    })
  ).isRequired,
  loading: PropTypes.bool,
  fetchError: PropTypes.string,
  onEdit: PropTypes.func.isRequired,
};

ProductHistoryTable.defaultProps = {
  loading: false,
  fetchError: null,
};

export default ProductHistoryTable;
