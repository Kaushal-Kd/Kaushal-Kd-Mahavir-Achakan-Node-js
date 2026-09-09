import { ITEM_LINE_STATUS } from '@wrs/shared';

/** True when Current status is Available (line can be selected on collect/prepare lists). */
export function isItemLineSelectable(row) {
  const status = String(row?.item_status ?? '').trim().toLowerCase();
  if (status === ITEM_LINE_STATUS.AVAILABLE) {
    return row?.item_available !== false;
  }
  return false;
}

/** Tooltip / aria hint when a line checkbox is disabled on item stage lists. */
export function itemLineCheckboxDisabledTitle(row) {
  const status = String(row?.item_status ?? '').trim().toLowerCase();
  if (status && status !== ITEM_LINE_STATUS.AVAILABLE) {
    const label = String(row?.item_status_label ?? '').trim();
    return label ? `Not selectable — ${label}` : 'Not selectable — product is not available';
  }
  if (row?.item_available === false) {
    return 'Not selectable — product is not available';
  }
  if (!status) {
    return 'Not selectable — checking availability';
  }
  return 'Only products with status Available can be selected';
}

/** Collect / Prepared / Delivered on checklist — same gate as Item to Collect / Prepare lists. */
export function isAvailabilityGatedChecklistStage(stageKey) {
  return stageKey === 'item_to_collect' || stageKey === 'prepared' || stageKey === 'delivered';
}

export function checklistStageBlockedByAvailability(itemType, stageKey, row, enabling) {
  if (!enabling || itemType !== 'item') return false;
  if (!isAvailabilityGatedChecklistStage(stageKey)) return false;
  return !isItemLineSelectable(row);
}
