/** Checklist / list row stage order (forward-only dropdown). */
export const ORDER_STAGE_PIPELINE = [
  'booked',
  'item_to_collect',
  'prepared',
  'delivered',
  'received',
];

/**
 * Map API order status to a single checklist stage key for list row dropdowns.
 * @param {string|undefined|null} status
 * @returns {'booked'|'item_to_collect'|'prepared'|'delivered'|'received'|'cancelled'}
 */
export function stageFromOrderStatus(status) {
  if (status === 'cancelled') return 'cancelled';
  if (status === 'received' || status === 'returned' || status === 'closed') return 'received';
  if (status === 'delivered' || status === 'partially_returned') return 'delivered';
  if (status === 'ready_for_delivery') return 'prepared';
  if (status === 'in_preparation' || status === 'item_to_collect') return 'item_to_collect';
  if (status === 'booked') return 'booked';
  if (status === 'pending' || status === 'confirmed' || status === 'draft') return 'booked';
  return 'booked';
}

/** Stages where Cancel is offered (not after delivery / return). */
export const STAGES_WITH_CANCEL = new Set(['booked', 'item_to_collect', 'prepared']);

/**
 * Row status select options: current stage + forward stages only; Cancel on early stages only.
 * @param {string} currentStage
 * @param {{
 *   stageOptions: Array<{ value: string, label: string }>,
 *   cancelOption: { value: string, label: string },
 *   cancelledOption: { value: string, label: string },
 * }} opts
 */
export function getRowStageSelectOptions(
  currentStage,
  { stageOptions, cancelOption, cancelledOption }
) {
  if (currentStage === 'cancelled') return [cancelledOption];

  const idx = ORDER_STAGE_PIPELINE.indexOf(currentStage);
  const from = idx >= 0 ? idx : 0;
  const allowed = new Set(ORDER_STAGE_PIPELINE.slice(from));
  const opts = stageOptions.filter((o) => o.value && allowed.has(o.value));
  if (STAGES_WITH_CANCEL.has(currentStage)) opts.push(cancelOption);
  return opts;
}
