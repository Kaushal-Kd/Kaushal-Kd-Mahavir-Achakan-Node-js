import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  compactDraftValue,
  compactBookingDraftSnapshot,
  isSnapshotTriviallyEmpty,
  readDraftList,
  upsertBookingDraft,
  writeDraftList,
} from './bookingDraftStorage.js';

const LIST_KEY = 'wrs.booking_drafts_v1';
const memory = new Map();

function installMemoryStorage() {
  globalThis.localStorage = {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(key);
    },
  };
}

afterEach(() => {
  memory.clear();
});

describe('compactDraftValue', () => {
  it('keeps product and accessory rows', () => {
    const lines = [
      {
        line_id: 'l1',
        product_id: 'p1',
        name_snapshot: 'Sherwani',
        accessories: [{ line_id: 'a1', accessory_id: 'x1', name_snapshot: 'Mala', selected: true, qty: 1 }],
      },
    ];
    const compact = compactDraftValue(lines);
    assert.equal(compact[0].name_snapshot, 'Sherwani');
    assert.equal(compact[0].accessories[0].accessory_id, 'x1');
    assert.equal(compact[0].accessories[0].selected, true);
  });

  it('drops huge data URLs and photo arrays', () => {
    const compact = compactDraftValue({
      photos: [{ url: 'x' }],
      tailor_note_image: `data:image/png;base64,${'A'.repeat(6000)}`,
      name_snapshot: 'Keep me',
    });
    assert.equal(compact.photos, undefined);
    assert.equal(compact.tailor_note_image, '');
    assert.equal(compact.name_snapshot, 'Keep me');
  });

  it('returns null on circular values instead of throwing', () => {
    const circular = { name_snapshot: 'A' };
    circular.self = circular;
    assert.equal(compactDraftValue(circular), null);
  });
});

describe('upsertBookingDraft', () => {
  it('persists lines and contact fields for reopen', () => {
    installMemoryStorage();
    const snapshot = compactBookingDraftSnapshot({
      customer: { id: 'c1', name: 'Ravi', phone1: '9876543210', phone2: '9123456789' },
      contactNo1: '9876543210',
      contactNo2: '9123456789',
      contact2Name: 'Kiran',
      lines: [
        {
          line_id: 'l1',
          product_id: 'p1',
          name_snapshot: 'Sherwani',
          accessories: [{ accessory_id: 'x1', name_snapshot: 'Mala', selected: true }],
        },
      ],
    });
    const row = upsertBookingDraft({ id: 'd1', title: 'Ravi', snapshot });
    assert.ok(row);
    const stored = readDraftList()[0];
    assert.equal(stored.snapshot.contactNo2, '9123456789');
    assert.equal(stored.snapshot.lines[0].name_snapshot, 'Sherwani');
    assert.equal(stored.snapshot.lines[0].accessories[0].accessory_id, 'x1');
    assert.equal(isSnapshotTriviallyEmpty(stored.snapshot), false);
  });

  it('retries after quota by compacting', () => {
    installMemoryStorage();
    let writes = 0;
    const baseSet = globalThis.localStorage.setItem.bind(globalThis.localStorage);
    globalThis.localStorage.setItem = (key, value) => {
      writes += 1;
      if (writes === 1) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        err.code = 22;
        throw err;
      }
      baseSet(key, value);
    };
    const ok = writeDraftList([
      {
        id: 'd1',
        title: 'Ravi',
        updatedAt: 1,
        snapshot: { customer: { id: 'c1', name: 'Ravi' }, lines: [] },
      },
    ]);
    assert.equal(ok, true);
    assert.ok(memory.get(LIST_KEY));
  });
});
