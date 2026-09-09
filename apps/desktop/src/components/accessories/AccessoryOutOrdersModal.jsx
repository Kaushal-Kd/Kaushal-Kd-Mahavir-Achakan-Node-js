import { useQuery } from '@tanstack/react-query';
import { formatDate } from '@wrs/shared';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

import { accessoriesApi } from '../../lib/api/accessories.js';
import BookingBillLink from '../booking/BookingBillLink.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import Modal from '../ui/Modal.jsx';
import TableHeaderLabel from '../ui/TableHeaderLabel.jsx';

const STATUS_TONE = {
  booked: 'yellow',
  pending: 'yellow',
  confirmed: 'brand',
  item_to_collect: 'brand',
  in_preparation: 'brand',
  ready_for_delivery: 'brand',
  delivered: 'green',
  partially_returned: 'yellow',
  returned: 'gray',
  cancelled: 'red',
  closed: 'gray',
};

const AccessoryOutOrdersModal = ({ isOpen, onClose, accessory }) => {
  const navigate = useNavigate();

  const outQuery = useQuery({
    queryKey: ['accessory-out-orders', accessory?.id],
    queryFn: () => accessoriesApi.outOrders(accessory.id),
    enabled: isOpen && !!accessory?.id,
  });

  const payload = outQuery.data?.data ?? outQuery.data ?? {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const totalQty = Number(payload.total_qty ?? 0);

  const openBooking = (orderId) => {
    if (!orderId) return;
    onClose();
    navigate(`/booking/${orderId}`);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" title="Out on bookings">
      {accessory ? (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3 space-y-1">
            <p className="text-sm font-medium text-gray-900">{accessory.name}</p>
            <p className="text-xs text-gray-500">
              Rent accessories delivered to the customer and not yet received.
            </p>
            <p className="text-xs text-yellow-800 tabular-nums">
              Total out: <span className="font-semibold">{totalQty}</span>
              {accessory.unit ? ` ${accessory.unit}` : ''}
            </p>
          </div>

          {outQuery.isLoading && rows.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-10">Loading…</div>
          ) : outQuery.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-4 text-sm text-center">
              {outQuery.error?.response?.data?.message ||
                outQuery.error?.message ||
                'Could not load bookings'}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-sm text-gray-600 py-10">No bookings with this accessory out.</div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded-md relative">
              {outQuery.isFetching ? (
                <div className="absolute inset-0 bg-white/60 flex items-center justify-center text-sm text-gray-500 z-10 rounded-md">
                  Updating…
                </div>
              ) : null}
              <table className="table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left">
                      <TableHeaderLabel>Order No.</TableHeaderLabel>
                    </th>
                    <th className="text-left">
                      <TableHeaderLabel>Customer</TableHeaderLabel>
                    </th>
                    <th className="text-left">
                      <TableHeaderLabel>Pickup</TableHeaderLabel>
                    </th>
                    <th className="text-left">
                      <TableHeaderLabel>Return</TableHeaderLabel>
                    </th>
                    <th className="text-right">
                      <TableHeaderLabel align="right">Qty</TableHeaderLabel>
                    </th>
                    <th className="text-left">
                      <TableHeaderLabel>Status</TableHeaderLabel>
                    </th>
                    <th className="text-right">
                      <TableHeaderLabel align="right" nowrap>
                        Action
                      </TableHeaderLabel>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <tr
                      key={r.order_accessory_id || `${r.order_id}-${r.qty}`}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => openBooking(r.order_id)}
                    >
                      <td className="px-3 py-2 font-mono">
                        <BookingBillLink orderId={r.order_id}>{r.order_number || '—'}</BookingBillLink>
                      </td>
                      <td className="px-3 py-2 text-gray-800">{r.customer_name || '—'}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {r.pickup_date ? formatDate(r.pickup_date) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {r.return_date ? formatDate(r.return_date) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{r.qty}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[r.status] || 'gray'}>
                          {String(r.status || '').replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => openBooking(r.order_id)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
};

AccessoryOutOrdersModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  accessory: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    unit: PropTypes.string,
  }),
};

AccessoryOutOrdersModal.defaultProps = {
  accessory: null,
};

export default AccessoryOutOrdersModal;
