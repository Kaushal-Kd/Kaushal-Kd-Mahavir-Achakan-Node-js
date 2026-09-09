import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  defaultColumnOrder,
  normalizeColumnOrder,
  reorderColumnKeys,
  splitColumnGroups,
} from '../lib/tableColumnPreferences.js';
import { useShopStore } from '../stores/shopStore.js';

/** Bump when storage shape changes (v3 adds columnOrder). */
const SCHEMA_VERSION = 3;

function sameStringArray(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function storageKey(baseKey, shopId) {
  return `wrs.dtcols.${baseKey}.${shopId || '_none'}`;
}

/**
 * @param {string} baseKey
 * @param {string | null} shopId
 * @param {string[]} defaultHiddenKeys
 * @param {string[]} defaultOrderKeys middle-column keys in definition order
 */
function loadPrefs(baseKey, shopId, defaultHiddenKeys, defaultOrderKeys) {
  const key = storageKey(baseKey, shopId);
  const fallback = {
    hiddenKeys: [...defaultHiddenKeys],
    columnOrder: [...defaultOrderKeys],
  };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    const hiddenKeys = Array.isArray(p.hiddenKeys) ? [...p.hiddenKeys] : [...defaultHiddenKeys];

    let columnOrder = Array.isArray(p.columnOrder)
      ? normalizeColumnOrder(
          p.columnOrder,
          defaultOrderKeys.map((k) => ({ key: k }))
        )
      : [...defaultOrderKeys];

    if (p.schemaVersion !== SCHEMA_VERSION) {
      columnOrder = normalizeColumnOrder(
        p.schemaVersion === 2 && Array.isArray(p.columnOrder) ? p.columnOrder : defaultOrderKeys,
        defaultOrderKeys.map((k) => ({ key: k }))
      );
      savePrefs(baseKey, shopId, hiddenKeys, columnOrder);
    }

    return { hiddenKeys, columnOrder };
  } catch {
    return fallback;
  }
}

function savePrefs(baseKey, shopId, hiddenKeys, columnOrder) {
  try {
    localStorage.setItem(
      storageKey(baseKey, shopId),
      JSON.stringify({ hiddenKeys, columnOrder, schemaVersion: SCHEMA_VERSION })
    );
  } catch {
    /* ignore */
  }
}

/**
 * Persist hidden + ordered table columns (per table + shop).
 * @param {string} baseKey e.g. 'customers'
 * @param {string[]} defaultHiddenKeys columns hidden until user turns them on
 * @param {object[]} [middleColumnDefs] optional middle columns for default order; if omitted, order is []
 */
export function useTableColumnPreferences(baseKey, defaultHiddenKeys, middleColumnDefs = []) {
  const shopId = useShopStore((s) => s.selectedShopId);
  const defaultOrderKeys = useMemo(() => defaultColumnOrder(middleColumnDefs), [middleColumnDefs]);

  const [hiddenKeys, setHiddenKeys] = useState(
    () => loadPrefs(baseKey, shopId, defaultHiddenKeys, defaultOrderKeys).hiddenKeys
  );
  const [columnOrder, setColumnOrder] = useState(
    () => loadPrefs(baseKey, shopId, defaultHiddenKeys, defaultOrderKeys).columnOrder
  );

  useEffect(() => {
    const loaded = loadPrefs(baseKey, shopId, defaultHiddenKeys, defaultOrderKeys);
    setHiddenKeys((current) =>
      sameStringArray(current, loaded.hiddenKeys) ? current : loaded.hiddenKeys
    );
    setColumnOrder((current) =>
      sameStringArray(current, loaded.columnOrder) ? current : loaded.columnOrder
    );
  }, [baseKey, shopId, defaultHiddenKeys, defaultOrderKeys]);

  const persist = useCallback(
    (nextHidden, nextOrder) => {
      savePrefs(baseKey, shopId, nextHidden, nextOrder);
    },
    [baseKey, shopId]
  );

  const toggleKey = useCallback(
    (colKey) => {
      setHiddenKeys((prevHidden) => {
        const nextHidden = prevHidden.includes(colKey)
          ? prevHidden.filter((k) => k !== colKey)
          : [...prevHidden, colKey];
        setColumnOrder((prevOrder) => {
          persist(nextHidden, prevOrder);
          return prevOrder;
        });
        return nextHidden;
      });
    },
    [persist]
  );

  const reorderKeys = useCallback(
    (dragKey, dropKey) => {
      setColumnOrder((prevOrder) => {
        const nextOrder = reorderColumnKeys(prevOrder, dragKey, dropKey);
        setHiddenKeys((prevHidden) => {
          persist(prevHidden, nextOrder);
          return prevHidden;
        });
        return nextOrder;
      });
    },
    [persist]
  );

  const resetKeys = useCallback(() => {
    const nextHidden = [...defaultHiddenKeys];
    const nextOrder = [...defaultOrderKeys];
    setHiddenKeys(nextHidden);
    setColumnOrder(nextOrder);
    persist(nextHidden, nextOrder);
  }, [baseKey, shopId, defaultHiddenKeys, defaultOrderKeys, persist]);

  return { hiddenKeys, columnOrder, toggleKey, reorderKeys, resetKeys };
}

/**
 * @param {string} baseKey
 * @param {string[]} defaultHiddenKeys
 * @param {object[]} [middleColumnDefs]
 */
export function useTableColumnVisibility(baseKey, defaultHiddenKeys, middleColumnDefs = []) {
  const { hiddenKeys, toggleKey, resetKeys, columnOrder, reorderKeys } = useTableColumnPreferences(
    baseKey,
    defaultHiddenKeys,
    middleColumnDefs
  );
  return { hiddenKeys, columnOrder, toggleKey, reorderKeys, resetKeys };
}

/** @param {object[]} allColumns */
export function middleColumnsFromAll(allColumns) {
  return splitColumnGroups(allColumns).middle;
}
