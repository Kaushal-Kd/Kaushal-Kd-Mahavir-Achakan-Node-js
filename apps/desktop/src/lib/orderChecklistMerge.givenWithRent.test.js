import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyBulkStageTrueToDraft,
  buildStageDraftMap,
  checklistRowKey,
  diffStageUpdates,
  stageUpdatesRequireAdminPassword,
  validateStageToggleIntent,
} from './orderChecklistMerge.js';

const givenWithRentAccessory = {
  id: 'acc-gwr',
  type: 'rent',
  given_status: 'given_with_rent',
  stage_flags: { prepared: false, delivered: false, received: false },
};

const packWithRentAccessory = {
  id: 'acc-pwr',
  type: 'rent',
  given_status: 'pack_with_rent',
  stage_flags: { prepared: false, delivered: false, received: false },
};

describe('given-with-rent checklist stages', () => {
  it('buildStageDraftMap auto-ticks prepared and delivered for given-with-rent', () => {
    const order = { items: [], accessories: [givenWithRentAccessory] };
    const draft = buildStageDraftMap(order);
    const flags = draft[checklistRowKey('accessory', 'acc-gwr')];
    assert.equal(flags.prepared, true);
    assert.equal(flags.delivered, true);
    assert.equal(flags.received, false);
  });

  it('buildStageDraftMap leaves pack-with-rent stages blank by default', () => {
    const order = { items: [], accessories: [packWithRentAccessory] };
    const draft = buildStageDraftMap(order);
    const flags = draft[checklistRowKey('accessory', 'acc-pwr')];
    assert.equal(flags.prepared, false);
    assert.equal(flags.delivered, false);
  });

  it('validateStageToggleIntent rejects unsetting locked stages', () => {
    const order = { items: [], accessories: [givenWithRentAccessory] };
    const draft = buildStageDraftMap(order);
    const result = validateStageToggleIntent(order, draft, 'accessory', 'acc-gwr', 'prepared', false);
    assert.equal(result.ok, false);
    assert.match(result.message, /Given with rent/i);
  });

  it('applyBulkStageTrueToDraft keeps given-with-rent prepared/delivered locked', () => {
    const order = { items: [], accessories: [givenWithRentAccessory, packWithRentAccessory] };
    const draft = buildStageDraftMap(order);
    const cleared = {
      ...draft,
      [checklistRowKey('accessory', 'acc-gwr')]: { prepared: false, delivered: false, received: false },
    };
    const next = applyBulkStageTrueToDraft(cleared, 'prepared', order);
    assert.equal(next[checklistRowKey('accessory', 'acc-gwr')].prepared, true);
    assert.equal(next[checklistRowKey('accessory', 'acc-gwr')].delivered, true);
    assert.equal(next[checklistRowKey('accessory', 'acc-pwr')].prepared, true);
  });

  it('diffStageUpdates skips locked stage changes on given-with-rent accessories', () => {
    const order = { items: [], accessories: [givenWithRentAccessory] };
    const serverDraft = buildStageDraftMap(order);
    const userDraft = {
      ...serverDraft,
      [checklistRowKey('accessory', 'acc-gwr')]: { prepared: false, delivered: false, received: true },
    };
    const updates = diffStageUpdates(order, userDraft);
    assert.ok(!updates.some((u) => u.item_id === 'acc-gwr' && (u.field === 'prepared' || u.field === 'delivered')));
    assert.ok(updates.some((u) => u.item_id === 'acc-gwr' && u.field === 'received' && u.value === true));
  });

  it('stageUpdatesRequireAdminPassword is true when unchecking delivered or received', () => {
    assert.equal(
      stageUpdatesRequireAdminPassword([
        { item_id: 'x', item_type: 'item', field: 'delivered', value: false },
      ]),
      true
    );
    assert.equal(
      stageUpdatesRequireAdminPassword([
        { item_id: 'x', item_type: 'item', field: 'received', value: false },
      ]),
      true
    );
    assert.equal(stageUpdatesRequireAdminPassword([]), false);
    assert.equal(
      stageUpdatesRequireAdminPassword([
        { item_id: 'x', item_type: 'item', field: 'delivered', value: true },
      ]),
      false
    );
    assert.equal(
      stageUpdatesRequireAdminPassword([
        { item_id: 'x', item_type: 'item', field: 'prepared', value: false },
      ]),
      false
    );
  });

  it('buildStageDraftMap reflects cleared flags for pack_with_rent after given transition sync', () => {
    const order = {
      items: [],
      accessories: [
        {
          id: 'acc-pwr-cleared',
          type: 'rent',
          given_status: 'pack_with_rent',
          stage_flags: { prepared: false, delivered: false, received: false },
        },
      ],
    };
    const draft = buildStageDraftMap(order);
    const flags = draft[checklistRowKey('accessory', 'acc-pwr-cleared')];
    assert.equal(flags.prepared, false);
    assert.equal(flags.delivered, false);
  });
});
