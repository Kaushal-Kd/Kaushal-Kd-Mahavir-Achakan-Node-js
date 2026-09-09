import { formatDate } from '@wrs/shared';
import { Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import BookingBillLink from './BookingBillLink.jsx';

const bookingShape = PropTypes.shape({
  order_id: PropTypes.string,
  order_number: PropTypes.string,
  bill_no: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  pickup_date: PropTypes.string,
  return_date: PropTypes.string,
  status: PropTypes.string,
  booked_qty: PropTypes.number,
  customer_name: PropTypes.string,
});

function bookingLabel(booking) {
  return booking.order_number || booking.bill_no || '—';
}

function BookingLine({ booking, returnTo, returnLabel, onNavigate }) {
  const pickup = booking.pickup_date ? formatDate(booking.pickup_date) : '—';
  const ret = booking.return_date ? formatDate(booking.return_date) : '—';
  const customer = booking.customer_name ? ` · ${booking.customer_name}` : '';
  const qty = booking.booked_qty ? ` · qty ${booking.booked_qty}` : '';
  return (
    <span className="text-[10px] leading-snug text-gray-700">
      <BookingBillLink
        orderId={booking.order_id}
        stopPropagation={false}
        returnTo={returnTo}
        returnLabel={returnLabel}
        onNavigate={onNavigate}
      >
        {bookingLabel(booking)}
      </BookingBillLink>
      {` · pickup ${pickup} · return ${ret}${customer}${qty}`}
    </span>
  );
}

BookingLine.propTypes = {
  booking: bookingShape.isRequired,
  returnTo: PropTypes.string,
  returnLabel: PropTypes.string,
  onNavigate: PropTypes.func,
};

/**
 * Shows earliest next pickup; Info icon lists other upcoming bookings (click).
 */
export default function UpcomingPickupDates({
  bookings,
  emptyLabel = '—',
  className = '',
  initialOpen = false,
  returnTo,
  returnLabel,
  onBookingNavigate,
}) {
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(initialOpen);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const list = Array.isArray(bookings) ? bookings : [];
  const primary = list[0] || null;
  const moreCount = Math.max(0, list.length - 1);

  const reposition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: Math.max(8, rect.left) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (anchor?.contains(e.target)) return;
      if (panel?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!primary?.pickup_date) {
    return <span className={className || 'text-gray-400'}>{emptyLabel}</span>;
  }

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            className="fixed z-[200] w-80 max-w-[calc(100vw-1rem)] rounded border border-gray-200 bg-white p-2 shadow-md"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label="Other upcoming pickup dates"
          >
            <p className="mb-1 text-[10px] font-semibold text-gray-800">Upcoming bookings</p>
            <ul className="max-h-48 overflow-auto space-y-1">
              {list.map((booking) => (
                <li
                  key={`${booking.order_id || booking.order_number}-${booking.pickup_date}`}
                  className="border-b border-gray-50 last:border-0 pb-1 last:pb-0"
                >
                  <BookingLine
                    booking={booking}
                    returnTo={returnTo}
                    returnLabel={returnLabel}
                    onNavigate={() => {
                      onBookingNavigate?.();
                      setOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )
      : null;

  return (
    <span className={`inline-flex items-center justify-center gap-1 ${className}`.trim()}>
      <span>{formatDate(primary.pickup_date)}</span>
      {moreCount > 0 ? (
        <>
          <button
            ref={anchorRef}
            type="button"
            className="inline-flex shrink-0 rounded p-0.5 text-brand hover:bg-brand/10"
            title={`${moreCount} more upcoming booking${moreCount === 1 ? '' : 's'}`}
            aria-label={`Show ${moreCount} more upcoming pickup dates`}
            onClick={(e) => {
              e.stopPropagation();
              reposition();
              setOpen((v) => !v);
            }}
          >
            <Info size={13} aria-hidden="true" />
          </button>
          {panel}
        </>
      ) : null}
    </span>
  );
}

UpcomingPickupDates.propTypes = {
  bookings: PropTypes.arrayOf(bookingShape),
  emptyLabel: PropTypes.string,
  className: PropTypes.string,
  initialOpen: PropTypes.bool,
  returnTo: PropTypes.string,
  returnLabel: PropTypes.string,
  onBookingNavigate: PropTypes.func,
};
