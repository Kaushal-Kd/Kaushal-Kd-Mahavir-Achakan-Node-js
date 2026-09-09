import { normalizeProductStageFlagsFromParsed, normalizeSqlDateToIso, parseStageFlagsJson } from '@wrs/shared';

const TERMINAL = new Set(['cancelled', 'returned', 'closed', 'draft']);

export function replacementTargetIsPending(row, today) {
  const flags = normalizeProductStageFlagsFromParsed(parseStageFlagsJson(row.stage_flags));
  const pickup = normalizeSqlDateToIso(row.pickup_date);
  return !row.is_deleted && !TERMINAL.has(row.order_status || row.status) &&
    row.type === 'rent' && !flags.delivered && !flags.received &&
    Boolean(pickup && pickup >= today);
}

export function replacementRequirementStatus(requirement, line, order) {
  if (!line || !order || order.is_deleted || order.status === 'cancelled') return 'cancelled';
  if (line.product_id !== requirement.source_product_id) return 'replaced';
  return 'pending';
}

export function replacementLineIsStale(line, body) {
  return line.product_id !== body.expected_product_id ||
    Number(line.replacement_version || 0) !== body.expected_line_version;
}
