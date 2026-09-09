import assert from 'node:assert/strict';
import test from 'node:test';

import { applyConditionPatchToDraft } from './orderConditionDraft.js';
import {
  buildChecklistSaveCommand,
  buildItemToCollectCommands,
  draftsFromOrder,
  draftsFromPendingChecklist,
  MIXED_DELIVERY_CONDITION_MESSAGE,
  prepareChecklistCombinedReview,
  saveChecklistDraft,
  saveItemToCollectCommands,
  shouldSendChecklistWhatsApp,
} from './orderChecklistSave.js';

const originalToken = 'a'.repeat(64);
const orderFixture = () => ({
  id: 'booking-1', checklist_state_token: originalToken,
  items: [{ id: 'product-line', product_id: 'original-product', replacement_version: 2, qty: 1,
    stage_flags: { item_to_collect: true, prepared: false, delivered: false, received: false } }],
  accessories: [{ id: 'accessory-line', order_item_id: 'product-line', qty: 3,
    stage_flags: { prepared: false, delivered: false, received: false } }],
});

test('checklist consumer submits condition and stage changes exactly once with the original booking token', async () => {
  const order = orderFixture();
  const original = structuredClone(order);
  const { stageDraft, conditionDraft } = draftsFromOrder(order);
  stageDraft['item:product-line'].prepared = true;
  const draft = applyConditionPatchToDraft(conditionDraft, 'accessory', 'accessory-line', {
    missing: true, condition_qty: 1, damage_charge: 90,
  });
  const combinedCharge = { amount: 90, accountId: 'cash', remarks: 'One missing accessory' };
  const calls = [];
  const response = { queued: false, replayed: false, order: { ...order, checklist_state_token: 'b'.repeat(64) } };
  assert.equal(await saveChecklistDraft({ order, stageDraft, conditionDraft: draft, combinedCharge,
    submit: async (command) => { calls.push(command); return response; } }), response);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].order, order);
  assert.equal(calls[0].order.checklist_state_token, originalToken);
  assert.deepEqual(calls[0].stageUpdates, [{ item_id: 'product-line', item_type: 'item', field: 'prepared', value: true,
    expected_product_id: 'original-product', expected_line_version: 2 }]);
  assert.deepEqual(calls[0].conditionUpdates, [{ item_id: 'accessory-line', item_type: 'accessory', missing: true, damage_charge: 90, condition_qty: 1 }]);
  assert.equal(calls[0].combinedCharge, combinedCharge);
  assert.deepEqual(order, original);
});

test('accessory condition-only draft remains saveable without a stage change', async () => {
  const order = orderFixture();
  const { conditionDraft } = draftsFromOrder(order);
  const draft = applyConditionPatchToDraft(conditionDraft, 'accessory', 'accessory-line', { damaged: true, condition_qty: 1 });
  const calls = [];
  const result = await saveChecklistDraft({ order, conditionDraft: draft,
    submit: async (command) => { calls.push(command); return { queued: true, order: null, replayed: false }; } });
  assert.equal(result.queued, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].stageUpdates, []);
  assert.equal(calls[0].conditionUpdates[0].condition_qty, 1);
  assert.equal(calls[0].conditionUpdates[0].damaged, true);
});

test('mixed new delivery and conditions are rejected before any save and leave both drafts intact', async () => {
  const order = orderFixture();
  const { stageDraft, conditionDraft } = draftsFromOrder(order);
  stageDraft['item:product-line'].prepared = true;
  stageDraft['item:product-line'].delivered = true;
  const draft = applyConditionPatchToDraft(conditionDraft, 'accessory', 'accessory-line', { missing: true, condition_qty: 1 });
  const before = structuredClone({ order, stageDraft, draft });
  let submitted = 0;
  await assert.rejects(saveChecklistDraft({ order, stageDraft, conditionDraft: draft,
    submit: async () => { submitted += 1; } }), { message: MIXED_DELIVERY_CONDITION_MESSAGE });
  assert.equal(submitted, 0);
  assert.deepEqual({ order, stageDraft, draft }, before);
});

test('invalid combined account or accidental click event never submits any checklist changes', async () => {
  const order = orderFixture();
  let submitted = 0;
  for (const combinedCharge of [{ amount: 50, accountId: '' }, { type: 'click', target: {} }, { amount: -1 }]) {
    await assert.rejects(saveChecklistDraft({ order, combinedCharge,
      submit: async () => { submitted += 1; } }), /combined charge/);
  }
  assert.equal(submitted, 0);
});

test('failed atomic command does not retry or perform a second partial save', async () => {
  const order = orderFixture();
  const { stageDraft, conditionDraft } = draftsFromOrder(order);
  stageDraft['item:product-line'].prepared = true;
  const draft = applyConditionPatchToDraft(conditionDraft, 'accessory', 'accessory-line', { missing: true, condition_qty: 1 });
  let submitted = 0;
  await assert.rejects(saveChecklistDraft({ order, stageDraft, conditionDraft: draft, submit: async (command) => {
    submitted += 1;
    assert.equal(command.stageUpdates.length, 1);
    assert.equal(command.conditionUpdates.length, 1);
    throw new Error('Booking changed; review required');
  } }), /review required/);
  assert.equal(submitted, 1);
  assert.equal(stageDraft['item:product-line'].prepared, true);
  assert.equal(draft['accessory:accessory-line'].condition_qty, 1);
});

