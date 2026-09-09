import { parseStageFlagsRaw } from '@wrs/shared';

import { isSellLine } from './bookingAccessoryCart.js';

/**
 * Rent accessories with checklist stages on a product line (item-stage list rows).
 * @param {Array<{ type?: string, stage_flags?: unknown }>|null|undefined} lineAccessories
 */
export function summarizeLineAccessories(lineAccessories) {
  const list = Array.isArray(lineAccessories) ? lineAccessories : [];
  const rentWithStages = list.filter((a) => !isSellLine(a));
  const total = rentWithStages.length;

  if (total === 0) {
    return {
      total: 0,
      prepared: 0,
      delivered: 0,
      received: 0,
      allPrepared: true,
      label: '—',
      tone: 'gray',
      hasChecklist: false,
    };
  }

  let prepared = 0;
  let delivered = 0;
  let received = 0;
  for (const acc of rentWithStages) {
    const flags = parseStageFlagsRaw(acc.stage_flags, 'accessory');
    if (flags.prepared) prepared += 1;
    if (flags.delivered) delivered += 1;
    if (flags.received) received += 1;
  }

  const allPrepared = prepared === total;
  let label;
  let tone;
  if (allPrepared) {
    label = total === 1 ? 'Prepared' : 'All prepared';
    tone = 'green';
  } else {
    label = `${prepared}/${total} Prepared`;
    tone = 'yellow';
  }

  return {
    total,
    prepared,
    delivered,
    received,
    allPrepared,
    label,
    tone,
    hasChecklist: true,
  };
}
