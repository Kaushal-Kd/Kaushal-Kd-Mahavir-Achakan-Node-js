import { DELIVERY_PENDING_ORDER_STATUSES, normalizeSqlDateToIso, parseOrderTimeTo24 } from '@wrs/shared';

export const DELIVERY_REMINDER_ORDER_STATUSES = [...DELIVERY_PENDING_ORDER_STATUSES];

export function isDeliveryReminderOrderStatus(status) {
  return DELIVERY_REMINDER_ORDER_STATUSES.includes(String(status || '').trim());
}

export function shiftIsoCalendarDate(value, days) {
  const iso = normalizeSqlDateToIso(value);
  if (!iso) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return shifted.toISOString().slice(0, 10);
}

export function deliveryReminderCancellationReason(job, order, today) {
  const deliveryDate = normalizeSqlDateToIso(job.delivery_date);
  if (!deliveryDate || deliveryDate !== shiftIsoCalendarDate(today, 1)) {
    return 'Reminder is not for tomorrow delivery';
  }
  if (!order || !isDeliveryReminderOrderStatus(order.status)) {
    return 'Booking is no longer eligible';
  }
  if (normalizeSqlDateToIso(order.pickup_date) !== deliveryDate) {
    return 'Booking delivery date changed';
  }
  return null;
}

export function canReactivateDeliveryReminder(job) {
  return job?.status === 'cancelled' && !job.sent_at && !job.message_log_id;
}

export function deliveryReminderScheduledAt(deliveryDate, time) {
  const previousDate = shiftIsoCalendarDate(deliveryDate, -1);
  const validTime = parseOrderTimeTo24(time) || '10:00';
  return new Date(`${previousDate}T${validTime}:00+05:30`);
}