test('pending checklist payload restores partial affected quantity and stages without modifying its base or token', () => {
  const order = orderFixture();
  const before = structuredClone(order);
  const payload = { expected_state_token: originalToken,
    stage_updates: [{ item_id: 'product-line', item_type: 'item', field: 'prepared', value: true }],
    condition_updates: [{ item_id: 'accessory-line', item_type: 'accessory', missing: true, condition_qty: 1, damage_charge: 25 }] };
  const restored = draftsFromPendingChecklist(order, payload);
  assert.equal(restored.stageDraft['item:product-line'].prepared, true);
  assert.equal(restored.conditionDraft['accessory:accessory-line'].missing, true);
  assert.equal(restored.conditionDraft['accessory:accessory-line'].condition_qty, 1);
  assert.equal(restored.conditionDraft['accessory:accessory-line'].damage_charge, 25);
  assert.deepEqual(order, before);
  assert.equal(payload.expected_state_token, originalToken);
});

test('existing combined charge corrected to normal carries an explicit zero assessment and note', () => {
  const order = orderFixture();
  order.pending_checklist_combined_charge = { amount: 100, remarks: 'Original charge' };
  order.accessories[0] = { ...order.accessories[0], damaged: true, damaged_qty: 1, damage_charge: 100 };
  const { conditionDraft } = draftsFromOrder(order);
  const draft = applyConditionPatchToDraft(conditionDraft, 'accessory', 'accessory-line', { damaged: false, damage_charge: 0 });
  const review = prepareChecklistCombinedReview(order, draft);
  assert.equal(review.total, 0);
  assert.match(review.remarks, /reset to zero/);
  const combinedCharge = { amount: review.total, remarks: review.remarks, accountId: '' };
  const command = buildChecklistSaveCommand({ order, conditionDraft: draft, combinedCharge });
  assert.equal(command.combinedCharge.amount, 0);
  assert.equal(command.combinedCharge.remarks, review.remarks);
  assert.equal(command.conditionUpdates[0].damage_charge, 0);
});

test('WhatsApp post-save flow runs only for a newly confirmed result, never queued or replayed', () => {
  const cases = [
    [{ queued: true, replayed: false, order: null }, false],
    [{ queued: true, replayed: false, order: orderFixture() }, false],
    [{ queued: false, replayed: true, order: orderFixture() }, false],
    [{ queued: false, replayed: false, order: null }, false],
    [{ queued: false, replayed: false, order: orderFixture() }, true],
  ];
  for (const [result, expected] of cases) assert.equal(shouldSendChecklistWhatsApp(result), expected);
});

const pick = (id, orderId = 'booking-1', token = originalToken) => ({
  id, order_id: orderId, product_id: `product-${id}`, replacement_version: 3, checklist_state_token: token,
});
const selection = (...lines) => new Map(lines.map((line) => [line.id, line]));

test('collect report groups a booking into one command with captured product versions and token', () => {
  const commands = buildItemToCollectCommands(selection(pick('one'), pick('two'), pick('three', 'booking-2')));
  assert.equal(commands.length, 2);
  assert.equal(commands[0].stageUpdates.length, 2);
  assert.equal(commands[0].order.checklist_state_token, originalToken);
  assert.equal(commands[0].stageUpdates[1].expected_product_id, 'product-two');
  assert.equal(commands[0].stageUpdates[1].expected_line_version, 3);
});

test('collect report rejects missing or mixed captured versions before sending any booking', async () => {
  let calls = 0;
  for (const lines of [
    selection(pick('one'), pick('two', 'booking-2', '')),
    selection(pick('one'), pick('two', 'booking-1', 'b'.repeat(64))),
    selection(pick('one'), { ...pick('two'), replacement_version: null }),
  ]) {
    await assert.rejects(saveItemToCollectCommands({ selectedLines: lines, submit: async () => { calls += 1; } }), /selection|versions/);
  }
  assert.equal(calls, 0);
});

test('collect report blocks selected bookings with pending checklist actions', () => {
  assert.throws(() => buildItemToCollectCommands(selection(pick('one')), [{ entityId: 'booking-1' }]), /pending checklist/);
});

test('collect report reports saved and queued counts separately without chunking a booking', async () => {
  const calls = [];
  const result = await saveItemToCollectCommands({ selectedLines: selection(pick('one'), pick('two'), pick('three', 'booking-2')),
    submit: async (id, command) => { calls.push({ id, command }); return { queued: id === 'booking-2' }; } });
  assert.deepEqual(result, { savedLineCount: 2, queuedLineCount: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command.stageUpdates.length, 2);
});

test('collect report describes earlier accepted bookings when a later independent booking fails', async () => {
  const calls = [];
  await assert.rejects(saveItemToCollectCommands({
    selectedLines: selection(pick('one'), pick('two', 'booking-2'), pick('three', 'booking-3')),
    submit: async (id) => { calls.push(id); if (id === 'booking-2') throw new Error('Stale booking'); return { queued: true }; },
  }), /1 line\(s\) already saved or queued.*Stale booking.*reselect only remaining/);
  assert.deepEqual(calls, ['booking-1', 'booking-2']);
});
