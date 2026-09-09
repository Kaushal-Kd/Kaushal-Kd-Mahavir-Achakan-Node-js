function parseFlags(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isAccessoryLine(row) {
  return Boolean(row?.accessory_id || row?.item_type === 'accessory' || row?.parent_item);
}

function lineKey(row) {
  const type = isAccessoryLine(row) ? 'accessory' : 'item';
  return row?.id ? `${type}:${row.id}` : '';
}

function collectLines(order) {
  const products = Array.isArray(order?.items) ? order.items : [];
  const topAccessories = (Array.isArray(order?.accessories) ? order.accessories : []).map(
    (row) => ({ ...row, item_type: 'accessory' })
  );
  const nestedAccessories = products.flatMap((item) =>
    (Array.isArray(item.accessories) ? item.accessories : []).map((row) => ({
      ...row,
      parent_item: item,
    }))
  );
  const seen = new Set();
  return [...products, ...topAccessories, ...nestedAccessories].filter((row) => {
    const key =
      lineKey(row) ||
      `${row.name_snapshot}:${row.qty}:${row.accessory_id || row.product_id || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function conditionQuantity(row, kind) {
  if (!row?.[kind]) return 0;
  const total = Math.max(1, Number(row.qty || 1));
  if (!isAccessoryLine(row)) return total;
  const stored = Number(row[`${kind}_qty`] || 0);
  return stored > 0 ? Math.min(total, stored) : total;
}

function lineCode(row) {
  return row.code_snapshot || row.code || row.product_code || row.accessory_code || '—';
}

export function deliveredLineKeysFromStageUpdates(updates) {
  return (updates || [])
    .filter(
      (update) =>
        update?.field === 'delivered' && update?.value === true && update?.item_id
    )
    .map(
      (update) =>
        `${update.item_type === 'accessory' ? 'accessory' : 'item'}:${update.item_id}`
    );
}

export function newDeliveredLineKeys(beforeOrder, afterOrder, updates) {
  const requested = new Set(deliveredLineKeysFromStageUpdates(updates));
  const beforeByKey = new Map(collectLines(beforeOrder).map((row) => [lineKey(row), row]));
  return collectLines(afterOrder)
    .filter((row) => {
      const key = lineKey(row);
      const before = beforeByKey.get(key);
      return requested.has(key) && before &&
        !parseFlags(before.stage_flags).delivered && !!parseFlags(row.stage_flags).delivered;
    })
    .map(lineKey);
}

export function newMissingLineKeys(beforeOrder, afterOrder) {
  const beforeByKey = new Map(collectLines(beforeOrder).map((row) => [lineKey(row), row]));
  return collectLines(afterOrder)
    .filter((row) => {
      const key = lineKey(row);
      return (
        key &&
        conditionQuantity(row, 'missing') >
          conditionQuantity(beforeByKey.get(key), 'missing')
      );
    })
    .map(lineKey);
}

export function buildWhatsAppTransactionRows(order, kind = 'delivery', options = {}) {
  const isMissing = kind === 'missing';
  const selectedKeys =
    Array.isArray(options.lineKeys)
      ? new Set(options.lineKeys)
      : null;
  return collectLines(order)
    .filter((row) => !selectedKeys || selectedKeys.has(lineKey(row)))
    .filter((row) =>
      isMissing
        ? conditionQuantity(row, 'missing') > 0
        : !!parseFlags(row.stage_flags).delivered
    )
    .map((row) => {
      const accessory = isAccessoryLine(row);
      return {
        key: lineKey(row),
        code: lineCode(row),
        category:
          String(row.category_name || '').trim() || (accessory ? 'Accessory' : 'Product'),
        name: row.name_snapshot || row.name || 'Item',
        qty: isMissing
          ? conditionQuantity(row, 'missing')
          : Math.max(1, Number(row.qty || 1)),
        type: accessory ? 'Accessory' : 'Product',
        status: isMissing ? 'Missing' : 'Delivered',
        charge: Number(row.damage_charge || 0),
      };
    });
}
