/** @typedef {import('@wrs/shared').SnapshotChangeRow} SnapshotChangeRow */

const CREATED_ACTION = 'Created';

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {number}
 */
export function computeBookingEditCount(rows) {
  if (!rows?.length) return 0;
  const maxRevision = Math.max(...rows.map((r) => Number(r.change_count) || 0));
  return Math.max(0, maxRevision - 1);
}

/**
 * @param {Record<string, unknown>|null|undefined} log
 * @returns {{ billChanges: SnapshotChangeRow[], productChanges: SnapshotChangeRow[] }}
 */
export function splitBillAndProductChanges(log) {
  if (!log) return { billChanges: [], productChanges: [] };
  return {
    billChanges: Array.isArray(log.bill_changes) ? log.bill_changes : [],
    productChanges: Array.isArray(log.product_changes) ? log.product_changes : [],
  };
}

/**
 * @param {Record<string, unknown>} log
 * @returns {SnapshotChangeRow[]}
 */
export function mergeBillAndProductChanges(log) {
  const { billChanges, productChanges } = splitBillAndProductChanges(log);
  return [...billChanges, ...productChanges];
}

/**
 * @param {SnapshotChangeRow[]} changes
 * @param {number} [limit=12]
 */
export function formatLastChangesForPreview(changes, limit = 12) {
  const list = changes || [];
  return {
    rows: list.slice(0, limit),
    truncated: list.length > limit,
    total: list.length,
  };
}

/**
 * Newest log row that is not the initial create.
 * @param {Array<Record<string, unknown>>} rows — sorted newest first (API default)
 */
export function findLastEditLog(rows) {
  if (!rows?.length) return null;
  const sorted = [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return sorted.find((r) => r.action_type !== CREATED_ACTION) || null;
}

/**
 * @param {Record<string, unknown>|null|undefined} log
 * @param {'bill'|'product'} changeType
 * @param {SnapshotChangeRow[]} changes
 * @returns {Array<Record<string, unknown>>}
 */
function mapChangesToFlatRows(log, changeType, changes) {
  if (!log || !changes?.length) return [];
  const action = log.action_type || '—';
  const person = log.responsible_by || log.user_name || '—';
  const createdAt = log.created_at;
  const logId = String(log.id || '');

  return changes.map((ch, index) => ({
    id: `${logId}:${changeType}:${ch.path || ch.label || index}`,
    created_at: createdAt,
    changeType,
    action,
    person,
    path: ch.path || '',
    label: ch.label || ch.path || '',
    itemLabel: '',
    kind: ch.kind || '',
    oldValue: ch.previous,
    newValue: ch.next,
    log_id: logId,
    change_count: log.change_count ?? null,
    bill_no: log.bill_no || '',
    entity_id: log.entity_id || '',
    module: log.module || '',
  }));
}

/**
 * Parse order line id from a product snapshot diff path (e.g. items[uuid].stage_flags).
 * @param {string} path
 */
export function parseLineRefFromChangePath(path) {
  const m = String(path || '').match(/^(items|accessories)\[([^\]]+)\]/);
  if (!m) return null;
  return { kind: m[1], id: m[2] };
}

/**
 * @param {object|null|undefined} line
 * @param {'items'|'accessories'} kind
 */
export function formatOrderLineAuditLabel(line, kind) {
  if (!line) return '';
  const name =
    line.name_snapshot ||
    line.product_name ||
    line.accessory_name ||
    line.name ||
    '';
  const code = line.code_snapshot || line.product_code || line.code || '';
  const bits = [name, code].filter(Boolean).map(String);
  if (bits.length) return bits.join(' · ');
  return kind === 'accessories' ? 'Accessory' : 'Product';
}

/**
 * Attach product/accessory names to product change rows using the current order lines.
 * @param {Array<Record<string, unknown>>} rows
 * @param {object|null|undefined} order
 */
