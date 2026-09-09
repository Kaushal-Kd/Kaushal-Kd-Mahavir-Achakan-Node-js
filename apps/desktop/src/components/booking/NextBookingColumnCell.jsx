import { formatDate, uniqueNextBookingsFromAlerts } from '@wrs/shared';
import clsx from 'clsx';
import PropTypes from 'prop-types';

import BookingBillLink from './BookingBillLink.jsx';

const alertShape = PropTypes.shape({
  next_order_id: PropTypes.string,
  next_order_number: PropTypes.string,
  next_pickup_date: PropTypes.string,
  gap_days: PropTypes.number,
  name_snapshot: PropTypes.string,
});

/**
 * Next booking column: clickable date and booking number(s) for list rows.
 */
export default function NextBookingColumnCell({ alerts, returnTo, returnLabel }) {
  const bookings = uniqueNextBookingsFromAlerts(alerts);
  if (bookings.length === 0) {
    return <span className="text-gray-400">—</span>;
  }

  const primary = bookings[0];
  const dateLabel = primary.next_pickup_date ? formatDate(primary.next_pickup_date) : '—';
  const linkClass = 'text-red-700 font-medium tabular-nums hover:underline';

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <BookingBillLink
        orderId={primary.next_order_id}
        returnTo={returnTo}
        returnLabel={returnLabel}
        className={linkClass}
      >
        {dateLabel}
      </BookingBillLink>
      {bookings.length > 1 ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {bookings.map((b) => (
            <BookingBillLink
              key={b.next_order_id}
              orderId={b.next_order_id}
              returnTo={returnTo}
              returnLabel={returnLabel}
              className={clsx('font-mono text-[10px] leading-tight text-brand')}
            >
              {b.next_order_number}
            </BookingBillLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

NextBookingColumnCell.propTypes = {
  alerts: PropTypes.arrayOf(alertShape),
  returnTo: PropTypes.string,
  returnLabel: PropTypes.string,
};
