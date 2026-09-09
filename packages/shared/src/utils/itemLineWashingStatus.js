import { ITEM_LINE_STATUS, ITEM_LINE_STATUS_LABELS } from '../constants/itemLineStatus.js';

/**
 * Resolve per-line washing status from queue vs active laundry counts.
 * @param {{ washingQueueQty?: number, laundryWashingQty?: number }} params
 * @returns {{ item_status: string, item_status_label: string } | null}
 */
export function resolveItemLineWashingStatus({ washingQueueQty = 0, laundryWashingQty = 0 } = {}) {
  const queueQty = Math.max(0, Number(washingQueueQty) || 0);
  const laundryQty = Math.max(0, Number(laundryWashingQty) || 0);
  if (queueQty <= 0 && laundryQty <= 0) return null;

  if (queueQty > 0 && laundryQty <= 0) {
    return {
      item_status: ITEM_LINE_STATUS.WASHING_QUEUE,
      item_status_label: ITEM_LINE_STATUS_LABELS.washing_queue,
    };
  }

  if (laundryQty > 0 && queueQty <= 0) {
    return {
      item_status: ITEM_LINE_STATUS.IN_WASHING,
      item_status_label: ITEM_LINE_STATUS_LABELS.in_washing,
    };
  }

  return {
    item_status: ITEM_LINE_STATUS.WASHING_QUEUE,
    item_status_label: 'IN WASHING QUEUE · IN WASHING',
  };
}
