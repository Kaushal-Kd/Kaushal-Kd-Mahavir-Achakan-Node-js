/**
 * Fixed shop app-settings registry (legacy key names).
 * Stored in `settings` table: shop_id + key + value (text).
 * Only entries wired in app/backend code are listed here.
 */

import { WHATSAPP_AUTO_SEND_KEY } from './whatsappMessageRegistry.js';

export const APP_SETTING_TYPES = {
  YES_NO: 'yes_no',
  NUMBER: 'number',
  TEXT: 'text',
  TIME: 'time',
  HTML: 'html',
  PIPE_NUMBERS: 'pipe_numbers',
  JSON_MARGIN: 'json_margin',
  SELECT: 'select',
};

/** UI section labels for AppSettingsTab grouping. */
export const APP_SETTING_GROUPS = {
  availability: 'Availability',
  booking: 'Booking',
  dashboard: 'Dashboard',
  billing: 'Billing',
  inventory: 'Inventory',
  orders: 'Orders',
  whatsapp: 'WhatsApp',
};

/** @type {ReadonlyArray<{ key: string, name: string, type: string, defaultValue: string, group: string, options?: { value: string, label: string }[] }>} */
export const APP_SETTINGS_REGISTRY = [
  {
    key: 'ALLOW_AUTOCOMPLETE_FOR_CODE',
    name: 'Allow auto-complete for code in check availability.',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'Yes',
    group: 'availability',
  },
  {
    key: 'AUTO_SELECT_RETURN_DATE_DAYS',
    name: 'Auto select return date days.',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '3',
    group: 'booking',
  },
  {
    key: 'CHECK_AVAILABILITY_GAP_DAYS_BETWEEN_TWO_ORDERS',
    name: 'Default next booking gap (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '2',
    group: 'booking',
  },
  {
    key: 'CHECK_AVAILABILITY_PREVIOUS_GAP_DAYS_BETWEEN_TWO_ORDERS',
    name: 'Default previous booking gap (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '2',
    group: 'booking',
  },
  {
    key: 'CHECKLIST_NEXT_BOOKING_ALERT_DAYS',
    name: 'Checklist next-booking alert gap (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '0',
    group: 'booking',
  },
  {
    key: 'DELIVERY_TO_RETURN_DATE_MAX_DAYS',
    name: 'Delivery to return date max days.',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '10',
    group: 'booking',
  },
  {
    key: 'DISPLAY_SALESMAN_IN_CREATE_BOOKING',
    name: 'Display Salesman in Create booking',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'Yes',
    group: 'booking',
  },
  {
    key: 'GST_PERCENTAGE',
    name: 'GST Percentage(%)',
    type: APP_SETTING_TYPES.PIPE_NUMBERS,
    defaultValue: '0|0',
    group: 'booking',
  },
  {
    key: 'MAKE_ADVANCE_MANDATORY',
    name: 'Make Advance Mandatory',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'No',
    group: 'booking',
  },
  {
    key: 'MAXIMUM_FUTURE_BOOKING_DURATION',
    name: 'Maximum Future Booking Duration',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '3',
    group: 'booking',
  },
  {
    key: 'SAVE_AND_PRINT_BOOKING',
    name: 'Save and print booking',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'No',
    group: 'booking',
  },
  {
    key: 'TIME_SLOT_MANDATORY',
    name: 'Time Slot Mandatory',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'No',
    group: 'booking',
  },
  {
    key: 'DASHBOARD_PENDING_DELIVERY_DAYS',
    name: 'Dashboard: Pending delivery lookback (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '9',
    group: 'dashboard',
  },
  {
    key: 'DASHBOARD_PENDING_RETURN_DAYS',
    name: 'Dashboard: Pending return lookback (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '12',
    group: 'dashboard',
  },
  {
    key: 'DASHBOARD_ITEM_TO_COLLECT_DAYS',
    name: 'Dashboard: Item to collect upcoming window (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '10',
    group: 'dashboard',
  },
  {
    key: 'DASHBOARD_ITEM_TO_PREPARE_DAYS',
    name: 'Dashboard: Items to prepare upcoming window (days)',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '10',
    group: 'dashboard',
  },
  {
    key: 'BILL_NOTES',
    name: 'Bill notes (printed at end of invoice)',
    type: APP_SETTING_TYPES.HTML,
    defaultValue:
      '• Orders will not be cancelled, if you cancel the order, the advance payment will not be transferred to any bill or returned. When you come to pick up any item, bring the fare and deposit with you. <br>• Double fare will be charged from those who return it late from the date / time of return. <br>• Any item must be preserved and worn, if any kind of damage occurs, it will be charged separately. <br>• Special check should be done while taking delivery, we will not have any guarantee later.',
    group: 'billing',
  },
  {
    key: 'LOW_STOCK_LIMIT_QUANTITY',
    name: 'Low stock limit quantity',
    type: APP_SETTING_TYPES.NUMBER,
    defaultValue: '4',
    group: 'inventory',
  },
  {
    key: 'CUSTOM_ORDER_NUMBER_PREFIX',
    name: 'Custom order number prefix',
    type: APP_SETTING_TYPES.TEXT,
    defaultValue: 'CO',
    group: 'orders',
  },
  {
    key: WHATSAPP_AUTO_SEND_KEY,
    name: 'Auto send WhatsApp messages — messages go to the customer WhatsApp number on the booking',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'No',
    group: 'whatsapp',
  },
  {
    key: 'whatsapp.delivery_reminder_enabled',
    name: 'Automatic delivery reminder (one day before pickup)',
    type: APP_SETTING_TYPES.YES_NO,
    defaultValue: 'No',
    group: 'whatsapp',
  },
  {
    key: 'whatsapp.delivery_reminder_time',
    name: 'Automatic delivery reminder time (24-hour HH:mm)',
    type: APP_SETTING_TYPES.TIME,
    defaultValue: '10:00',
    group: 'whatsapp',
  },
];

export const APP_SETTINGS_KEYS = APP_SETTINGS_REGISTRY.map((r) => r.key);

export const APP_SETTINGS_BY_KEY = Object.fromEntries(
  APP_SETTINGS_REGISTRY.map((r) => [r.key, r])
);
