import { conflict } from '../../utils/errors.js';

export function assertDeliveryLineVersion(row, update) {
  if (update.item_type === 'accessory') return;
  const version = Number(row.replacement_version || 0);
  if (
    !version &&
    update.expected_product_id === undefined &&
    update.expected_line_version === undefined
  )
    return;
  if (
    update.expected_product_id !== row.product_id ||
    Number(update.expected_line_version) !== version ||
    update.expected_line_version == null
  ) {
    throw conflict('The selected product changed. Refresh the booking and review the checklist.');
  }
}