export function enrichChangeRowsWithOrderLineNames(rows, order) {
  if (!order || !rows?.length) return rows || [];
  const itemById = new Map((order.items || []).map((i) => [String(i.id), i]));
  const accById = new Map((order.accessories || []).map((a) => [String(a.id), a]));

  const findLineByIdPrefix = (prefix, map) => {
    if (!prefix) return null;
    if (map.has(prefix)) return map.get(prefix);
    const lower = prefix.toLowerCase();
    for (const [id, line] of map) {
      if (String(id).toLowerCase().startsWith(lower)) return line;
    }
    return null;
  };

  return rows.map((row) => {
    if (row.changeType !== 'product') return row;

    let parsed = parseLineRefFromChangePath(row.path);
    if (!parsed && row.label) {
      const labelPrefix = String(row.label).split(' · ')[0]?.trim();
      const itemLine = findLineByIdPrefix(labelPrefix, itemById);
      if (itemLine) parsed = { kind: 'items', id: String(itemLine.id) };
      else {
        const accLine = findLineByIdPrefix(labelPrefix, accById);
        if (accLine) parsed = { kind: 'accessories', id: String(accLine.id) };
      }
    }
    if (!parsed) return row;

    const line = parsed.kind === 'accessories' ? accById.get(parsed.id) : itemById.get(parsed.id);
    const itemLabel = formatOrderLineAuditLabel(line, parsed.kind);
    if (!itemLabel) return row;
    return { ...row, itemLabel };
  });
}

/**
 * @param {Record<string, unknown>|null|undefined} log
 * @returns {Array<Record<string, unknown>>}
 */
export function flattenLogToChangeRows(log) {
  if (!log) return [];
  const { billChanges, productChanges } = splitBillAndProductChanges(log);
  return [
    ...mapChangesToFlatRows(log, 'bill', billChanges),
    ...mapChangesToFlatRows(log, 'product', productChanges),
  ];
}

/**
 * @param {Array<Record<string, unknown>>} logs
 * @returns {Array<Record<string, unknown>>}
 */
export function flattenSystemLogsToChangeRows(logs) {
  const flat = [];
  for (const log of logs || []) {
    flat.push(...flattenLogToChangeRows(log));
  }
  flat.sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (tb !== ta) return tb - ta;
    if (a.changeType !== b.changeType) {
      return a.changeType === 'bill' ? -1 : 1;
    }
    return String(a.id).localeCompare(String(b.id));
  });
  return flat;
}

/**
 * Group flat change rows by audit log session (newest groups first).
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Array<{ logId: string, createdAt: string, action: string, person: string, billNo: string, changeCount: number|null, rows: Array<Record<string, unknown>> }>}
 */
export function groupChangeRowsByLog(rows) {
  const orderedKeys = [];
  const map = new Map();

  for (const row of rows || []) {
    const key = String(row.log_id || '');
    if (!key) continue;
    if (!map.has(key)) {
      orderedKeys.push(key);
      map.set(key, {
        logId: key,
        createdAt: row.created_at,
        action: row.action,
        person: row.person,
        billNo: row.bill_no,
        changeCount: row.change_count ?? null,
        rows: [],
      });
    }
    map.get(key).rows.push(row);
  }

  return orderedKeys.map((k) => map.get(k));
}

/**
 * Logs that may need detail fetch (counts > 0 but empty change arrays).
 * @param {Record<string, unknown>} log
 */
export function logNeedsChangeDetailFetch(log) {
  if (!log?.id) return false;
  const { billChanges, productChanges } = splitBillAndProductChanges(log);
  if (billChanges.length > 0 || productChanges.length > 0) return false;
  return (
    Number(log.bill_change_count) > 0 ||
    Number(log.product_change_count) > 0 ||
    Boolean(log.bill_data) ||
    Boolean(log.product_data)
  );
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
export function summarizeBookingAuditLogs(rows) {
  const list = rows || [];
  const editCount = computeBookingEditCount(list);
  const lastEditLog = findLastEditLog(list);
  const { billChanges: lastBillChanges, productChanges: lastProductChanges } =
    splitBillAndProductChanges(lastEditLog);

  return {
    editCount,
    lastEditLog,
    lastBillChanges,
    lastProductChanges,
    lastChanges: mergeBillAndProductChanges(lastEditLog),
    lastEditWhen: lastEditLog?.created_at ?? null,
    lastEditBy: lastEditLog?.responsible_by || lastEditLog?.user_name || null,
    lastActionType: lastEditLog?.action_type ?? null,
  };
}
