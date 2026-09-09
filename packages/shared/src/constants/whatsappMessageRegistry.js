/** Shop setting: auto-send WhatsApp on triggers without confirmation (Yes/No). */
export const WHATSAPP_AUTO_SEND_KEY = 'whatsapp.auto_send';

/** Copy-paste tokens for WhatsApp message templates (not stored in DB). */
export const WHATSAPP_TEMPLATE_VARIABLES = [
  '*{CUSTOMER_NAME}*',
  '*{SHOP_NAME}*',
  '*{PRODUCT_NAME}*',
  '{BILL_PDF}',
  '*{BILL_NO}*',
  '*{ITEMS}*',
  '*{DISCOUNT}*',
  '*{TOTAL_RENT}*',
  '*{ADVANCE}*',
  '{PENDING_AMOUNT}',
  '*{SECURITY}*',
  '*{BILL_NOTES}*',
  '*{DELIVERY_DATE}*',
  '*{DELIVERY_TIME}*',
  '*{RETURN_DATE}*',
  '*{RETURN_TIME}*',
  '*{CUSTOMER_ADDRESS}*',
  '*{DELIVERED_ITEMS}*',
  '*{PENDING_DELIVERY_ITEMS}*',
  '*{MISSING_ITEMS}*',
  '*{DAMAGE_ITEMS}*',
  '*{MISSING_CHARGES}*',
  '*{DAMAGE_CHARGES}*',
];

const CREATE_BOOKING_DEFAULT = `Hello *{CUSTOMER_NAME}*,
Thanks for booking with *{SHOP_NAME}*

Bill No: *{BILL_NO}*
{BILL_PDF}`;

const UPDATE_BOOKING_DEFAULT = `Hello *{CUSTOMER_NAME}*,
Your booking with *{SHOP_NAME}* has been updated.

Bill No: *{BILL_NO}*
{BILL_PDF}`;

/** @type {ReadonlyArray<{ key: string, name: string, defaultActive: string, defaultMessage: string, defaultAttachBillPdf?: string }>} */
export const WHATSAPP_MESSAGE_REGISTRY = [
  {
    key: 'DELIVERY_PRODUCT_LIST',
    name: 'Delivery Product List',
    defaultActive: 'Yes',
    defaultMessage: `Hello *{CUSTOMER_NAME}*,

Your delivery for bill *{BILL_NO}* has been issued.
Delivered items: *{DELIVERED_ITEMS}*
Pending items: *{PENDING_DELIVERY_ITEMS}*
Delivery: *{DELIVERY_DATE}* *{DELIVERY_TIME}*`,
    defaultAttachBillPdf: 'Yes',
  },
  {
    key: 'RETURN_MISSING_ITEMS',
    name: 'Return Missing Items',
    defaultActive: 'Yes',
    defaultMessage: `Hello *{CUSTOMER_NAME}*,

Missing items recorded for bill *{BILL_NO}*: *{MISSING_ITEMS}*
Missing charges: *{MISSING_CHARGES}*
Damage items: *{DAMAGE_ITEMS}*
Damage charges: *{DAMAGE_CHARGES}*`,
    defaultAttachBillPdf: 'Yes',
  },
  {
    key: 'DELIVERY_REMINDER',
    name: 'Automatic Delivery Reminder',
    defaultActive: 'Yes',
    defaultMessage: `Hello *{CUSTOMER_NAME}*,

Reminder: your booking *{BILL_NO}* is prepared for delivery on *{DELIVERY_DATE}* at *{DELIVERY_TIME}*.
Address: *{CUSTOMER_ADDRESS}*`,
    defaultAttachBillPdf: 'No',
  },
  {
    key: 'BILL_PREPARED',
    name: 'Bill Prepared (all items prepared)',
    defaultActive: 'Yes',
    defaultMessage: 'Your bill is prepared and ready.',
    defaultAttachBillPdf: 'No',
  },
  {
    key: 'BILL_DELIVER',
    name: 'Bill Deliver (all items delivered)',
    defaultActive: 'Yes',
    defaultMessage: 'Your bill has been delivered. Please check and confirm.',
    defaultAttachBillPdf: 'No',
  },
  {
    key: 'BILL_RETURN',
    name: 'Bill Return (all items received)',
    defaultActive: 'Yes',
    defaultMessage:
      'We have processed the return of your bill. Let us know if you have any questions.',
    defaultAttachBillPdf: 'No',
  },
  {
    key: 'CREATE_BOOKING',
    name: 'Create Booking',
    defaultActive: 'Yes',
    defaultMessage: CREATE_BOOKING_DEFAULT,
    defaultAttachBillPdf: 'Yes',
  },
  {
    key: 'UPDATE_BOOKING',
    name: 'Update Booking',
    defaultActive: 'Yes',
    defaultMessage: UPDATE_BOOKING_DEFAULT,
    defaultAttachBillPdf: 'Yes',
  },
  {
    key: 'CANCEL_BOOKING',
    name: 'Cancel Booking',
    defaultActive: 'Yes',
    defaultMessage: `Hello *{CUSTOMER_NAME}*,

Your booking *{BILL_NO}* with *{SHOP_NAME}* has been cancelled.

If you have any questions, please contact us.`,
    defaultAttachBillPdf: 'No',
  },
  {
    key: 'LAUNDRY_SLIP',
    name: 'Laundry slip to vendor',
    defaultActive: 'Yes',
    defaultMessage: `Hello,

Laundry job *{BILL_NO}* from *{SHOP_NAME}*.
Please find the slip PDF attached.`,
    defaultAttachBillPdf: 'No',
  },
];

export const WHATSAPP_MESSAGE_KEYS = WHATSAPP_MESSAGE_REGISTRY.map((r) => r.key);

export const WHATSAPP_MESSAGE_BY_KEY = Object.fromEntries(
  WHATSAPP_MESSAGE_REGISTRY.map((r) => [r.key, r])
);

/** Settings table key for one template row. */
export function whatsappMessageSettingKey(templateKey) {
  return `whatsapp.message.${templateKey}`;
}

export const WHATSAPP_MESSAGE_SETTING_KEYS = WHATSAPP_MESSAGE_REGISTRY.map((r) =>
  whatsappMessageSettingKey(r.key)
);
