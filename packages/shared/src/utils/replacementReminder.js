/**
 * Damage-affected later bookings must remind immediately, not the day before pickup.
 * @param {string} today YYYY-MM-DD
 * @returns {{ reminder_date: string, reminder_time: string }}
 */
export function replacementReminderSchedule(today) {
  const date = String(today || '').slice(0, 10);
  return {
    reminder_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
    reminder_time: '12:00 AM',
  };
}

/**
 * @param {unknown} label
 * @param {unknown} orderNumber
 * @returns {string}
 */
export function replacementReminderDescription(label, orderNumber) {
  const product = String(label || '').trim() || 'Damaged product';
  const bill = String(orderNumber || '').trim();
  if (!bill) {
    return `Replacement required: ${product}. Product is damaged — call the customer and select an alternate before delivery.`;
  }
  return `Replacement required: ${product} for Bill ${bill}. Product is damaged — call the customer and select an alternate before delivery.`;
}
