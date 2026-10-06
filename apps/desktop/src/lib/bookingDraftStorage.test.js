import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  compactDraftValue,
  compactBookingDraftSnapshot,
  isSnapshotTriviallyEmpty,
  readDraftList,
  resolveReusableBookingDraftId,
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

  it('reuses the existing draft when id is new but customer is the same', () => {
    installMemoryStorage();
    upsertBookingDraft({
      id: 'd1',
      title: 'AMITBHAI NEW BILL CHECK',
      snapshot: {
        customer: { id: 'c1', name: 'AMITBHAI NEW BILL CHECK', phone1: '0123456789' },
        contactNo1: '0123456789',
        address: 'HALVAD NEW',
        whatsappSource: 'phone1',
        lines: [{ line_id: 'l1', code_snapshot: 'SS-01', name_snapshot: 'Sherwani' }],
      },
    });
    const row = upsertBookingDraft({
      id: 'd2',
      title: 'AMITBHAI NEW BILL CHECK',
      snapshot: {
        customer: { id: 'c1', name: 'AMITBHAI NEW BILL CHECK', phone1: '0123456789' },
        contactNo1: '0987654321',
        address: 'HALVAD UPDATED',
        whatsappSource: 'phone1',
        lines: [
          { line_id: 'l1', code_snapshot: 'SS-01', name_snapshot: 'Sherwani' },
          { line_id: 'l2', code_snapshot: 'SS-02', name_snapshot: 'Indo' },
        ],
      },
    });
    assert.equal(row.id, 'd1');
    const list = readDraftList();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'd1');
    assert.equal(list[0].snapshot.contactNo1, '0987654321');
    assert.equal(list[0].snapshot.address, 'HALVAD UPDATED');
    assert.equal(list[0].snapshot.lines.length, 2);
  });

  it('reuses by title when customer id is missing', () => {
    installMemoryStorage();
    upsertBookingDraft({
      id: 't1',
      title: 'AMITBHAI NEW BILL CHECK',
      snapshot: { customer: { name: 'AMITBHAI NEW BILL CHECK' }, lines: [] },
    });
    const row = upsertBookingDraft({
      id: 't2',
      title: 'AMITBHAI NEW BILL CHECK',
      snapshot: { customer: { name: 'AMITBHAI NEW BILL CHECK' }, contactNo1: '111', lines: [] },
    });
    assert.equal(row.id, 't1');
    assert.equal(readDraftList().length, 1);
  });

  it('resolveReusableBookingDraftId prefers stored id then customer', () => {
    installMemoryStorage();
    upsertBookingDraft({
      id: 'keep',
      title: 'Ravi',
      snapshot: { customer: { id: 'c9', name: 'Ravi' }, lines: [] },
    });
    assert.equal(
      resolveReusableBookingDraftId({
        id: 'keep',
        snapshot: { customer: { id: 'c9', name: 'Ravi' } },
        title: 'Ravi',
      }),
      'keep'
    );
    assert.equal(
      resolveReusableBookingDraftId({
        id: 'other',
        snapshot: { customer: { id: 'c9', name: 'Ravi' } },
        title: 'Ravi',
      }),
      'keep'
    );
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
