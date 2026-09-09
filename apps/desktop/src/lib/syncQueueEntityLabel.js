const ENTITY_LABELS = Object.freeze({
  delivery_settlement: 'Delivery settlement',
  return_settlement: 'Return settlement',
  security_charge_operation: 'Condition funds operation',
  order_item_replacement: 'Product replacement',
  order_edit: 'Booking edit',
  checklist_command: 'Checklist update',
  salesman_reassignment: 'Salesman work transfer',
  cash_reconciliation: 'Cash counter reconciliation',
  gst_conversion: 'GST to Kaccha conversion',
  gst_issuance: 'GST invoice issuance',
  shop_ip_command: 'Shop IP policy change',
});

export function getSyncQueueEntityLabel(entity) {
  return Object.hasOwn(ENTITY_LABELS, entity)
    ? ENTITY_LABELS[entity]
    : 'Unrecognized saved action - review required';
}

export function getSyncQueueBlockMessage(entry) {
  if (!entry?.blockedBy) return null;
  return (
    String(entry.blockedReason || '').trim() || 'An earlier saved action must be resolved first.'
  );
}
