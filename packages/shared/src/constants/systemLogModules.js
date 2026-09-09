/** Filter values for System Logs UI (no legacy Purchase module). */
export const SYSTEM_LOG_MODULES = Object.freeze([
  { value: 'booking', label: 'Booking' },
  { value: 'sale', label: 'Sale' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'account', label: 'Account' },
  { value: 'payment_voucher', label: 'Payment Voucher' },
  { value: 'receipt_voucher', label: 'Receipt Voucher' },
  { value: 'washing', label: 'Washing' },
]);

export const SYSTEM_LOG_MODULE_VALUES = SYSTEM_LOG_MODULES.map((m) => m.value);

/** @type {Record<string, string>} */
export const SYSTEM_LOG_ACTION_LABELS = Object.freeze({
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  CANCEL: 'Cancelled',
  CANCELLED: 'Cancelled',
  PAYMENT: 'Payment',
  UPDATE_STAGE: 'Updated',
  UPDATE_STAGE_BULK: 'Updated',
  UPDATE_STAGE_BATCH: 'Updated',
  UPDATE_CONDITION: 'Updated',
  ADJUST_DISCOUNT_TOTAL: 'Updated',
  UPDATE_SECURITY_STATUS: 'Updated',
});

/**
 * @param {string} action
 * @returns {string}
 */
export function systemLogActionLabel(action) {
  const key = String(action || '').toUpperCase();
  return SYSTEM_LOG_ACTION_LABELS[key] || key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
}
