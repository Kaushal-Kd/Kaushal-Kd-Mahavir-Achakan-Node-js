import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isStageFlagTruthy,
  normalizeProductStageFlagsFromParsed,
  parseItemLineStageFlagsFromRaw,
  resolveAccessoryChecklistStageFlags,
  syncAccessoryStageFlagsForGivenStatusChange,
} from './stageFlags.js';

describe('isStageFlagTruthy', () => {
  it('treats string false and 0 as falsy', () => {
    assert.equal(isStageFlagTruthy('false'), false);
    assert.equal(isStageFlagTruthy('0'), false);
    assert.equal(isStageFlagTruthy(false), false);
  });

  it('treats string true and 1 as truthy', () => {
    assert.equal(isStageFlagTruthy('true'), true);
    assert.equal(isStageFlagTruthy('1'), true);
    assert.equal(isStageFlagTruthy(true), true);
  });
});

describe('normalizeProductStageFlagsFromParsed', () => {
  it('does not treat string false as collected', () => {
    const flags = normalizeProductStageFlagsFromParsed({ item_to_collect: 'false' });
    assert.equal(flags.item_to_collect, false);
  });

  it('prefers explicit item_to_collect over legacy pre_check', () => {
    const flags = normalizeProductStageFlagsFromParsed({
      item_to_collect: false,
      pre_check: true,
    });
    assert.equal(flags.item_to_collect, false);
  });

  it('maps pre_check when item_to_collect key is absent', () => {
    const flags = normalizeProductStageFlagsFromParsed({ pre_check: true });
    assert.equal(flags.item_to_collect, true);
  });
});

describe('parseItemLineStageFlagsFromRaw', () => {
  it('aligns with normalize for explicit item_to_collect', () => {
    const raw = { item_to_collect: 'false', pre_check: true };
    assert.equal(parseItemLineStageFlagsFromRaw(raw).item_to_collect, false);
    assert.equal(normalizeProductStageFlagsFromParsed(raw).item_to_collect, false);
  });
});

describe('syncAccessoryStageFlagsForGivenStatusChange', () => {
  it('forces prepared and delivered when changing to given_with_rent', () => {
    const next = syncAccessoryStageFlagsForGivenStatusChange(
      'pack_with_rent',
      'given_with_rent',
      { prepared: false, delivered: false, received: true }
    );
    assert.equal(next.prepared, true);
    assert.equal(next.delivered, true);
    assert.equal(next.received, true);
  });

  it('clears prepared and delivered when leaving given_with_rent', () => {
    const next = syncAccessoryStageFlagsForGivenStatusChange(
      'given_with_rent',
      'pack_with_rent',
      { prepared: true, delivered: true, received: true }
    );
    assert.equal(next.prepared, false);
    assert.equal(next.delivered, false);
    assert.equal(next.received, true);
  });

  it('leaves flags unchanged for pack_with_rent to regular', () => {
    const persisted = { prepared: true, delivered: false, received: false };
    const next = syncAccessoryStageFlagsForGivenStatusChange('pack_with_rent', 'regular', persisted);
    assert.deepEqual(next, persisted);
  });

  it('skips sync for sell accessories', () => {
    const persisted = { prepared: false, delivered: false, received: false };
    const next = syncAccessoryStageFlagsForGivenStatusChange(
      'given_with_rent',
      'pack_with_rent',
      persisted,
      { isSell: true }
    );
    assert.deepEqual(next, persisted);
  });
});

describe('resolveAccessoryChecklistStageFlags', () => {
  it('forces prepared and delivered for given_with_rent rent accessories', () => {
    const flags = resolveAccessoryChecklistStageFlags({
      type: 'rent',
      given_status: 'given_with_rent',
      stage_flags: { prepared: false, delivered: false, received: false },
    });
    assert.equal(flags.prepared, true);
    assert.equal(flags.delivered, true);
    assert.equal(flags.received, false);
  });

  it('uses stored flags for pack_with_rent without auto-tick', () => {
    const flags = resolveAccessoryChecklistStageFlags({
      type: 'rent',
      given_status: 'pack_with_rent',
      stage_flags: { prepared: false, delivered: false, received: false },
    });
    assert.equal(flags.prepared, false);
    assert.equal(flags.delivered, false);
  });

  it('does not force ticks for sell accessories', () => {
    const flags = resolveAccessoryChecklistStageFlags({
      type: 'sell',
      given_status: 'given_with_rent',
      stage_flags: { prepared: false, delivered: false, received: false },
    });
    assert.equal(flags.prepared, false);
    assert.equal(flags.delivered, false);
  });
});
