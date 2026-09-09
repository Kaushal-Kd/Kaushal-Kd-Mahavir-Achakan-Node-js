import { formatDate, formatNextBookingAlertMessage } from '@wrs/shared';
import { Info } from 'lucide-react';
import PropTypes from 'prop-types';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import BookingBillLink from '../../components/booking/BookingBillLink.jsx';

function alertWithFormattedPickup(alert) {
  const pickupLabel = alert.next_pickup_date ? formatDate(alert.next_pickup_date) : alert.next_pickup_date;
  return {
    ...alert,
    next_pickup_date: pickupLabel,
  };
}

const alertShape = PropTypes.shape({
  next_order_id: PropTypes.string,
  next_order_number: PropTypes.string.isRequired,
  next_pickup_date: PropTypes.string.isRequired,
  gap_days: PropTypes.number.isRequired,
  threshold_days: PropTypes.number,
  name_snapshot: PropTypes.string,
});

function gapLabelForAlert(alert) {
  const gap = Math.max(0, Math.floor(Number(alert.gap_days) || 0));
  return gap === 1 ? '1-day gap' : `${gap}-day gap`;
}

const ChecklistNextBookingAlert = ({ alert, returnTo, returnLabel, onNavigate }) => {
  if (!alert) return null;
  const pickupLabel = alert.next_pickup_date ? formatDate(alert.next_pickup_date) : alert.next_pickup_date;
  const tooltipMessage = formatNextBookingAlertMessage(alertWithFormattedPickup(alert));

  return (
    <span className="mt-0.5 inline-flex min-w-0 items-start gap-1 text-yellow-800" title={tooltipMessage}>
      <Info size={13} className="mt-0.5 shrink-0 text-yellow-700" aria-hidden="true" />
      <span className="text-[10px] leading-snug break-words">
        <span>Next booking </span>
        <BookingBillLink
          orderId={alert.next_order_id}
          returnTo={returnTo}
          returnLabel={returnLabel}
          onNavigate={onNavigate}
          className="text-[10px] text-brand"
        >
          {alert.next_order_number}
        </BookingBillLink>
        <span> on {pickupLabel}</span>
      </span>
      <span className="sr-only">{tooltipMessage}</span>
    </span>
  );
};

ChecklistNextBookingAlert.propTypes = {
  alert: alertShape,
  returnTo: PropTypes.string,
  returnLabel: PropTypes.string,
  onNavigate: PropTypes.func,
};

export const BookingListNextBookingAlert = ({ alerts, returnTo, returnLabel }) => {
  const anchorRef = useRef(null);
  const closeTimerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [bridge, setBridge] = useState(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openPanel = useCallback(() => {
    clearCloseTimer();
    const el = anchorRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
      setBridge({
        top: rect.bottom,
        left: rect.left,
        width: Math.max(rect.width, 20),
        height: 6,
      });
    }
    setOpen(true);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 200);
  }, [clearCloseTimer]);

  const reposition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left });
    setBridge({
      top: rect.bottom,
      left: rect.left,
      width: Math.max(rect.width, 20),
      height: 6,
    });
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

  useLayoutEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  if (!Array.isArray(alerts) || alerts.length === 0) return null;

  const keepOpen = () => {
    clearCloseTimer();
    setOpen(true);
  };

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <>
            {bridge ? (
              <div
                className="fixed"
                style={{
                  top: bridge.top,
                  left: bridge.left,
                  width: bridge.width,
                  height: bridge.height,
                  zIndex: 199,
                }}
                aria-hidden="true"
                onMouseEnter={keepOpen}
                onMouseLeave={scheduleClose}
              />
            ) : null}
            <div
              className="fixed z-[200] w-72 rounded border border-yellow-200 bg-white p-2 shadow-sm"
              style={{ top: pos.top, left: pos.left }}
              role="tooltip"
              onMouseEnter={keepOpen}
              onMouseLeave={scheduleClose}
            >
              <p className="mb-1 text-[10px] font-medium text-yellow-900">Next booking after return</p>
              <ul className="space-y-1">
                {alerts.map((alert) => {
                  const formatted = alertWithFormattedPickup(alert);
                  const productLabel = String(alert.name_snapshot || '').trim();
                  const pickupLabel = formatted.next_pickup_date || alert.next_pickup_date;
                  return (
                    <li
                      key={`${alert.next_order_id || alert.next_order_number}-${alert.name_snapshot || 'product'}`}
                      className="text-[10px] leading-snug text-gray-800"
                    >
                      {productLabel ? (
                        <span className="font-medium text-gray-900">{productLabel}</span>
                      ) : null}
                      {productLabel ? <span className="text-gray-500"> · </span> : null}
                      <span>Next booking </span>
                      <BookingBillLink
                        orderId={alert.next_order_id}
                        returnTo={returnTo}
                        returnLabel={returnLabel}
                        className="text-[10px] text-brand"
                      >
                        {alert.next_order_number}
                      </BookingBillLink>
                      <span>
                        {' '}
                        on {pickupLabel} ({gapLabelForAlert(alert)})
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="inline-flex shrink-0 rounded p-0.5 text-yellow-700 hover:bg-yellow-100"
        aria-label="Next booking warning"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            clearCloseTimer();
            setOpen(false);
          } else {
            openPanel();
          }
        }}
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        onFocus={openPanel}
        onBlur={scheduleClose}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {panel}
    </>
  );
};

BookingListNextBookingAlert.propTypes = {
  alerts: PropTypes.arrayOf(alertShape),
  returnTo: PropTypes.string,
  returnLabel: PropTypes.string,
};

export default ChecklistNextBookingAlert;
