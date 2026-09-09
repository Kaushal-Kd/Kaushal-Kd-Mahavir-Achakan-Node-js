import { addDays, normalizeSqlDateToIso } from '@wrs/shared';

export const DELIVERY_REMINDER_ORDER_STATUSES = ['in_preparation'];

export function isDeliveryReminderOrderStatus(status) {
  return DELIVERY_REMINDER_ORDER_STATUSES.includes(String(status || '').trim());
}

export function deliveryReminderCancellationReason(job, order, today) {
  const deliveryDate = normalizeSqlDateToIso(job.delivery_date);
  if (!deliveryDate || deliveryDate !== normalizeSqlDateToIso(addDays(today, 1))) {
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
  const previousDate = normalizeSqlDateToIso(addDays(deliveryDate, -1));
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || '').trim())
    ? String(time).trim() : '10:00';
  return new Date(`${previousDate}T${validTime}:00+05:30`);
}
