export function checklistRowWarningClass(alert) {
  return alert ? 'booking-gap-alert-row !bg-yellow-50 hover:!bg-yellow-100' : '';
}

export function orderHasNextBookingAlert(order) {
  if (!order) return false;
  if (order.has_next_booking_alert) return true;
  if (Number(order.next_booking_alert_count) > 0) return true;
  return Array.isArray(order.next_booking_alerts) && order.next_booking_alerts.length > 0;
}
