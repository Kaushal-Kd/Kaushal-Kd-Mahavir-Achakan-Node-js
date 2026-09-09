import { useMemo } from 'react';

import {
  applyTableColumns,
  buildPickerOptions,
  splitColumnGroups,
} from '../lib/tableColumnPreferences.js';
import { useTableColumnPreferences } from './useTableColumnVisibility.js';

/**
 * @param {string} baseKey storage key per table + shop
 * @param {object[]} allColumns full column definitions (incl. locked)
 * @param {{ defaultHidden?: string[], prefsRevision?: number }} [options]
 */
export function useDataTableColumns(baseKey, allColumns, options = {}) {
  const defaultHidden = options.defaultHidden || [];
  const prefsRevision = options.prefsRevision || 1;
  const storageKey =
    prefsRevision > 1 ? `${baseKey}.__r${prefsRevision}` : baseKey;
  const { middle } = useMemo(() => splitColumnGroups(allColumns), [allColumns]);

  const { hiddenKeys, columnOrder, toggleKey, reorderKeys, resetKeys } = useTableColumnPreferences(
    storageKey,
    defaultHidden,
    middle
  );

  const visibleColumns = useMemo(
    () => applyTableColumns(allColumns, { hiddenKeys, columnOrder }),
    [allColumns, hiddenKeys, columnOrder]
  );

  const exportColumns = visibleColumns;

  const pickerOptions = useMemo(
    () => buildPickerOptions(middle, columnOrder),
    [middle, columnOrder]
  );

  const pickerProps = useMemo(
    () => ({
      options: pickerOptions,
      hiddenKeys,
      columnOrder,
      onToggle: toggleKey,
      onReorder: reorderKeys,
      onReset: resetKeys,
    }),
    [pickerOptions, hiddenKeys, columnOrder, toggleKey, reorderKeys, resetKeys]
  );

  return {
    visibleColumns,
    exportColumns,
    pickerProps,
    hiddenKeys,
    columnOrder,
    toggleKey,
    reorderKeys,
    resetKeys,
  };
}
