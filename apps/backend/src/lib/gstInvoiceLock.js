import { conflict } from '../utils/errors.js';

/** Caller must hold the source bill row lock, shared with invoice issuance. */
export async function assertNoIssuedGstInvoice(db, shopId, sourceId, sourceType = 'booking') {
  const invoice = await db('gst_invoices')
    .where({ shop_id: shopId, source_id: sourceId, source_type: sourceType })
    .first('invoice_number');
  if (invoice)
    throw conflict(
      `GST invoice ${invoice.invoice_number} has been issued. Billed details cannot be edited, cancelled, or deleted. Use the delivery, return, or payment workflow for operational changes.`
    );
}
