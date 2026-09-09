import { isStageFlagTruthy, parseStageFlagsJson } from '@wrs/shared';

export function accessoryBookingLineBlocksAvailability(row) {
  const flags = parseStageFlagsJson(row?.stage_flags);
  return !isStageFlagTruthy(flags?.received);
}

export function activeAccessoryBookingConflicts(rows) {
  return (rows || []).filter(accessoryBookingLineBlocksAvailability);
}

export function calculateAccessoryWashingAvailability({
  rentableQty,
  bookedQty,
  washingQueueRows,
  laundryWashingRows,
}) {
  const washingQueueQty = (washingQueueRows || []).reduce(
    (sum, row) => sum + Number(row.qty || 0),
    0
  );
  const laundryWashingQty = (laundryWashingRows || []).reduce(
    (sum, row) => sum + Number(row.qty || 0),
    0
  );
  const washingQty = washingQueueQty + laundryWashingQty;
  return {
    washingQueueQty,
    laundryWashingQty,
    washingQty,
    freeQty: Math.max(0, Number(rentableQty || 0) - Number(bookedQty || 0) - washingQty),
  };
}
