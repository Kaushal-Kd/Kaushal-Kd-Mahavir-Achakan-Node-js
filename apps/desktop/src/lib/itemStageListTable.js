import {
  isStageFlagTruthy,
  parseItemLineStageFlagsFromRaw,
  parseStageFlagsRaw,
} from '@wrs/shared';

import { applyTableColumns } from './tableColumnPreferences.js';

export { buildItemCurrentStatusColumn } from '../components/reports/itemLineCurrentStatusColumn.jsx';
export {
  checklistStageBlockedByAvailability,
  isAvailabilityGatedChecklistStage,
  isItemLineSelectable,
  itemLineCheckboxDisabledTitle,
} from './itemStageAvailability.js';

export { isStageFlagTruthy };

/** @param {object|string|null|undefined} raw */
export function parseItemLineStageFlags(raw) {
  return parseItemLineStageFlagsFromRaw(raw);
}

/** @param {object|string|null|undefined} stageFlags */
export function isItemLineCollected(stageFlags) {
  return parseStageFlagsRaw(stageFlags, 'item').item_to_collect;
}

/** Columns hidden until enabled in the column picker (Item to Collect / Prepare Item). */
export const ITEM_STAGE_LIST_DEFAULT_HIDDEN = [
  'customer_notes',
  'product_notes',
  'all_notes',
  'reference_name',
  'customer_phone',
  'customer_address',
  'security',
  'nearest_next_booking',
  'booking_datetime',
];

export { buildItemStageSalesmanColumn } from '../components/reports/ItemStageSalesmanColumn.jsx';

/** @deprecated Use applyTableColumns via useDataTableColumns */
export function filterItemStageVisibleColumns(allColumns, hiddenKeys, columnOrder = []) {
  return applyTableColumns(allColumns, { hiddenKeys, columnOrder });
}
