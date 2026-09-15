const LIST_KEY = 'wrs.booking_drafts_v1';
const ACTIVE_KEY = 'wrs.booking_active_draft_id';
export const SNAPSHOT_VERSION = 1;
export const MAX_BOOKING_DRAFTS = 25;
const MAX_DATA_URL_CHARS = 4096;

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isQuotaError(err) {
  return (
    err?.name === 'QuotaExceededError' ||
    err?.code === 22 ||
    err?.code === 1014 ||
    String(err?.message || '').toLowerCase().includes('quota')
  );
}

function isBinaryLike(val) {
  if (val == null || typeof val !== 'object') return false;
  if (typeof File !== 'undefined' && val instanceof File) return true;
  if (typeof Blob !== 'undefined' && val instanceof Blob) return true;
  return false;
}

/**
 * JSON-clone a draft value, dropping files/circulars/huge data URLs so localStorage
 * writes do not throw and wipe a previously complete snapshot.
 * @param {unknown} value
 * @returns {unknown}
 */
export function compactDraftValue(value) {
  try {
    return JSON.parse(
      JSON.stringify(value, (key, val) => {
        if (typeof val === 'function') return undefined;
        if (isBinaryLike(val)) return null;
        if (key === 'photos' || key === 'photo_files' || key === '__raw') return undefined;
        if (typeof val === 'string' && val.startsWith('data:') && val.length > MAX_DATA_URL_CHARS) {
          return '';
        }
        return val;
      })
    );
  } catch {
    return null;
  }
}

export function compactBookingDraftSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const compact = compactDraftValue(snapshot);
  if (!compact || typeof compact !== 'object') return null;
  if (!Array.isArray(compact.lines)) compact.lines = [];
  return { ...compact, v: SNAPSHOT_VERSION };
}

export function readDraftList() {
  if (typeof localStorage === 'undefined') return [];
  const parsed = safeParse(localStorage.getItem(LIST_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

export function writeDraftList(list) {
  if (typeof localStorage === 'undefined') return false;
  const rows = Array.isArray(list) ? list : [];
  const persist = (next) => {
    localStorage.setItem(LIST_KEY, JSON.stringify(next));
  };
  try {
    persist(rows);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) return false;
    const compacted = pruneDraftList(rows).map((row) => ({
      ...row,
      snapshot: compactBookingDraftSnapshot(row.snapshot) || { v: SNAPSHOT_VERSION, lines: [] },
    }));
    try {
      persist(compacted);
      return true;
    } catch {
      const halved = compacted.slice(0, Math.max(1, Math.ceil(compacted.length / 2)));
      try {
        persist(halved);
        return true;
      } catch {
        return false;
      }
    }
  }
}

export function getActiveDraftId() {
  if (typeof localStorage === 'undefined') return null;
  const id = String(localStorage.getItem(ACTIVE_KEY) || '').trim();
  return id || null;
}

export function setActiveDraftId(id) {
  if (typeof localStorage === 'undefined') return;
  if (!id) {
    localStorage.removeItem(ACTIVE_KEY);
    return;
  }
  localStorage.setItem(ACTIVE_KEY, String(id));
}

export function pruneDraftList(list) {
  const sorted = [...list].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  return sorted.slice(0, MAX_BOOKING_DRAFTS);
}

export function upsertBookingDraft({ id, title, snapshot }) {
  const now = Date.now();
  const compactSnap = compactBookingDraftSnapshot(snapshot);
  if (!compactSnap) return null;
  const list = readDraftList();
  const idx = list.findIndex((d) => d.id === id);
  const row = {
    id,
    title: String(title || 'Untitled draft').slice(0, 120),
    updatedAt: now,
    snapshot: compactSnap,
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...row };
  } else {
    list.unshift(row);
  }
  const ok = writeDraftList(pruneDraftList(list));
  return ok ? row : null;
}

export function removeBookingDraft(id) {
  const sid = String(id || '').trim();
  if (!sid) return;
  const list = readDraftList().filter((d) => d.id !== sid);
  writeDraftList(list);
  if (getActiveDraftId() === sid) {
    setActiveDraftId(null);
  }
}

export function draftLabelFromSnapshot(snapshot) {
  const c = snapshot?.customer;
  const name = String(c?.name || '').trim();
  if (name) return name;
  const lines = snapshot?.lines || [];
  if (lines.length > 0) {
    const first = String(lines[0]?.name_snapshot || '').trim();
    if (first) return `${first}${lines.length > 1 ? ` +${lines.length - 1}` : ''}`;
  }
  return 'Untitled booking';
}

function snapStr(snapshot, ...keys) {
  for (const key of keys) {
    const v = String(snapshot[key] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/** True when the snapshot has nothing worth persisting (auto-save skips / removes draft). */
export function isSnapshotTriviallyEmpty(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return true;
  if (snapshot.customer && String(snapshot.customer.id || '').trim()) return false;

  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  if (lines.length > 0) return false;

  if (snapStr(snapshot, 'customerQuery')) return false;
  if (snapStr(snapshot, 'customerNotes', 'customer_notes')) return false;
  if (snapStr(snapshot, 'referenceName', 'reference_name')) return false;
  if (snapStr(snapshot, 'contactNo1', 'contact_no1')) return false;
  if (snapStr(snapshot, 'contactNo2', 'contact_no2')) return false;
  if (snapStr(snapshot, 'contact2Name', 'contact2_name')) return false;
  if (snapStr(snapshot, 'whatsappManual', 'whatsapp_manual')) return false;
  if (snapStr(snapshot, 'address')) return false;
  if (snapStr(snapshot, 'advanceAccountId', 'advance_account_id')) return false;
  if (snapStr(snapshot, 'securityAccountId', 'security_account_id')) return false;
  if (snapStr(snapshot, 'nextBookingGapDaysInput', 'next_booking_gap_days')) return false;
  if (snapStr(snapshot, 'previousBookingGapDaysInput', 'previous_booking_gap_days')) return false;

  if (Number(snapshot.advanceAmount ?? snapshot.advance_amount ?? 0) > 0) return false;
  if (Number(snapshot.deposit ?? 0) > 0) return false;
  if (Number(snapshot.bookingDiscountValue ?? snapshot.booking_discount_value ?? 0) > 0) return false;
  if (snapshot.paidSecurityAmt || snapshot.paid_security_amt) return false;

  const mad = snapshot.manualAccessoryDraft || snapshot.manual_accessory_draft;
  if (mad && typeof mad === 'object' && Object.keys(mad).length > 0) return false;

  const quickIds = snapshot.quickBillDraftIds || snapshot.quick_bill_draft_ids;
  if (Array.isArray(quickIds) && quickIds.length > 0) return false;

  return true;
}
